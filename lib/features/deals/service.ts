/**
 * Deals data access (Refs #435, Epic #430)
 *
 * Every query is scoped by organizationId: the lead, the owner and the previous deal must belong
 * to the organization, and a deal of another organization is reported as not found. The router
 * checks permissions. Each change is one transaction that writes the deal, a deal_history row
 * when a value the forecast reads changed, an audit_logs row (resource 'deal', metadata.leadId),
 * and moves the lead forward (./lead-sync.ts) with the lead's own audit row (#101). The lead's
 * webhooks and the handoff notice (#86) go out after the commit (afterDealChange).
 *
 * Locks are taken lead first, then deal, on every path (deleting a lead locks it and then its
 * deals through the cascade), so changes of two deals of one lead wait for each other on the lead
 * and the second one sees the first when it moves the lead.
 */

import type { db as defaultDb } from '@/lib/db/client';
import { type Lead, auditLogs, dealHistory, deals, leadTasks, leads, users } from '@/lib/db/schema';
import { isFirstHandoff, notifyLeadHandoff } from '@/lib/features/lead-handoff/service';
import {
  diffLeadAudit,
  findAssignableMember,
  leadAuditSnapshot,
  writeLeadAuditLogs,
} from '@/lib/features/leads/service';
import {
  type LostReason,
  type TargetSystem,
  jstDate,
  lostReasonEnum,
  statusUpdateFields,
  targetSystemEnum,
} from '@/lib/features/leads/types/pipeline';
import { emitLeadEvents, leadChangeEvents } from '@/lib/features/webhooks/service';
import { TRPCError } from '@trpc/server';
import {
  type SQL,
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { leadChangesFromDeals } from './lead-sync';
import {
  CLOSED_DEAL_STAGES,
  DEAL_KINDS,
  DEAL_STAGES,
  type DealKind,
  type DealStage,
  FORECAST_OVERRIDES,
  type ForecastCategory,
  type ForecastOverride,
  OPEN_DEAL_STAGES,
  STAGE_PROBABILITY,
  forecastCategory,
  isOpenStage,
  weightedAmount,
} from './types/pipeline';
import {
  BOARD_DEALS_LIMIT,
  type BoardInput,
  type CreateDealInput,
  DEAL_HISTORY_LIMIT,
  type UpdateDealInput,
} from './types/schemas';

// Who may read deals, for the routers of other features (the forecast, the targets): they read
// the deals through this file, not its internals (docs/ARCHITECTURE.md, #514)
export { canReadDeals } from './access';

type Database = typeof defaultDb;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type DealRow = typeof deals.$inferSelect;

export const DEAL_AUDIT_RESOURCE = 'deal';

/** Values the forecast reads: a change of one of them writes a deal_history row */
export const HISTORY_FIELDS = [
  'kind',
  'stage',
  'amount',
  'probability',
  'forecastOverride',
  'expectedCloseOn',
  'ownerUserId',
] as const satisfies readonly (keyof DealRow)[];

/** Values recorded in the audit log of a change */
const AUDITED_FIELDS = [
  'name',
  ...HISTORY_FIELDS,
  'closedOn',
  'lostReason',
  'competitor',
  'targetSystem',
  'previousDealId',
] as const satisfies readonly (keyof DealRow)[];

/**
 * Free text that may name people (the next step, the details of a loss): the audit log records
 * only that it changed (metadata.changedText), never the text, as the lead audit keeps no
 * contact details (#101). The text stays on the deal itself.
 */
const TEXT_FIELDS = ['nextStep', 'lostNote'] as const satisfies readonly (keyof DealRow)[];

export interface DealView {
  id: string;
  leadId: string;
  name: string;
  kind: DealKind;
  stage: DealStage;
  amount: number | null;
  probability: number;
  weightedAmount: number;
  forecastOverride: ForecastOverride | null;
  forecastCategory: ForecastCategory;
  expectedCloseOn: string | null;
  closedOn: string | null;
  lostReason: LostReason | null;
  lostNote: string | null;
  competitor: string | null;
  targetSystem: TargetSystem | null;
  nextStep: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  previousDealId: string | null;
  stageChangedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface DealCard extends DealView {
  leadName: string | null;
  company: string | null;
  /** Whether the lead has an open next action (a deal without one needs attention) */
  hasOpenTask: boolean;
}

export interface BoardColumn {
  stage: DealStage;
  count: number;
  amount: number;
  weightedAmount: number;
  deals: DealCard[];
}

export interface Board {
  columns: BoardColumn[];
  /** More deals matched than BOARD_DEALS_LIMIT; the totals still count all of them */
  truncated: boolean;
  /** Japan calendar day the board was read on (overdue close dates) */
  today: string;
}

export interface DealHistoryView {
  id: string;
  kind: DealKind;
  stage: DealStage;
  amount: number | null;
  probability: number;
  forecastOverride: ForecastOverride | null;
  expectedCloseOn: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  changedFields: string[];
  changedByName: string | null;
  changedAt: Date;
}

export interface LinkedDeal {
  id: string;
  name: string;
  kind: DealKind;
  stage: DealStage;
}

export interface DealDetail extends DealView {
  lead: { id: string; name: string | null; company: string | null; status: string };
  previousDeal: LinkedDeal | null;
  nextDeals: LinkedDeal[];
  history: DealHistoryView[];
}

/** The lead before and after a deal moved it forward */
export interface LeadMove {
  before: Lead;
  after: Lead;
  /** The lead moved on from the initial hearing for the first time (#86) */
  handedOff: boolean;
}

export interface DealChangeResult {
  deal: DealView;
  /** Null when the lead did not change */
  lead: LeadMove | null;
}

const nameOf = (table: typeof users) =>
  sql<string | null>`coalesce(nullif(trim(${table.name}), ''), ${table.email})`;

const oneOf = <T extends string>(values: readonly T[], value: string | null, fallback: T): T =>
  (values as readonly string[]).includes(value ?? '') ? (value as T) : fallback;

const orNull = <T extends string>(values: readonly T[], value: string | null): T | null =>
  (values as readonly string[]).includes(value ?? '') ? (value as T) : null;

function toDealView(row: DealRow & { ownerName: string | null }): DealView {
  const stage = oneOf(DEAL_STAGES, row.stage, 'qualification');
  const forecastOverride = orNull(FORECAST_OVERRIDES, row.forecastOverride);
  return {
    id: row.id,
    leadId: row.leadId,
    name: row.name,
    kind: oneOf(DEAL_KINDS, row.kind, 'other'),
    stage,
    amount: row.amount ?? null,
    probability: row.probability,
    weightedAmount: weightedAmount(row),
    forecastOverride,
    forecastCategory: forecastCategory({ stage, probability: row.probability, forecastOverride }),
    expectedCloseOn: row.expectedCloseOn ?? null,
    closedOn: row.closedOn ?? null,
    lostReason: lostReasonEnum.safeParse(row.lostReason).success
      ? (row.lostReason as LostReason)
      : null,
    lostNote: row.lostNote ?? null,
    competitor: row.competitor ?? null,
    targetSystem: targetSystemEnum.safeParse(row.targetSystem).success
      ? (row.targetSystem as TargetSystem)
      : null,
    nextStep: row.nextStep ?? null,
    ownerUserId: row.ownerUserId ?? null,
    ownerName: row.ownerName ?? null,
    previousDealId: row.previousDealId ?? null,
    stageChangedAt: row.stageChangedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const dealColumns = { ...getTableColumns(deals), ownerName: nameOf(users) };

const notFound = (what: 'lead' | 'deal') =>
  new TRPCError({
    code: 'NOT_FOUND',
    message: what === 'lead' ? 'Lead not found' : 'Deal not found',
  });

const badRequest = (message: string) => new TRPCError({ code: 'BAD_REQUEST', message });

/** Day `days` days before today in Japan (YYYY-MM-DD) */
function jstDaysAgo(days: number, now: Date): string {
  return jstDate(new Date(now.getTime() - days * 24 * 60 * 60 * 1000));
}

function boardConditions(input: BoardInput & { userId: string }, now: Date): SQL {
  const conditions: SQL[] = [eq(deals.organizationId, input.organizationId)];
  if (input.owner === 'mine') conditions.push(eq(deals.ownerUserId, input.userId));
  else if (input.owner !== 'all') conditions.push(eq(deals.ownerUserId, input.owner));
  if (input.kinds && input.kinds.length > 0) conditions.push(inArray(deals.kind, input.kinds));

  const open: SQL[] = [inArray(deals.stage, [...OPEN_DEAL_STAGES])];
  // A period leaves out open deals without a close date; without one they all show
  if (input.closeFrom) open.push(gte(deals.expectedCloseOn, input.closeFrom));
  if (input.closeTo) open.push(lte(deals.expectedCloseOn, input.closeTo));
  const closed = and(
    inArray(deals.stage, [...CLOSED_DEAL_STAGES]),
    gte(deals.closedOn, jstDaysAgo(input.closedWithinDays, now))
  );
  conditions.push(or(and(...open), closed) as SQL);
  return and(...conditions) as SQL;
}

/** The pipeline board: deals by stage with each stage's count, amount and weighted amount */
export async function getBoard(
  db: Database,
  input: BoardInput & { userId: string },
  now: Date = new Date()
): Promise<Board> {
  const where = boardConditions(input, now);
  const sameLead = and(eq(leads.id, deals.leadId), eq(leads.organizationId, deals.organizationId));
  const [rows, totals] = await Promise.all([
    db
      .select({
        ...dealColumns,
        leadName: leads.name,
        company: leads.company,
        hasOpenTask: sql<boolean>`exists (select 1 from ${leadTasks} where ${leadTasks.organizationId} = ${deals.organizationId} and ${leadTasks.leadId} = ${deals.leadId} and ${leadTasks.completedAt} is null)`,
      })
      .from(deals)
      .innerJoin(leads, sameLead)
      .leftJoin(users, eq(users.id, deals.ownerUserId))
      .where(where)
      .orderBy(sql`${deals.expectedCloseOn} asc nulls last`, desc(deals.updatedAt))
      .limit(BOARD_DEALS_LIMIT + 1),
    db
      .select({
        stage: deals.stage,
        count: sql<number>`count(*)::int`,
        amount: sql<string>`coalesce(sum(${deals.amount}), 0)`,
        weighted: sql<string>`coalesce(sum(${deals.amount} * ${deals.probability} / 100), 0)`,
      })
      .from(deals)
      .where(where)
      .groupBy(deals.stage),
  ]);

  const cards: DealCard[] = rows.slice(0, BOARD_DEALS_LIMIT).map((row) => ({
    ...toDealView(row),
    leadName: row.leadName ?? null,
    company: row.company ?? null,
    hasOpenTask: row.hasOpenTask,
  }));
  return {
    columns: DEAL_STAGES.map((stage) => {
      const total = totals.find((t) => t.stage === stage);
      return {
        stage,
        count: total?.count ?? 0,
        amount: Number(total?.amount ?? 0),
        weightedAmount: Number(total?.weighted ?? 0),
        deals: cards.filter((card) => card.stage === stage),
      };
    }),
    truncated: rows.length > BOARD_DEALS_LIMIT,
    today: jstDate(now),
  };
}

/** Deals of a lead, oldest first; undefined when the lead is not found */
export async function listLeadDeals(
  db: Database,
  input: { organizationId: string; leadId: string }
): Promise<DealView[] | undefined> {
  const [lead] = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.id, input.leadId), eq(leads.organizationId, input.organizationId)));
  if (!lead) return undefined;
  const rows = await db
    .select(dealColumns)
    .from(deals)
    .leftJoin(users, eq(users.id, deals.ownerUserId))
    .where(and(eq(deals.organizationId, input.organizationId), eq(deals.leadId, input.leadId)))
    .orderBy(asc(deals.createdAt), asc(deals.id));
  return rows.map(toDealView);
}

const linkedColumns = { id: deals.id, name: deals.name, kind: deals.kind, stage: deals.stage };
const toLinked = (row: { id: string; name: string; kind: string; stage: string }): LinkedDeal => ({
  id: row.id,
  name: row.name,
  kind: oneOf(DEAL_KINDS, row.kind, 'other'),
  stage: oneOf(DEAL_STAGES, row.stage, 'qualification'),
});

/** One deal with its lead, the deals before and after it, and its history */
export async function getDeal(
  db: Database,
  input: { organizationId: string; dealId: string }
): Promise<DealDetail | undefined> {
  const [row] = await db
    .select({
      ...dealColumns,
      leadName: leads.name,
      company: leads.company,
      leadStatus: leads.status,
    })
    .from(deals)
    .innerJoin(
      leads,
      and(eq(leads.id, deals.leadId), eq(leads.organizationId, deals.organizationId))
    )
    .leftJoin(users, eq(users.id, deals.ownerUserId))
    .where(and(eq(deals.id, input.dealId), eq(deals.organizationId, input.organizationId)));
  if (!row) return undefined;

  const changedBy = sql<
    string | null
  >`(select coalesce(nullif(trim(u.name), ''), u.email) from ${users} u where u.id = ${dealHistory.changedBy})`;
  const [previous, next, history] = await Promise.all([
    row.previousDealId
      ? db
          .select(linkedColumns)
          .from(deals)
          .where(
            and(eq(deals.id, row.previousDealId), eq(deals.organizationId, input.organizationId))
          )
      : Promise.resolve([]),
    db
      .select(linkedColumns)
      .from(deals)
      .where(and(eq(deals.previousDealId, row.id), eq(deals.organizationId, input.organizationId)))
      .orderBy(asc(deals.createdAt)),
    db
      .select({
        ...getTableColumns(dealHistory),
        ownerName: nameOf(users),
        changedByName: changedBy,
      })
      .from(dealHistory)
      .leftJoin(users, eq(users.id, dealHistory.ownerUserId))
      .where(
        and(eq(dealHistory.dealId, row.id), eq(dealHistory.organizationId, input.organizationId))
      )
      .orderBy(desc(dealHistory.changedAt), desc(dealHistory.id))
      .limit(DEAL_HISTORY_LIMIT),
  ]);

  return {
    ...toDealView(row),
    lead: { id: row.leadId, name: row.leadName, company: row.company, status: row.leadStatus },
    previousDeal: previous[0] ? toLinked(previous[0]) : null,
    nextDeals: next.map(toLinked),
    history: history.map((h) => ({
      id: h.id,
      kind: oneOf(DEAL_KINDS, h.kind, 'other'),
      stage: oneOf(DEAL_STAGES, h.stage, 'qualification'),
      amount: h.amount ?? null,
      probability: h.probability,
      forecastOverride: orNull(FORECAST_OVERRIDES, h.forecastOverride),
      expectedCloseOn: h.expectedCloseOn ?? null,
      ownerUserId: h.ownerUserId ?? null,
      ownerName: h.ownerName ?? null,
      changedFields: Array.isArray(h.changedFields) ? h.changedFields : [],
      changedByName: h.changedByName ?? null,
      changedAt: h.changedAt,
    })),
  };
}

/** Lock the lead (taken before the deal, see the header) and read it */
async function lockLead(tx: Transaction, organizationId: string, leadId: string): Promise<Lead> {
  const scope = and(eq(leads.id, leadId), eq(leads.organizationId, organizationId));
  await tx.execute(sql`select 1 from ${leads} where ${scope} for no key update`);
  const lead = await tx.query.leads.findFirst({ where: scope });
  if (!lead) throw notFound('lead');
  return lead;
}

/** The owner to store: a member who can hold leads of the organization, or nobody */
async function resolveOwner(
  tx: Transaction,
  organizationId: string,
  userId: string | null
): Promise<string | null> {
  if (!userId) return null;
  const member = await findAssignableMember(tx, organizationId, userId);
  if (!member) throw badRequest('The owner must be a member who can hold leads');
  return member.userId;
}

async function assertPreviousDeal(
  tx: Transaction,
  organizationId: string,
  previousDealId: string
): Promise<void> {
  const [found] = await tx
    .select({ id: deals.id })
    .from(deals)
    .where(and(eq(deals.id, previousDealId), eq(deals.organizationId, organizationId)));
  if (!found) throw badRequest('The previous deal was not found');
}

function historyRow(deal: DealRow, changedFields: string[], userId: string, at: Date) {
  return {
    organizationId: deal.organizationId,
    dealId: deal.id,
    kind: deal.kind,
    stage: deal.stage,
    amount: deal.amount,
    probability: deal.probability,
    forecastOverride: deal.forecastOverride,
    expectedCloseOn: deal.expectedCloseOn,
    ownerUserId: deal.ownerUserId,
    changedFields,
    changedBy: userId,
    changedAt: at,
  };
}

type AuditValues = Partial<Record<(typeof AUDITED_FIELDS)[number], string | number | null>>;

function auditValues(deal: DealRow): AuditValues {
  const values: AuditValues = {};
  for (const field of AUDITED_FIELDS) values[field] = deal[field] ?? null;
  return values;
}

/** Move the (locked) lead forward for its deals and audit it; null when nothing changed */
async function moveLeadForward(
  tx: Transaction,
  lead: Lead,
  context: { organizationId: string; userId: string; dealId: string; at: Date }
): Promise<LeadMove | null> {
  const leadDeals = await tx
    .select({
      kind: deals.kind,
      stage: deals.stage,
      lostReason: deals.lostReason,
      closedOn: deals.closedOn,
      updatedAt: deals.updatedAt,
    })
    .from(deals)
    .where(and(eq(deals.organizationId, context.organizationId), eq(deals.leadId, lead.id)));
  const changes = leadChangesFromDeals(lead, leadDeals);
  if (Object.keys(changes).length === 0) return null;

  const set: PgUpdateSetSource<typeof leads> = { updatedAt: context.at };
  if (changes.status) Object.assign(set, statusUpdateFields(changes.status));
  if (changes.hasNegotiated) set.hasNegotiated = true;
  if (changes.lostReason !== undefined) set.lostReason = changes.lostReason;
  if (changes.dealPhase) {
    set.dealPhase = changes.dealPhase;
    // The first day of each phase is kept (the existing date wins), as in leads.update (#83)
    set.dealPhaseReachedAt = sql`jsonb_build_object(${changes.dealPhase}::text, ${jstDate(context.at)}::text) || coalesce(${leads.dealPhaseReachedAt}, '{}'::jsonb)`;
  }
  const [after] = await tx
    .update(leads)
    .set(set)
    .where(and(eq(leads.id, lead.id), eq(leads.organizationId, context.organizationId)))
    .returning();
  if (!after) return null;

  const audit = diffLeadAudit(leadAuditSnapshot(lead), leadAuditSnapshot(after));
  if (audit) {
    await writeLeadAuditLogs(
      tx,
      { organizationId: context.organizationId, userId: context.userId, at: context.at },
      [{ action: 'update', leadId: lead.id, changes: audit, metadata: { dealId: context.dealId } }]
    );
  }
  return { before: lead, after, handedOff: isFirstHandoff(lead, after.dealPhaseReachedAt) };
}

/** Create a deal for a lead; the owner defaults to the lead's assignee, then to the creator */
export async function createDeal(
  db: Database,
  input: CreateDealInput & { userId: string },
  now: Date = new Date()
): Promise<DealChangeResult> {
  return db.transaction(async (tx) => {
    const lead = await lockLead(tx, input.organizationId, input.leadId);

    let ownerUserId: string | null;
    if (input.ownerUserId === undefined) {
      const candidates = [lead.assigneeUserId, input.userId].filter((id): id is string => !!id);
      ownerUserId = null;
      for (const candidate of candidates) {
        const member = await findAssignableMember(tx, input.organizationId, candidate);
        if (member) {
          ownerUserId = member.userId;
          break;
        }
      }
    } else {
      ownerUserId = await resolveOwner(tx, input.organizationId, input.ownerUserId);
    }
    if (input.previousDealId) {
      await assertPreviousDeal(tx, input.organizationId, input.previousDealId);
    }

    const stage = input.stage;
    const lost = stage === 'lost';
    if (lost && !input.lostReason) throw badRequest('A lost deal needs a lost reason');
    const targetSystem =
      input.targetSystem !== undefined
        ? input.targetSystem
        : targetSystemEnum.safeParse(lead.targetSystem).success
          ? (lead.targetSystem as TargetSystem)
          : null;

    const [deal] = await tx
      .insert(deals)
      .values({
        organizationId: input.organizationId,
        leadId: lead.id,
        name: input.name,
        kind: input.kind,
        stage,
        amount: input.amount ?? null,
        probability: input.probability ?? STAGE_PROBABILITY[stage],
        forecastOverride: isOpenStage(stage) ? (input.forecastOverride ?? null) : null,
        expectedCloseOn: input.expectedCloseOn ?? null,
        closedOn: isOpenStage(stage) ? null : jstDate(now),
        lostReason: lost ? (input.lostReason ?? null) : null,
        lostNote: lost ? (input.lostNote ?? null) : null,
        competitor: input.competitor ?? null,
        targetSystem,
        nextStep: input.nextStep ?? null,
        ownerUserId,
        previousDealId: input.previousDealId ?? null,
        stageChangedAt: now,
        createdBy: input.userId,
        updatedBy: input.userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await tx.insert(dealHistory).values(historyRow(deal, ['created'], input.userId, now));
    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      userId: input.userId,
      action: 'create',
      resource: DEAL_AUDIT_RESOURCE,
      resourceId: deal.id,
      changes: { after: auditValues(deal) },
      metadata: { leadId: lead.id },
      createdAt: now,
    });

    const leadMove = await moveLeadForward(tx, lead, {
      organizationId: input.organizationId,
      userId: input.userId,
      dealId: deal.id,
      at: now,
    });
    const [withOwner] = await tx
      .select(dealColumns)
      .from(deals)
      .leftJoin(users, eq(users.id, deals.ownerUserId))
      .where(and(eq(deals.id, deal.id), eq(deals.organizationId, input.organizationId)));
    return { deal: toDealView(withOwner), lead: leadMove };
  });
}

/**
 * Change a deal. Only the fields sent change. Moving to another stage resets the probability to
 * the stage's default (unless one is sent); won and lost set the close day, reopening clears it
 * with the lost reason; a lost deal needs a lost reason.
 */
export async function updateDeal(
  db: Database,
  input: UpdateDealInput & { userId: string },
  now: Date = new Date()
): Promise<DealChangeResult> {
  return db.transaction(async (tx) => {
    const scope = and(eq(deals.id, input.dealId), eq(deals.organizationId, input.organizationId));
    // The lead before the deal (the lock order of the header); a deal never moves to another lead
    const [ref] = await tx.select({ leadId: deals.leadId }).from(deals).where(scope);
    if (!ref) throw notFound('deal');
    const lead = await lockLead(tx, input.organizationId, ref.leadId);
    // NO KEY UPDATE: the id does not change, and it does not block the key-share locks that a
    // deal pointing at this one as its previous deal takes
    const [existing] = await tx.select().from(deals).where(scope).for('no key update');
    if (!existing) throw notFound('deal');

    const stage = input.stage ?? oneOf(DEAL_STAGES, existing.stage, 'qualification');
    const stageChanged = stage !== existing.stage;
    const open = isOpenStage(stage);
    const lost = stage === 'lost';

    const lostReason = lost
      ? input.lostReason !== undefined
        ? input.lostReason
        : existing.lostReason
      : null;
    if (lost && !lostReason) throw badRequest('A lost deal needs a lost reason');

    let closedOn: string | null = null;
    if (!open) {
      closedOn =
        input.closedOn ?? (stageChanged || !existing.closedOn ? jstDate(now) : existing.closedOn);
    }

    const ownerUserId =
      input.ownerUserId === undefined
        ? existing.ownerUserId
        : input.ownerUserId === existing.ownerUserId
          ? existing.ownerUserId
          : await resolveOwner(tx, input.organizationId, input.ownerUserId);

    let previousDealId = existing.previousDealId;
    if (input.previousDealId !== undefined) {
      if (input.previousDealId === existing.id) {
        throw badRequest('A deal cannot follow itself');
      }
      if (input.previousDealId && input.previousDealId !== existing.previousDealId) {
        await assertPreviousDeal(tx, input.organizationId, input.previousDealId);
      }
      previousDealId = input.previousDealId ?? null;
    }

    const pick = <K extends keyof UpdateDealInput & keyof DealRow>(key: K): DealRow[K] =>
      (input[key] !== undefined ? input[key] : existing[key]) as DealRow[K];

    const [updated] = await tx
      .update(deals)
      .set({
        name: pick('name'),
        kind: pick('kind'),
        stage,
        amount: pick('amount') ?? null,
        probability:
          input.probability ?? (stageChanged ? STAGE_PROBABILITY[stage] : existing.probability),
        forecastOverride: open ? (pick('forecastOverride') ?? null) : null,
        expectedCloseOn: pick('expectedCloseOn') ?? null,
        closedOn,
        lostReason,
        lostNote: lost ? (pick('lostNote') ?? null) : null,
        competitor: pick('competitor') ?? null,
        targetSystem: pick('targetSystem') ?? null,
        nextStep: pick('nextStep') ?? null,
        ownerUserId,
        previousDealId,
        stageChangedAt: stageChanged ? now : existing.stageChangedAt,
        updatedBy: input.userId,
        updatedAt: now,
      })
      .where(scope)
      .returning();

    const changedHistory = HISTORY_FIELDS.filter((field) => existing[field] !== updated[field]);
    if (changedHistory.length > 0) {
      await tx.insert(dealHistory).values(historyRow(updated, changedHistory, input.userId, now));
    }
    const before = auditValues(existing);
    const after = auditValues(updated);
    const changedAudit = AUDITED_FIELDS.filter((field) => before[field] !== after[field]);
    const changedText = TEXT_FIELDS.filter((field) => existing[field] !== updated[field]);
    if (changedAudit.length > 0 || changedText.length > 0) {
      await tx.insert(auditLogs).values({
        organizationId: input.organizationId,
        userId: input.userId,
        action: 'update',
        resource: DEAL_AUDIT_RESOURCE,
        resourceId: existing.id,
        changes: {
          before: Object.fromEntries(changedAudit.map((field) => [field, before[field]])),
          after: Object.fromEntries(changedAudit.map((field) => [field, after[field]])),
        },
        metadata: {
          leadId: existing.leadId,
          ...(changedText.length > 0 ? { changedText } : {}),
        },
        createdAt: now,
      });
    }

    const movesLead =
      stageChanged || existing.kind !== updated.kind || existing.lostReason !== updated.lostReason;
    const leadMove = movesLead
      ? await moveLeadForward(tx, lead, {
          organizationId: input.organizationId,
          userId: input.userId,
          dealId: existing.id,
          at: now,
        })
      : null;
    const [withOwner] = await tx
      .select(dealColumns)
      .from(deals)
      .leftJoin(users, eq(users.id, deals.ownerUserId))
      .where(scope);
    return { deal: toDealView(withOwner), lead: leadMove };
  });
}

/** Delete a deal (the lead is left as it is) and audit it */
export async function deleteDeal(
  db: Database,
  input: { organizationId: string; dealId: string; userId: string },
  now: Date = new Date()
): Promise<{ id: string; leadId: string }> {
  return db.transaction(async (tx) => {
    const scope = and(eq(deals.id, input.dealId), eq(deals.organizationId, input.organizationId));
    const [existing] = await tx.select().from(deals).where(scope).for('update');
    if (!existing) throw notFound('deal');
    await tx.delete(deals).where(scope);
    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      userId: input.userId,
      action: 'delete',
      resource: DEAL_AUDIT_RESOURCE,
      resourceId: existing.id,
      changes: {
        before: {
          name: existing.name,
          kind: existing.kind,
          stage: existing.stage,
          amount: existing.amount ?? null,
        },
      },
      metadata: { leadId: existing.leadId },
      createdAt: now,
    });
    return { id: existing.id, leadId: existing.leadId };
  });
}

/**
 * After the commit of a deal change: the lead's webhooks and, when the lead moved on from the
 * initial hearing for the first time, the handoff notice. Failures never undo the change.
 */
export async function afterDealChange(
  db: Database,
  context: { organizationId: string; userId: string },
  result: DealChangeResult
): Promise<void> {
  const move = result.lead;
  if (!move) return;
  emitLeadEvents(context.organizationId, leadChangeEvents(move.before, move.after), {
    database: db,
  });
  if (move.handedOff) {
    await notifyLeadHandoff(db, {
      organizationId: context.organizationId,
      leadId: move.after.id,
      userId: context.userId,
    });
  }
}
