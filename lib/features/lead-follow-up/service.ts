/**
 * Lead follow-up data access: contact records (Refs #136) and next actions (Refs #85)
 *
 * Every query is scoped by organizationId; the lead must belong to the organization and a
 * record of another organization is reported as not found. Permission checks are done by the
 * router. Each change writes one audit_logs row in the same transaction (resource
 * 'lead_contact' / 'lead_task', metadata.leadId), like staff updates of leads (#101).
 */

import type { db as defaultDb } from '@/lib/db/client';
import {
  auditLogs,
  leadContactLogs,
  leadTasks,
  leads,
  organizationMembers,
  users,
} from '@/lib/db/schema';
import type { AuditAction } from '@/lib/db/schema';
import { TRPCError } from '@trpc/server';
import { type SQL, and, asc, count, desc, eq, inArray, isNull, lte, min, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { nextMeetingDateOf, sortTasks } from './due';
import {
  type ContactActor,
  type ContactKind,
  type ContactLogView,
  type CreateTaskInput,
  DUE_TASKS_SHOWN,
  type DueTaskScope,
  type DueTaskView,
  LEAD_TASKS_MAX_PER_LEAD,
  type LeadContactSummary,
  type LeadTaskView,
  RECENT_CONTACTS_LIMIT,
  type RecordContactInput,
  type TaskKind,
  type TaskSource,
  type UpdateTaskInput,
} from './types/schemas';

type Database = typeof defaultDb;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Transaction;

export const CONTACT_AUDIT_RESOURCE = 'lead_contact';
export const TASK_AUDIT_RESOURCE = 'lead_task';

const notFound = (what: 'lead' | 'contact' | 'task') =>
  new TRPCError({ code: 'NOT_FOUND', message: `The ${what} was not found` });

async function assertLeadInOrganization(
  db: Executor,
  organizationId: string,
  leadId: string,
  lock = false
) {
  const query = db
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.organizationId, organizationId)));
  const [lead] = await (lock ? query.for('no key update') : query.limit(1));
  if (!lead) throw notFound('lead');
}

async function writeAudit(
  db: Executor,
  entry: {
    organizationId: string;
    userId: string;
    at: Date;
    action: Extract<AuditAction, 'create' | 'update' | 'delete'>;
    resource: typeof CONTACT_AUDIT_RESOURCE | typeof TASK_AUDIT_RESOURCE;
    resourceId: string;
    leadId: string;
    changes: { before?: Record<string, unknown>; after?: Record<string, unknown> };
    via?: 'hearing';
  }
) {
  await db.insert(auditLogs).values({
    organizationId: entry.organizationId,
    userId: entry.userId,
    action: entry.action,
    resource: entry.resource,
    resourceId: entry.resourceId,
    changes: entry.changes,
    metadata: { leadId: entry.leadId, ...(entry.via ? { via: entry.via } : {}) },
    createdAt: entry.at,
  });
}

/* ------------------------------------------------------------- Contacts */

/** Record a contact made now ("called", "emailed", "could not reach"), with an optional note */
export async function recordContact(
  db: Database,
  input: RecordContactInput & { userId: string },
  now: Date = new Date()
): Promise<ContactLogView> {
  return db.transaction(async (tx) => {
    await assertLeadInOrganization(tx, input.organizationId, input.leadId);
    const [row] = await tx
      .insert(leadContactLogs)
      .values({
        organizationId: input.organizationId,
        leadId: input.leadId,
        kind: input.kind,
        note: input.note ?? null,
        contactedAt: now,
        createdBy: input.userId,
        createdAt: now,
      })
      .returning();
    await writeAudit(tx, {
      organizationId: input.organizationId,
      userId: input.userId,
      at: now,
      action: 'create',
      resource: CONTACT_AUDIT_RESOURCE,
      resourceId: row.id,
      leadId: input.leadId,
      changes: { after: { kind: row.kind, note: row.note } },
    });
    return {
      id: row.id,
      leadId: row.leadId,
      kind: row.kind as ContactKind,
      note: row.note,
      contactedAt: row.contactedAt,
      createdBy: null,
    };
  });
}

/** Remove a contact record (undo of a wrong tap) */
export async function deleteContact(
  db: Database,
  input: { organizationId: string; id: string; userId: string },
  now: Date = new Date()
): Promise<{ id: string; leadId: string }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .delete(leadContactLogs)
      .where(
        and(
          eq(leadContactLogs.organizationId, input.organizationId),
          eq(leadContactLogs.id, input.id)
        )
      )
      .returning();
    if (!row) throw notFound('contact');
    await writeAudit(tx, {
      organizationId: input.organizationId,
      userId: input.userId,
      at: now,
      action: 'delete',
      resource: CONTACT_AUDIT_RESOURCE,
      resourceId: row.id,
      leadId: row.leadId,
      changes: {
        before: { kind: row.kind, note: row.note, contactedAt: row.contactedAt.toISOString() },
      },
    });
    return { id: row.id, leadId: row.leadId };
  });
}

/** First contact time, number of records and the latest ones of a lead */
export async function getContactSummary(
  db: Executor,
  input: { organizationId: string; leadId: string }
): Promise<LeadContactSummary> {
  await assertLeadInOrganization(db, input.organizationId, input.leadId);
  const scope = and(
    eq(leadContactLogs.organizationId, input.organizationId),
    eq(leadContactLogs.leadId, input.leadId)
  );
  const [[totals], rows] = await Promise.all([
    db
      .select({
        first: min(leadContactLogs.contactedAt),
        total: count(),
        noAnswer: sql<number>`count(*) filter (where ${leadContactLogs.kind} = 'no_answer')`,
      })
      .from(leadContactLogs)
      .where(scope),
    db
      .select({
        id: leadContactLogs.id,
        leadId: leadContactLogs.leadId,
        kind: leadContactLogs.kind,
        note: leadContactLogs.note,
        contactedAt: leadContactLogs.contactedAt,
        createdBy: leadContactLogs.createdBy,
        userName: users.name,
        userEmail: users.email,
      })
      .from(leadContactLogs)
      .leftJoin(users, eq(users.id, leadContactLogs.createdBy))
      .where(scope)
      .orderBy(desc(leadContactLogs.contactedAt), desc(leadContactLogs.id))
      .limit(RECENT_CONTACTS_LIMIT),
  ]);
  return {
    firstContactAt: totals?.first ? new Date(totals.first) : null,
    total: Number(totals?.total ?? 0),
    noAnswerCount: Number(totals?.noAnswer ?? 0),
    recent: rows.map((row) => ({
      id: row.id,
      leadId: row.leadId,
      kind: row.kind as ContactKind,
      note: row.note,
      contactedAt: row.contactedAt,
      createdBy:
        row.createdBy && (row.userName || row.userEmail)
          ? { id: row.createdBy, name: row.userName?.trim() || (row.userEmail ?? '') }
          : null,
    })),
  };
}

/**
 * First contact time of each given lead: its earliest contact record of any kind, "no answer"
 * included (speed to lead counts the first attempt). Leads without a record are left out. For
 * the response time figures (#138).
 */
export async function firstContactTimes(
  db: Executor,
  input: { organizationId: string; leadIds: string[] }
): Promise<Map<string, Date>> {
  if (input.leadIds.length === 0) return new Map();
  const rows = await db
    .select({ leadId: leadContactLogs.leadId, first: min(leadContactLogs.contactedAt) })
    .from(leadContactLogs)
    .where(
      and(
        eq(leadContactLogs.organizationId, input.organizationId),
        inArray(leadContactLogs.leadId, input.leadIds)
      )
    )
    .groupBy(leadContactLogs.leadId);
  return new Map(
    rows.filter((row) => row.first !== null).map((row) => [row.leadId, new Date(row.first as Date)])
  );
}

/* ---------------------------------------------------------------- Tasks */

type TaskRow = typeof leadTasks.$inferSelect;

/** Member named as whom to check with, joined under its own name */
const checkWithUsers = alias(users, 'check_with_users');
const checkWithColumns = {
  checkWithUserName: checkWithUsers.name,
  checkWithUserEmail: checkWithUsers.email,
};

function actorOf(
  id: string | null,
  name: string | null | undefined,
  email: string | null | undefined
): ContactActor | null {
  if (!id || !(name || email)) return null;
  return { id, name: name?.trim() || (email ?? '') };
}

/**
 * The member responsible for a task, who sees it under "mine" and gets its due notices: its
 * assignee, else the lead's assignee (#135), else whoever created it. Needs leads joined.
 */
export const responsibleUserSql: SQL<string | null> =
  sql`coalesce(${leadTasks.assigneeId}, ${leads.assigneeUserId}, ${leadTasks.createdBy})`;

function toTaskView(
  row: TaskRow,
  checkWithUser: {
    checkWithUserName: string | null;
    checkWithUserEmail: string | null;
  } | null = null
): LeadTaskView {
  return {
    id: row.id,
    leadId: row.leadId,
    title: row.title,
    note: row.note,
    dueOn: row.dueOn,
    done: row.completedAt !== null,
    completedAt: row.completedAt,
    source: row.source as TaskSource,
    sourceHearingId: row.sourceHearingId,
    kind: row.kind as TaskKind,
    checkWith: row.checkWith,
    checkWithUser: actorOf(
      row.checkWithUserId,
      checkWithUser?.checkWithUserName,
      checkWithUser?.checkWithUserEmail
    ),
    assigneeId: row.assigneeId,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const taskScope = (organizationId: string, id: string) =>
  and(eq(leadTasks.organizationId, organizationId), eq(leadTasks.id, id));

/**
 * Name of the member to check with; the member must belong to the organization (a takeaway
 * cannot point at someone outside it)
 */
async function checkWithMember(
  db: Executor,
  organizationId: string,
  userId: string
): Promise<{ checkWithUserName: string | null; checkWithUserEmail: string | null }> {
  const [member] = await db
    .select({ checkWithUserName: users.name, checkWithUserEmail: users.email })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.userId, userId)
      )
    )
    .limit(1);
  if (!member) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Whom to check with must be a member of the organization',
    });
  }
  return member;
}

/** Next actions of a lead: open ones by due date, then done ones */
export async function listTasks(
  db: Executor,
  input: { organizationId: string; leadId: string }
): Promise<LeadTaskView[]> {
  await assertLeadInOrganization(db, input.organizationId, input.leadId);
  const rows = await db
    .select({ task: leadTasks, ...checkWithColumns })
    .from(leadTasks)
    .leftJoin(checkWithUsers, eq(checkWithUsers.id, leadTasks.checkWithUserId))
    .where(
      and(eq(leadTasks.organizationId, input.organizationId), eq(leadTasks.leadId, input.leadId))
    )
    .orderBy(asc(leadTasks.dueOn), asc(leadTasks.createdAt))
    .limit(LEAD_TASKS_MAX_PER_LEAD);
  return sortTasks(rows.map((row) => toTaskView(row.task, row)));
}

export async function createTask(
  db: Database,
  input: Omit<CreateTaskInput, 'kind'> & { kind?: TaskKind; userId: string },
  now: Date = new Date()
): Promise<LeadTaskView> {
  const kind = input.kind ?? 'next_action';
  const checkWith = kind === 'takeaway' ? (input.checkWith ?? null) : null;
  const checkWithUserId = kind === 'takeaway' ? (input.checkWithUserId ?? null) : null;
  return db.transaction(async (tx) => {
    // Locks the lead so concurrent creates cannot pass the limit together
    await assertLeadInOrganization(tx, input.organizationId, input.leadId, true);
    const [{ total }] = await tx
      .select({ total: count() })
      .from(leadTasks)
      .where(
        and(eq(leadTasks.organizationId, input.organizationId), eq(leadTasks.leadId, input.leadId))
      );
    if (total >= LEAD_TASKS_MAX_PER_LEAD) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `A lead can have at most ${LEAD_TASKS_MAX_PER_LEAD} next actions`,
      });
    }
    const member = checkWithUserId
      ? await checkWithMember(tx, input.organizationId, checkWithUserId)
      : null;
    const [row] = await tx
      .insert(leadTasks)
      .values({
        organizationId: input.organizationId,
        leadId: input.leadId,
        title: input.title,
        note: input.note ?? null,
        dueOn: input.dueOn,
        source: 'manual',
        kind,
        checkWith,
        checkWithUserId,
        createdBy: input.userId,
        updatedBy: input.userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await writeAudit(tx, {
      organizationId: input.organizationId,
      userId: input.userId,
      at: now,
      action: 'create',
      resource: TASK_AUDIT_RESOURCE,
      resourceId: row.id,
      leadId: row.leadId,
      changes: {
        after: {
          title: row.title,
          dueOn: row.dueOn,
          note: row.note,
          ...(kind === 'takeaway'
            ? { kind, checkWith: row.checkWith, checkWithUserId: row.checkWithUserId }
            : {}),
        },
      },
    });
    return toTaskView(row, member);
  });
}

type TaskAuditValues = {
  title?: string | null;
  dueOn?: string;
  note?: string | null;
  done?: boolean;
  kind?: string;
  checkWith?: string | null;
  checkWithUserId?: string | null;
};

/**
 * Change the title, due date, note, kind or whom to check with, or tick it done / reopen it.
 * Only changed fields count. Moving the due date clears the due notices so the new date gets
 * its own (see due-notifications.ts).
 */
export async function updateTask(
  db: Database,
  input: UpdateTaskInput & { userId: string },
  now: Date = new Date()
): Promise<LeadTaskView> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(leadTasks)
      .where(taskScope(input.organizationId, input.id))
      .for('update');
    if (!current) throw notFound('task');

    const before: TaskAuditValues = {};
    const after: TaskAuditValues = {};
    const set: Partial<typeof leadTasks.$inferInsert> = {};
    if (input.title !== undefined && input.title !== current.title) {
      before.title = current.title;
      after.title = input.title;
      set.title = input.title;
    }
    if (input.dueOn !== undefined && input.dueOn !== current.dueOn) {
      before.dueOn = current.dueOn;
      after.dueOn = input.dueOn;
      set.dueOn = input.dueOn;
      set.notifiedDueAt = null;
      set.notifiedOverdueAt = null;
    }
    if (input.note !== undefined && input.note !== current.note) {
      before.note = current.note;
      after.note = input.note;
      set.note = input.note;
    }
    const wasDone = current.completedAt !== null;
    if (input.done !== undefined && input.done !== wasDone) {
      before.done = wasDone;
      after.done = input.done;
      set.completedAt = input.done ? now : null;
      set.completedBy = input.done ? input.userId : null;
    }
    const kind = input.kind ?? (current.kind as TaskKind);
    if (kind !== current.kind) {
      before.kind = current.kind;
      after.kind = kind;
      set.kind = kind;
    }
    // Whom to check with: text and member replace each other; a next action has neither
    let checkWith = current.checkWith;
    let checkWithUserId = current.checkWithUserId;
    if (kind === 'next_action') {
      if (input.checkWith || input.checkWithUserId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only a takeaway has whom to check with',
        });
      }
      checkWith = null;
      checkWithUserId = null;
    } else if (input.checkWithUserId) {
      checkWith = null;
      checkWithUserId = input.checkWithUserId;
    } else if (input.checkWith) {
      checkWith = input.checkWith;
      checkWithUserId = null;
    } else {
      if (input.checkWith !== undefined) checkWith = null;
      if (input.checkWithUserId !== undefined) checkWithUserId = null;
    }
    if (checkWith !== current.checkWith) {
      before.checkWith = current.checkWith;
      after.checkWith = checkWith;
      set.checkWith = checkWith;
    }
    if (checkWithUserId !== current.checkWithUserId) {
      if (checkWithUserId) await checkWithMember(tx, input.organizationId, checkWithUserId);
      before.checkWithUserId = current.checkWithUserId;
      after.checkWithUserId = checkWithUserId;
      set.checkWithUserId = checkWithUserId;
    }
    const member = checkWithUserId
      ? await checkWithMember(tx, input.organizationId, checkWithUserId).catch(() => null)
      : null;
    if (Object.keys(set).length === 0) return toTaskView(current, member);

    const [row] = await tx
      .update(leadTasks)
      .set({ ...set, updatedBy: input.userId, updatedAt: now })
      .where(taskScope(input.organizationId, input.id))
      .returning();
    await writeAudit(tx, {
      organizationId: input.organizationId,
      userId: input.userId,
      at: now,
      action: 'update',
      resource: TASK_AUDIT_RESOURCE,
      resourceId: row.id,
      leadId: row.leadId,
      changes: { before, after },
    });
    return toTaskView(row, member);
  });
}

export async function deleteTask(
  db: Database,
  input: { organizationId: string; id: string; userId: string },
  now: Date = new Date()
): Promise<{ id: string; leadId: string }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .delete(leadTasks)
      .where(taskScope(input.organizationId, input.id))
      .returning();
    if (!row) throw notFound('task');
    await writeAudit(tx, {
      organizationId: input.organizationId,
      userId: input.userId,
      at: now,
      action: 'delete',
      resource: TASK_AUDIT_RESOURCE,
      resourceId: row.id,
      leadId: row.leadId,
      changes: { before: { title: row.title, dueOn: row.dueOn, done: row.completedAt !== null } },
    });
    return { id: row.id, leadId: row.leadId };
  });
}

/**
 * Open next actions and takeaways of the organization due today or earlier (Japan calendar day),
 * with the lead's name. scope 'mine' keeps only those the user is responsible for
 * (responsibleUserSql); 'all' lists everyone's with the user's own first. Oldest due first
 * within each. counts gives both totals for the dashboard's switch.
 */
export async function listDueTasks(
  db: Executor,
  input: { organizationId: string; today: string; userId: string; scope?: DueTaskScope }
): Promise<{ items: DueTaskView[]; total: number; counts: Record<DueTaskScope, number> }> {
  const scope = input.scope ?? 'mine';
  const mine = sql<boolean>`(${responsibleUserSql} is not distinct from ${input.userId}::uuid)`;
  const due = and(
    eq(leadTasks.organizationId, input.organizationId),
    isNull(leadTasks.completedAt),
    lte(leadTasks.dueOn, input.today)
  );
  const leadJoin = and(
    eq(leads.id, leadTasks.leadId),
    eq(leads.organizationId, input.organizationId)
  );
  const [rows, [totals]] = await Promise.all([
    db
      .select({
        task: leadTasks,
        name: leads.name,
        company: leads.company,
        mine,
        ...checkWithColumns,
      })
      .from(leadTasks)
      .innerJoin(leads, leadJoin)
      .leftJoin(checkWithUsers, eq(checkWithUsers.id, leadTasks.checkWithUserId))
      .where(scope === 'mine' ? and(due, mine) : due)
      .orderBy(
        ...(scope === 'all' ? [desc(mine)] : []),
        asc(leadTasks.dueOn),
        asc(leadTasks.createdAt),
        asc(leadTasks.id)
      )
      .limit(DUE_TASKS_SHOWN),
    db
      .select({
        all: count(),
        mine: sql<number>`count(*) filter (where ${mine})`,
      })
      .from(leadTasks)
      .innerJoin(leads, leadJoin)
      .where(due),
  ]);
  const counts = { all: Number(totals?.all ?? 0), mine: Number(totals?.mine ?? 0) };
  return {
    items: rows.map((row) => ({
      ...toTaskView(row.task, row),
      lead: { name: row.name, company: row.company },
      mine: Boolean(row.mine),
    })),
    total: counts[scope],
    counts,
  };
}

/**
 * After a hearing is saved: keep one next action at the next meeting date it records.
 * - No date in the hearing: nothing (no query at all)
 * - The hearing already made one: moves its due date while it is open; a done one stays
 * - Otherwise creates one, unless a hearing of the lead already made one for that date (a new
 *   hearing copies the previous one's fields, including the date)
 * Runs inside the hearing's transaction; the unique index on source_hearing_id stops two saves
 * of the same hearing from creating two.
 */
export async function syncHearingNextAction(
  db: Executor,
  input: {
    organizationId: string;
    leadId: string;
    hearingId: string;
    fields: unknown;
    userId: string;
    now: Date;
  }
): Promise<void> {
  const date = nextMeetingDateOf(input.fields);
  if (!date) return;
  const { organizationId, leadId, hearingId, userId, now } = input;
  const audit = (
    action: 'create' | 'update',
    row: TaskRow,
    changes: { before?: Record<string, unknown>; after?: Record<string, unknown> }
  ) =>
    writeAudit(db, {
      organizationId,
      userId,
      at: now,
      action,
      resource: TASK_AUDIT_RESOURCE,
      resourceId: row.id,
      leadId,
      changes,
      via: 'hearing',
    });

  const [own] = await db
    .select()
    .from(leadTasks)
    .where(
      and(eq(leadTasks.organizationId, organizationId), eq(leadTasks.sourceHearingId, hearingId))
    )
    .limit(1);
  if (own) {
    if (own.completedAt !== null || own.dueOn === date) return;
    const [row] = await db
      .update(leadTasks)
      .set({
        dueOn: date,
        notifiedDueAt: null,
        notifiedOverdueAt: null,
        updatedBy: userId,
        updatedAt: now,
      })
      .where(and(taskScope(organizationId, own.id), isNull(leadTasks.completedAt)))
      .returning();
    if (row) await audit('update', row, { before: { dueOn: own.dueOn }, after: { dueOn: date } });
    return;
  }

  const [sameDate] = await db
    .select({ id: leadTasks.id })
    .from(leadTasks)
    .where(
      and(
        eq(leadTasks.organizationId, organizationId),
        eq(leadTasks.leadId, leadId),
        eq(leadTasks.source, 'hearing'),
        eq(leadTasks.dueOn, date)
      )
    )
    .limit(1);
  if (sameDate) return;

  const [row] = await db
    .insert(leadTasks)
    .values({
      organizationId,
      leadId,
      title: null,
      dueOn: date,
      source: 'hearing',
      sourceHearingId: hearingId,
      createdBy: userId,
      updatedBy: userId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: leadTasks.sourceHearingId,
      where: sql`${leadTasks.sourceHearingId} is not null`,
    })
    .returning();
  if (row) await audit('create', row, { after: { dueOn: row.dueOn, source: 'hearing' } });
}
