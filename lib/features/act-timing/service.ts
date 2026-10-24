/**
 * "When to act" of leads (Refs #151): computed from the latest hearing, the latest AX diagnosis
 * answer and the organization settings (./compute.ts), kept on leads.act_by for the list, and a
 * next action (source 'act_timing', #85) due noticeMonths before it, so the existing due notices
 * tell the assignee.
 *
 * - Leads won, and leads lost for a reason other than timing, are not followed: their open
 *   next action of this kind is removed. A lead lost for timing is followed (#151).
 * - One open next action per lead. Its title names the month, so a recompute that finds the same
 *   month leaves it (and its notices) alone; a new month moves it. A done one for the same month
 *   is not created again.
 * - Recomputed when a hearing is saved or deleted, when the settings change, and each morning
 *   for the leads updated in the last days (diagnosis answers, status changes).
 */
import type { db as defaultDb } from '@/lib/db/client';
import {
  diagnosticSubmissions,
  leadHearings,
  leadTasks,
  leads,
  organizations,
} from '@/lib/db/schema';
import { AX_MIGRATION_DIAGNOSTIC_KEY } from '@/lib/features/diagnostics/ax-migration/definition';
import { parseStoredHearingFields } from '@/lib/features/lead-hearings/types/schemas';
import { jstDate } from '@/lib/features/leads/types/pipeline';
import { reportServerError } from '@/lib/ops/alert';
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { type ActTiming, computeActTiming } from './compute';
import { type ActTimingSettings, readActTimingSettings } from './types/schemas';

/** The database or a transaction */
type Database = Pick<typeof defaultDb, 'select' | 'insert' | 'update' | 'delete'>;

/** Leads updated within this many days are recomputed by the morning run */
export const RECOMPUTE_RECENT_DAYS = 2;
/** Leads the morning run reads per page; it reads page after page until done or out of time */
export const RECOMPUTE_BATCH = 100;
/**
 * Time the morning run spends recomputing: it shares the function's time limit (30 s on
 * Vercel) with the due notices that follow, so it stops early and leaves the rest (the oldest
 * updates) for tomorrow
 */
export const RECOMPUTE_TIME_BUDGET_MS = 10_000;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ActTimingState {
  timing: ActTiming | null;
  /** Not won, and not lost for a reason other than timing */
  followed: boolean;
  settings: ActTimingSettings;
}

const isFollowed = (lead: { status: string; lostReason: string | null }) =>
  lead.status !== 'won' && (lead.status !== 'lost' || lead.lostReason === 'timing');

const monthLabel = (month: string) => {
  const [year, mon] = month.split('-');
  return `${year}年${Number(mon)}月`;
};

/** Title of the next action: names the month, so the same month is recognised again */
export const actTimingTaskTitle = (actBy: string) =>
  `動くべき時期（${monthLabel(actBy)}）の前に再接触する`;

export async function getActTimingSettings(
  db: Database,
  organizationId: string
): Promise<ActTimingSettings> {
  const [org] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  return readActTimingSettings(org?.settings);
}

/** Compute the lead's state; null when the lead is not found */
export async function computeLeadActTiming(
  db: Database,
  input: { organizationId: string; leadId: string },
  settings?: ActTimingSettings
): Promise<
  (ActTimingState & { lead: { assigneeUserId: string | null; actBy: string | null } }) | null
> {
  const [[lead], [hearing], [submission], resolved] = await Promise.all([
    db
      .select({
        status: leads.status,
        lostReason: leads.lostReason,
        assigneeUserId: leads.assigneeUserId,
        actBy: leads.actBy,
      })
      .from(leads)
      .where(and(eq(leads.id, input.leadId), eq(leads.organizationId, input.organizationId))),
    db
      .select({ fields: leadHearings.fields })
      .from(leadHearings)
      .where(
        and(
          eq(leadHearings.leadId, input.leadId),
          eq(leadHearings.organizationId, input.organizationId)
        )
      )
      .orderBy(desc(leadHearings.heldOn), desc(leadHearings.createdAt), desc(leadHearings.id))
      .limit(1),
    db
      .select({
        answers: diagnosticSubmissions.answers,
        createdAt: diagnosticSubmissions.createdAt,
      })
      .from(diagnosticSubmissions)
      .where(
        and(
          eq(diagnosticSubmissions.leadId, input.leadId),
          eq(diagnosticSubmissions.organizationId, input.organizationId),
          eq(diagnosticSubmissions.diagnosticKey, AX_MIGRATION_DIAGNOSTIC_KEY)
        )
      )
      .orderBy(desc(diagnosticSubmissions.createdAt))
      .limit(1),
    settings ? Promise.resolve(settings) : getActTimingSettings(db, input.organizationId),
  ]);
  if (!lead) return null;

  const fields = hearing ? parseStoredHearingFields(hearing.fields).fields : {};
  const value = (key: 'hardwareSupportEnd' | 'earliestRetirement' | 'fiscalYearEndMonth') =>
    fields[key]?.value;
  const supportEnd = submission?.answers.support_end;
  const timing = computeActTiming(
    {
      hardwareSupportEnd: value('hardwareSupportEnd') as string | undefined,
      earliestRetirement: value('earliestRetirement') as string | undefined,
      fiscalYearEndMonth: value('fiscalYearEndMonth') as number | undefined,
      diagnosisSupportEnd:
        typeof supportEnd === 'string' && submission
          ? { answer: supportEnd, answeredOn: jstDate(submission.createdAt) }
          : null,
    },
    resolved
  );
  return {
    timing,
    followed: isFollowed(lead),
    settings: resolved,
    lead: { assigneeUserId: lead.assigneeUserId, actBy: lead.actBy },
  };
}

/** Keep leads.act_by and the lead's next action in line with the computed state */
export async function recomputeActTiming(
  db: Database,
  input: { organizationId: string; leadId: string; userId: string | null },
  options: { now?: Date; settings?: ActTimingSettings } = {}
): Promise<ActTimingState | null> {
  const now = options.now ?? new Date();
  const state = await computeLeadActTiming(db, input, options.settings);
  if (!state) return null;
  const actBy = state.timing ? `${state.timing.actBy}-01` : null;
  if (actBy !== state.lead.actBy) {
    await db
      .update(leads)
      .set({ actBy })
      .where(and(eq(leads.id, input.leadId), eq(leads.organizationId, input.organizationId)));
  }

  const scope = and(
    eq(leadTasks.leadId, input.leadId),
    eq(leadTasks.organizationId, input.organizationId),
    eq(leadTasks.source, 'act_timing')
  );
  if (!state.timing || !state.followed) {
    await db.delete(leadTasks).where(and(scope, isNull(leadTasks.completedAt)));
    return state;
  }

  const title = actTimingTaskTitle(state.timing.actBy);
  const today = jstDate(now);
  const dueOn = state.timing.noticeOn > today ? state.timing.noticeOn : today;
  const tasks = await db
    .select({ id: leadTasks.id, title: leadTasks.title, completedAt: leadTasks.completedAt })
    .from(leadTasks)
    .where(scope);
  const open = tasks.find((task) => task.completedAt === null);
  if (open?.title === title) return state;
  if (open) {
    await db
      .update(leadTasks)
      .set({
        title,
        dueOn,
        notifiedDueAt: null,
        notifiedOverdueAt: null,
        updatedAt: now,
        ...(input.userId ? { updatedBy: input.userId } : {}),
      })
      .where(eq(leadTasks.id, open.id));
    return state;
  }
  // Already done for this month: not again
  if (tasks.some((task) => task.title === title)) return state;
  await db.insert(leadTasks).values({
    organizationId: input.organizationId,
    leadId: input.leadId,
    title,
    dueOn,
    source: 'act_timing',
    createdBy: input.userId ?? state.lead.assigneeUserId,
    updatedBy: input.userId,
    createdAt: now,
    updatedAt: now,
  });
  return state;
}

/** Recompute every lead of the organization that could have a "when to act" (settings change) */
export async function recomputeOrganization(
  db: Database,
  organizationId: string,
  userId: string | null,
  now: Date = new Date()
): Promise<number> {
  const settings = await getActTimingSettings(db, organizationId);
  const rows = await db
    .select({ id: leads.id })
    .from(leads)
    .where(
      and(
        eq(leads.organizationId, organizationId),
        sql`(${leads.actBy} is not null or exists (select 1 from lead_hearings h where h.lead_id = ${leads.id}) or exists (select 1 from diagnostic_submissions s where s.lead_id = ${leads.id}))`
      )
    );
  for (const row of rows) {
    await recomputeActTiming(db, { organizationId, leadId: row.id, userId }, { now, settings });
  }
  return rows.length;
}

/** What the morning run did, returned to the cron (and its JSON response) */
export interface MorningRunResult {
  recomputed: number;
  /**
   * Leads of the window the run did not reach, cut short at its time limit. They are the
   * oldest updates, so most of them the previous run recomputed while they were new
   */
  pending: number;
  /**
   * Of the pending leads, those updated within the last day, which the previous run (a day
   * earlier) could not have read. More than none means a day's updates no longer fit in the
   * time budget: it is reported, the cue to revisit the decision 2026-10-24-act-timing-morning-run
   */
  unseen: number;
  /** Leads whose recompute threw: logged, reported once, and the run went on with the next */
  failed: number;
}

/**
 * The morning run: every lead updated in the last days (diagnosis answers, status changes), of
 * every organization, a page at a time, until none is left or the time is up (#374).
 *
 * Newest update first: a run cut short leaves the oldest updates, which the previous run had
 * already reached while they were new, rather than the ones no run has seen yet. Each lead is
 * recomputed in its own organization with that organization's settings; one that fails does
 * not stop the others.
 *
 * The time is checked before each lead and before each further page. The page reads and the
 * count of the leads left are not bounded by it: leads.updated_at has no index (adding one
 * needs a migration), so they scan the table. At today's number of leads they take little.
 */
export async function recomputeRecentlyUpdated(
  db: Database,
  now: Date = new Date(),
  options: { timeBudgetMs?: number; clock?: () => number } = {}
): Promise<MorningRunResult> {
  const clock = options.clock ?? Date.now;
  const startedAt = clock();
  const budget = options.timeBudgetMs ?? RECOMPUTE_TIME_BUDGET_MS;
  const outOfTime = () => clock() - startedAt > budget;
  const since = new Date(now.getTime() - RECOMPUTE_RECENT_DAYS * DAY_MS);
  const dayBefore = new Date(now.getTime() - DAY_MS);
  // The last lead reached. Its update time is kept as text: a Date would drop the microseconds
  // and skip, or read again, the leads updated within the same millisecond
  let last: { updatedAt: string; id: string } | null = null;
  const notReached = () =>
    and(
      gte(leads.updatedAt, since),
      last
        ? sql`(${leads.updatedAt}, ${leads.id}) < (${last.updatedAt}::timestamp, ${last.id}::uuid)`
        : undefined
    );
  const settingsByOrg = new Map<string, ActTimingSettings>();
  let recomputed = 0;
  let failed = 0;
  let firstFailure: unknown;

  const finish = async (left: { pending: number; unseen: number }) => {
    if (failed > 0) {
      await reportServerError('cron/act-timing-lead', firstFailure);
    }
    if (left.unseen > 0) {
      // The counts only, never lead data
      await reportServerError(
        'cron/act-timing-time-limit',
        new Error(`${left.unseen} leads updated within the last day were not reached`)
      );
    }
    return { recomputed, failed, ...left };
  };
  const cutShort = async () => {
    const [left] = await db
      .select({
        pending: sql<number>`count(*)::int`,
        unseen: sql<number>`(count(*) filter (where ${gte(leads.updatedAt, dayBefore)}))::int`,
      })
      .from(leads)
      .where(notReached());
    const pending = left?.pending ?? 0;
    const unseen = left?.unseen ?? 0;
    console.warn(
      `When to act: the morning run stopped at its time limit; ${pending} leads of the window not reached, ${unseen} of them updated within the last day (no earlier run read those)`
    );
    return finish({ pending, unseen });
  };

  let more = true;
  while (more) {
    const page = await db
      .select({
        id: leads.id,
        organizationId: leads.organizationId,
        updatedAt: sql<string>`${leads.updatedAt}::text`,
      })
      .from(leads)
      .where(notReached())
      .orderBy(desc(leads.updatedAt), desc(leads.id))
      .limit(RECOMPUTE_BATCH);
    for (const row of page) {
      if (outOfTime()) return cutShort();
      try {
        let settings = settingsByOrg.get(row.organizationId);
        if (!settings) {
          settings = await getActTimingSettings(db, row.organizationId);
          settingsByOrg.set(row.organizationId, settings);
        }
        await recomputeActTiming(
          db,
          { organizationId: row.organizationId, leadId: row.id, userId: null },
          { now, settings }
        );
        recomputed += 1;
      } catch (error) {
        // One lead must not hold back the older ones: the next run tries it again while it is
        // in the window
        console.error(`When to act: the morning run failed on lead ${row.id}:`, error);
        if (failed === 0) firstFailure = error;
        failed += 1;
      }
      last = { updatedAt: row.updatedAt, id: row.id };
    }
    more = page.length === RECOMPUTE_BATCH;
    if (more && outOfTime()) return cutShort();
  }
  return finish({ pending: 0, unseen: 0 });
}

/** Save the organization's settings (merged into organizations.settings) */
export async function saveActTimingSettings(
  db: Database,
  organizationId: string,
  settings: ActTimingSettings
): Promise<void> {
  await db
    .update(organizations)
    .set({
      settings: sql`coalesce(${organizations.settings}, '{}'::jsonb) || jsonb_build_object('actTiming', ${JSON.stringify(settings)}::jsonb)`,
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, organizationId));
}

/**
 * After a hearing changed: recompute, never failing the hearing save (the morning run catches
 * up when this fails)
 */
export async function refreshActTimingAfterHearing(
  db: Database,
  input: { organizationId: string; leadId: string; userId: string | null }
): Promise<void> {
  try {
    await recomputeActTiming(db, input);
  } catch (error) {
    console.error('When to act: recompute after a hearing failed:', error);
  }
}
