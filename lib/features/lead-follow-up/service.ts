/**
 * Lead follow-up data access: contact records (Refs #136, #554) and next actions (Refs #85)
 *
 * Every query is scoped by organizationId; the lead must belong to the organization and a
 * record of another organization is reported as not found. Permission checks are done by the
 * router. Each change writes one audit_logs row in the same transaction (resource
 * 'lead_contact' / 'lead_task', metadata.leadId), like staff updates of leads (#101). A contact's
 * audit row keeps what was recorded but not the note's text (like the deals, #435).
 *
 * A next action added for an open deal (its page, or the deals board and list, #853) goes to the
 * deal's owner when they are not the lead's assignee: it is given to them (assignee_id), so the
 * one the deal's warning is for sees it under "mine" and gets its due notices. Otherwise it
 * follows the lead's assignee, as every other task does (dealOwnerAssignee, decision
 * 2026-11-08-deal-next-action-assignee). A later change of either owner does not move it; removing
 * the member it is given to from the organization gives it back while it is open
 * (releaseTaskAssignments, #968).
 */

import type { db as defaultDb } from '@/lib/db/client';
import {
  auditLogs,
  deals,
  leadContactLogs,
  leadTasks,
  leads,
  organizationMembers,
  users,
} from '@/lib/db/schema';
import type { AuditAction, LeadContactLog } from '@/lib/db/schema';
import { findAssignableMember, memberDisplayName } from '@/lib/features/leads/service';
import { TRPCError } from '@trpc/server';
import { type SQL, and, asc, count, desc, eq, inArray, isNull, lte, min, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { nextMeetingDateOf, sortTasks } from './due';
import {
  CONTACT_FUTURE_TOLERANCE_MS,
  type ContactActor,
  type ContactKind,
  type ContactLogView,
  type ContactOutcome,
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

/**
 * A deal that is not one of the lead's in the organization: the same answer for a deal of another
 * lead, of another organization and an id that is no deal at all, so that none is told apart
 */
const notADealOfTheLead = () =>
  new TRPCError({ code: 'BAD_REQUEST', message: 'The deal is not a deal of the lead' });

/** The lead of the organization, with its assignee (NOT_FOUND otherwise); `lock` holds it */
async function assertLeadInOrganization(
  db: Executor,
  organizationId: string,
  leadId: string,
  lock = false
): Promise<{ assigneeUserId: string | null }> {
  const query = db
    .select({ id: leads.id, assigneeUserId: leads.assigneeUserId })
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.organizationId, organizationId)));
  const [lead] = await (lock ? query.for('no key update') : query.limit(1));
  if (!lead) throw notFound('lead');
  return lead;
}

interface AuditEntry {
  organizationId: string;
  userId: string;
  at: Date;
  action: Extract<AuditAction, 'create' | 'update' | 'delete'>;
  resource: typeof CONTACT_AUDIT_RESOURCE | typeof TASK_AUDIT_RESOURCE;
  resourceId: string;
  leadId: string;
  changes: { before?: Record<string, unknown>; after?: Record<string, unknown> };
  /** What the change came from, when not from the task itself: its hearing, a member's removal */
  via?: 'hearing' | 'member_removed';
  /** The deal a next action was added for (#853) */
  dealId?: string | null;
}

/** The audit_logs row of one change */
function auditRowOf(entry: AuditEntry): typeof auditLogs.$inferInsert {
  return {
    organizationId: entry.organizationId,
    userId: entry.userId,
    action: entry.action,
    resource: entry.resource,
    resourceId: entry.resourceId,
    changes: entry.changes,
    metadata: {
      leadId: entry.leadId,
      ...(entry.via ? { via: entry.via } : {}),
      ...(entry.dealId ? { dealId: entry.dealId } : {}),
    },
    createdAt: entry.at,
  };
}

async function writeAudit(db: Executor, entry: AuditEntry) {
  await db.insert(auditLogs).values(auditRowOf(entry));
}

/* ------------------------------------------------------------- Contacts */

/**
 * When a contact is recorded at: now when no time is given. A time in the future is refused; one
 * within CONTACT_FUTURE_TOLERANCE_MS of now (the screen's clock running ahead) is recorded as now
 */
function contactTimeOf(requested: Date | undefined, now: Date): Date {
  if (!requested) return now;
  if (requested.getTime() > now.getTime() + CONTACT_FUTURE_TOLERANCE_MS) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'A contact cannot be recorded in the future',
    });
  }
  return requested.getTime() > now.getTime() ? now : requested;
}

/**
 * Hold the lead, and the deal when one is given, until the contact is in: a lead or deal deleted
 * meanwhile waits for it (FOR KEY SHARE does not block updates of the lead or the deal). The deal
 * must be one of the lead's (BAD_REQUEST otherwise, also for a deal of another organization).
 * Lead first, then the deal, as the deletion of a lead cascades in that order
 */
async function holdContactTargets(
  tx: Transaction,
  input: { organizationId: string; leadId: string; dealId?: string | null }
) {
  const [lead] = await tx
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.id, input.leadId), eq(leads.organizationId, input.organizationId)))
    .for('key share');
  if (!lead) throw notFound('lead');
  if (!input.dealId) return;
  const [deal] = await tx
    .select({ id: deals.id })
    .from(deals)
    .where(
      and(
        eq(deals.id, input.dealId),
        eq(deals.organizationId, input.organizationId),
        eq(deals.leadId, input.leadId)
      )
    )
    .for('key share');
  if (!deal) throw notADealOfTheLead();
}

/** What an audit row keeps of a contact: all of it but the note's text */
const contactAuditOf = (row: LeadContactLog) => ({
  kind: row.kind,
  contactedAt: row.contactedAt.toISOString(),
  durationMinutes: row.durationMinutes,
  outcome: row.outcome,
  dealId: row.dealId,
  hasNote: row.note !== null,
});

/**
 * Record a contact: a tap made now ("called", "emailed", "could not reach"), or one with its
 * time, how long it took, its outcome and the deal it was about (#554). The note is optional
 */
export async function recordContact(
  db: Database,
  input: RecordContactInput & { userId: string },
  now: Date = new Date()
): Promise<ContactLogView> {
  const contactedAt = contactTimeOf(input.contactedAt, now);
  return db.transaction(async (tx) => {
    await holdContactTargets(tx, input);
    const [row] = await tx
      .insert(leadContactLogs)
      .values({
        organizationId: input.organizationId,
        leadId: input.leadId,
        kind: input.kind,
        note: input.note ?? null,
        contactedAt,
        durationMinutes: input.durationMinutes ?? null,
        outcome: input.outcome ?? null,
        dealId: input.dealId ?? null,
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
      changes: { after: contactAuditOf(row) },
    });
    return {
      id: row.id,
      leadId: row.leadId,
      kind: row.kind as ContactKind,
      note: row.note,
      contactedAt: row.contactedAt,
      durationMinutes: row.durationMinutes,
      outcome: row.outcome as ContactOutcome | null,
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
      changes: { before: contactAuditOf(row) },
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
        durationMinutes: leadContactLogs.durationMinutes,
        outcome: leadContactLogs.outcome,
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
      durationMinutes: row.durationMinutes,
      outcome: row.outcome as ContactOutcome | null,
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

/**
 * Member a task is given to (#853), joined under its own name. Any user: one who left the
 * organization is still named, so that a task left with them can be seen
 */
const assigneeUsers = alias(users, 'assignee_users');
const assigneeColumns = {
  assigneeName: assigneeUsers.name,
  assigneeEmail: assigneeUsers.email,
};

/** Names read with a task: the member to check with (a takeaway's) and its assignee */
interface TaskNames {
  checkWithUserName?: string | null;
  checkWithUserEmail?: string | null;
  assigneeName?: string | null;
  assigneeEmail?: string | null;
}

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
 * assignee (given only to a next action added for a deal whose owner is not the lead's assignee,
 * #853, and given back while open when they are removed from the organization, #968), else the
 * lead's assignee (#135), else whoever created it. Needs leads joined.
 */
export const responsibleUserSql: SQL<string | null> =
  sql`coalesce(${leadTasks.assigneeId}, ${leads.assigneeUserId}, ${leadTasks.createdBy})`;

function toTaskView(row: TaskRow, names: TaskNames = {}): LeadTaskView {
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
    checkWithUser: actorOf(row.checkWithUserId, names.checkWithUserName, names.checkWithUserEmail),
    assigneeId: row.assigneeId,
    assignee: actorOf(row.assigneeId, names.assigneeName, names.assigneeEmail),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Name of a task's assignee, for a task read without the join */
async function assigneeNamesOf(db: Executor, userId: string | null): Promise<TaskNames> {
  if (!userId) return {};
  const [user] = await db
    .select({ assigneeName: users.name, assigneeEmail: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return user ?? {};
}

/**
 * Stages of a won or lost deal: CLOSED_DEAL_STAGES of lib/features/deals/types/pipeline.ts, not
 * imported, as this feature does not read the deals feature (deals reads it: the two would make a
 * cycle of features). lead-follow-up-deal-owner.db.test.ts checks every closed stage
 */
const CLOSED_DEAL_STAGES: readonly string[] = ['won', 'lost'];

/**
 * Whom a next action added for a deal is given to (#853, decision
 * 2026-11-08-deal-next-action-assignee): the owner of an open deal when they are not the lead's
 * assignee (a lead without one counts as another), so that the one the deal's warning is for (the
 * deals board's "mine" and the 今日 screen go by the deal's owner) also sees it under "mine" and
 * gets its due notices. Null leaves it to the lead's assignee, else whoever adds it
 * (responsibleUserSql):
 * - the deal is won or lost: only an open deal is warned about (its page still adds for it)
 * - the owner is the lead's assignee, as by default (a deal's owner defaults to the lead's)
 * - the deal has no owner
 * - the owner may no longer hold leads: no longer a member, or a read-only role
 *   (findAssignableMember, as for a lead's assignee)
 *
 * The deal must be one of the lead's in the organization (notADealOfTheLead otherwise). Called
 * with the lead locked: a deal is changed or deleted with its lead locked first
 * (lib/features/deals/service.ts), so its stage and owner stay as read until the task is in.
 * The owner's membership is held too (FOR KEY SHARE, which a change of role does not wait for):
 * their removal from the organization waits until the task is in and then gives it back
 * (releaseTaskAssignments), and once removed they are no member to give it to.
 */
async function dealOwnerAssignee(
  tx: Transaction,
  input: { organizationId: string; leadId: string; dealId: string; leadAssigneeId: string | null }
): Promise<ContactActor | null> {
  const [deal] = await tx
    .select({ stage: deals.stage, ownerUserId: deals.ownerUserId })
    .from(deals)
    .where(
      and(
        eq(deals.id, input.dealId),
        eq(deals.organizationId, input.organizationId),
        eq(deals.leadId, input.leadId)
      )
    );
  if (!deal) throw notADealOfTheLead();
  if (CLOSED_DEAL_STAGES.includes(deal.stage)) return null;
  if (!deal.ownerUserId || deal.ownerUserId === input.leadAssigneeId) return null;
  await tx
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, input.organizationId),
        eq(organizationMembers.userId, deal.ownerUserId)
      )
    )
    .for('key share');
  const member = await findAssignableMember(tx, input.organizationId, deal.ownerUserId);
  return member ? { id: member.userId, name: memberDisplayName(member) } : null;
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
    .select({ task: leadTasks, ...checkWithColumns, ...assigneeColumns })
    .from(leadTasks)
    .leftJoin(checkWithUsers, eq(checkWithUsers.id, leadTasks.checkWithUserId))
    .leftJoin(assigneeUsers, eq(assigneeUsers.id, leadTasks.assigneeId))
    .where(
      and(eq(leadTasks.organizationId, input.organizationId), eq(leadTasks.leadId, input.leadId))
    )
    .orderBy(asc(leadTasks.dueOn), asc(leadTasks.createdAt))
    .limit(LEAD_TASKS_MAX_PER_LEAD);
  return sortTasks(rows.map((row) => toTaskView(row.task, row)));
}

/**
 * Add a next action or takeaway. Added for a deal (dealId), it is given to the owner of an open
 * deal when they are not the lead's assignee (dealOwnerAssignee); its audit row names the deal
 * (metadata.dealId, a closed one too) and, when it was given, the assignee
 */
export async function createTask(
  db: Database,
  input: Omit<CreateTaskInput, 'kind'> & { kind?: TaskKind; userId: string },
  now: Date = new Date()
): Promise<LeadTaskView> {
  const kind = input.kind ?? 'next_action';
  const checkWith = kind === 'takeaway' ? (input.checkWith ?? null) : null;
  const checkWithUserId = kind === 'takeaway' ? (input.checkWithUserId ?? null) : null;
  const dealId = input.dealId ?? null;
  return db.transaction(async (tx) => {
    // Locks the lead so concurrent creates cannot pass the limit together, and so that neither
    // its assignee nor its deals change before the task is in
    const lead = await assertLeadInOrganization(tx, input.organizationId, input.leadId, true);
    const assignee = dealId
      ? await dealOwnerAssignee(tx, {
          organizationId: input.organizationId,
          leadId: input.leadId,
          dealId,
          leadAssigneeId: lead.assigneeUserId,
        })
      : null;
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
        assigneeId: assignee?.id ?? null,
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
          ...(row.assigneeId ? { assigneeId: row.assigneeId } : {}),
        },
      },
      dealId,
    });
    return toTaskView(row, { ...member, assigneeName: assignee?.name });
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
    // A change never gives the task to someone else: the assignee stays as it is
    const names = { ...member, ...(await assigneeNamesOf(tx, current.assigneeId)) };
    if (Object.keys(set).length === 0) return toTaskView(current, names);

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
    return toTaskView(row, names);
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
 * Audit rows of releaseTaskAssignments inserted per statement: 8 parameters each, and PostgreSQL
 * takes 65,535 parameters a statement
 */
export const RELEASED_TASK_AUDIT_BATCH = 1000;

/**
 * When a member is removed from the organization (#968): give back the open next actions and
 * takeaways given to them (assignee_id), which then follow the lead's assignee, else whoever added
 * them (responsibleUserSql), so that someone sees them on 今日 and gets their due notices again (a
 * notice already sent is not sent again). Done ones keep their assignee as a record, and so do the
 * user's tasks of other organizations. Each task given back gets an audit row of its own: an
 * update of its assignee, via 'member_removed', by the member who removed them.
 *
 * Runs in the removal's transaction, after the membership is deleted: a next action being added
 * for a deal of theirs holds the membership (dealOwnerAssignee), so the deletion waits for it and
 * this update, a later statement, gives it back too. Returns the ids of the tasks given back.
 */
export async function releaseTaskAssignments(
  tx: Transaction,
  input: { organizationId: string; userId: string; actorUserId: string },
  now: Date = new Date()
): Promise<string[]> {
  const released = await tx
    .update(leadTasks)
    .set({ assigneeId: null, updatedBy: input.actorUserId, updatedAt: now })
    .where(
      and(
        eq(leadTasks.organizationId, input.organizationId),
        eq(leadTasks.assigneeId, input.userId),
        isNull(leadTasks.completedAt)
      )
    )
    .returning({ id: leadTasks.id, leadId: leadTasks.leadId });
  for (let start = 0; start < released.length; start += RELEASED_TASK_AUDIT_BATCH) {
    await tx.insert(auditLogs).values(
      released.slice(start, start + RELEASED_TASK_AUDIT_BATCH).map((task) =>
        auditRowOf({
          organizationId: input.organizationId,
          userId: input.actorUserId,
          at: now,
          action: 'update',
          resource: TASK_AUDIT_RESOURCE,
          resourceId: task.id,
          leadId: task.leadId,
          changes: { before: { assigneeId: input.userId }, after: { assigneeId: null } },
          via: 'member_removed',
        })
      )
    );
  }
  return released.map((task) => task.id);
}

/**
 * Open next actions and takeaways of the organization due today or earlier (Japan calendar day),
 * with the lead's name. scope 'mine' keeps only those the user is responsible for
 * (responsibleUserSql); 'all' lists everyone's with the user's own first. Oldest due first
 * within each, the first `limit` (DUE_TASKS_SHOWN by default). counts gives both totals for the
 * dashboard's switch.
 */
export async function listDueTasks(
  db: Executor,
  input: {
    organizationId: string;
    today: string;
    userId: string;
    scope?: DueTaskScope;
    limit?: number;
  }
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
        ...assigneeColumns,
      })
      .from(leadTasks)
      .innerJoin(leads, leadJoin)
      .leftJoin(checkWithUsers, eq(checkWithUsers.id, leadTasks.checkWithUserId))
      .leftJoin(assigneeUsers, eq(assigneeUsers.id, leadTasks.assigneeId))
      .where(scope === 'mine' ? and(due, mine) : due)
      .orderBy(
        ...(scope === 'all' ? [desc(mine)] : []),
        asc(leadTasks.dueOn),
        asc(leadTasks.createdAt),
        asc(leadTasks.id)
      )
      .limit(input.limit ?? DUE_TASKS_SHOWN),
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
