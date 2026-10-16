/**
 * Lead follow-up data access: contact records (Refs #136) and next actions (Refs #85)
 *
 * Every query is scoped by organizationId; the lead must belong to the organization and a
 * record of another organization is reported as not found. Permission checks are done by the
 * router. Each change writes one audit_logs row in the same transaction (resource
 * 'lead_contact' / 'lead_task', metadata.leadId), like staff updates of leads (#101).
 */

import type { db as defaultDb } from '@/lib/db/client';
import { auditLogs, leadContactLogs, leadTasks, leads, users } from '@/lib/db/schema';
import type { AuditAction } from '@/lib/db/schema';
import { TRPCError } from '@trpc/server';
import { and, asc, count, desc, eq, inArray, isNull, lte, min, sql } from 'drizzle-orm';
import { nextMeetingDateOf, sortTasks } from './due';
import {
  type ContactKind,
  type ContactLogView,
  type CreateTaskInput,
  DUE_TASKS_SHOWN,
  type DueTaskView,
  LEAD_TASKS_MAX_PER_LEAD,
  type LeadContactSummary,
  type LeadTaskView,
  RECENT_CONTACTS_LIMIT,
  type RecordContactInput,
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

function toTaskView(row: TaskRow): LeadTaskView {
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
    assigneeId: row.assigneeId,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const taskScope = (organizationId: string, id: string) =>
  and(eq(leadTasks.organizationId, organizationId), eq(leadTasks.id, id));

/** Next actions of a lead: open ones by due date, then done ones */
export async function listTasks(
  db: Executor,
  input: { organizationId: string; leadId: string }
): Promise<LeadTaskView[]> {
  await assertLeadInOrganization(db, input.organizationId, input.leadId);
  const rows = await db
    .select()
    .from(leadTasks)
    .where(
      and(eq(leadTasks.organizationId, input.organizationId), eq(leadTasks.leadId, input.leadId))
    )
    .orderBy(asc(leadTasks.dueOn), asc(leadTasks.createdAt))
    .limit(LEAD_TASKS_MAX_PER_LEAD);
  return sortTasks(rows.map(toTaskView));
}

export async function createTask(
  db: Database,
  input: CreateTaskInput & { userId: string },
  now: Date = new Date()
): Promise<LeadTaskView> {
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
    const [row] = await tx
      .insert(leadTasks)
      .values({
        organizationId: input.organizationId,
        leadId: input.leadId,
        title: input.title,
        note: input.note ?? null,
        dueOn: input.dueOn,
        source: 'manual',
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
      changes: { after: { title: row.title, dueOn: row.dueOn, note: row.note } },
    });
    return toTaskView(row);
  });
}

type TaskAuditValues = {
  title?: string | null;
  dueOn?: string;
  note?: string | null;
  done?: boolean;
};

/** Change the title, due date or note, or tick it done / reopen it. Only changed fields count */
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
    if (Object.keys(set).length === 0) return toTaskView(current);

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
    return toTaskView(row);
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
 * Open next actions of the organization due today or earlier (Japan calendar day), oldest due
 * first, with the lead's name. TODO(#135): only the user's own once tasks have assignees.
 */
export async function listDueTasks(
  db: Executor,
  input: { organizationId: string; today: string }
): Promise<{ items: DueTaskView[]; total: number }> {
  const due = and(
    eq(leadTasks.organizationId, input.organizationId),
    isNull(leadTasks.completedAt),
    lte(leadTasks.dueOn, input.today)
  );
  const [rows, [totals]] = await Promise.all([
    db
      .select({ task: leadTasks, name: leads.name, company: leads.company })
      .from(leadTasks)
      .innerJoin(
        leads,
        and(eq(leads.id, leadTasks.leadId), eq(leads.organizationId, input.organizationId))
      )
      .where(due)
      .orderBy(asc(leadTasks.dueOn), asc(leadTasks.createdAt), asc(leadTasks.id))
      .limit(DUE_TASKS_SHOWN),
    db.select({ total: count() }).from(leadTasks).where(due),
  ]);
  return {
    items: rows.map((row) => ({
      ...toTaskView(row.task),
      lead: { name: row.name, company: row.company },
    })),
    total: Number(totals?.total ?? 0),
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
      .set({ dueOn: date, updatedBy: userId, updatedAt: now })
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
