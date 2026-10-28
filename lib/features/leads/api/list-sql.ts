/**
 * SQL for the lead list (#131): the filters and the sort order of `leads.list`.
 *
 * Every condition here is combined with the organization condition by the caller, so the list
 * never shows another organization's leads.
 */
import { leads } from '@/lib/db/schema';
import { ACT_TIMING_SOON_MONTHS } from '@/lib/features/act-timing/types/schemas';
import { AX_MQL_LEVELS, type AxMqlLevel } from '@/lib/features/diagnostics/ax-migration/mql';
import {
  type AnyColumn,
  type SQL,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  not,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import { NEXT_MEETING_CLOSED_STATUSES, addDays, jstWeekStart } from '../list-query';
import { AX_RESPONSES_KEY, BUILDER_RESPONSES_KEY } from '../mql-level';
import { DEAL_PHASES, LEAD_STATUSES, jstDate } from '../types/pipeline';
import { DEAL_RATINGS, type LeadSortKey, type ListLeadsInput } from '../types/schemas';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Start of a Japan calendar day ('YYYY-MM-DD') as an instant */
export function jstDayStart(day: string): Date {
  return new Date(`${day}T00:00:00+09:00`);
}

/** Start of the Japan day after `day`: the exclusive end of a range that includes `day` */
export function jstDayEnd(day: string): Date {
  return new Date(jstDayStart(day).getTime() + DAY_MS);
}

/** Escape LIKE wildcards so a search for "100%" matches the text "100%" */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function oneOrMany<T>(value: T | T[] | null | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Last activity of a lead: the later of the lead's own last update (staff edits, status
 * changes, diagnoses and consultation requests all write `leads.updated_at`) and the last
 * saved hearing. Comments are not counted: #131 left them out while `lead_comments` had no index
 * on `lead_id` (#433 adds one on (lead_id, created_at), so counting them is a choice for later).
 *
 * `lead_hearings.updated_at` is timestamptz while `leads.updated_at` is a UTC timestamp
 * without time zone, so the hearing time is converted to UTC wall time before comparing.
 * greatest() ignores NULL, so a lead without hearings uses its own update time.
 *
 * The hearing side is written as plain SQL with its own alias: inside a relational query
 * (`db.query.leads.findMany`) Drizzle renders every column object with the root table's
 * alias, which would turn `lead_hearings.lead_id` into `leads.lead_id`.
 */
export const leadLastActivityAt = sql<string>`greatest(${leads.updatedAt}, (select max(h.updated_at) at time zone 'UTC' from lead_hearings h where h.lead_id = ${leads.id} and h.organization_id = ${leads.organizationId}))`;

/**
 * A value of the lead's latest hearing (#137). "Latest" is the hearing with the latest held_on,
 * then the latest created_at, then the highest id: the same order as the lead page's hearing
 * list. Read with the (organization_id, lead_id, held_on) index, one row per lead.
 *
 * `valid` is a condition on the value (`v`) that keeps broken or unknown values out (NULL).
 * Plain SQL with its own alias, for the same reason as leadLastActivityAt.
 */
function latestHearingValue(fieldKey: string, valid: SQL): SQL<string | null> {
  const value = sql.raw(`(h.fields -> '${fieldKey}' ->> 'value')`);
  return sql<
    string | null
  >`(select case when ${valid} then ${value} end from lead_hearings h where h.lead_id = ${leads.id} and h.organization_id = ${leads.organizationId} order by h.held_on desc, h.created_at desc, h.id desc limit 1)`;
}

/**
 * A value of this file nested one level, for a select from leads without a join: pass every
 * value of this file through it there. Without a join drizzle writes the columns at the top of a
 * selected SQL without their table ("id"), and inside a correlated subquery "id" is the
 * subquery's own column (meeting_requests.id, lead_hearings.id): no error, another condition, and
 * the organization condition can become always true. Nested, they keep "leads"."id". WHERE,
 * ORDER BY and selects with a join write the table already (#556)
 */
export const nested = <T>(expression: SQL<T>): SQL<T> => sql<T>`${expression}`;

/**
 * Who recorded the lead's latest hearing (the same "latest" as latestHearingValue); NULL without a
 * hearing or when the account is gone (#556)
 */
const latestHearingAuthor = sql<
  string | null
>`(select h.created_by from lead_hearings h where h.lead_id = ${leads.id} and h.organization_id = ${leads.organizationId} order by h.held_on desc, h.created_at desc, h.id desc limit 1)`;

/**
 * Whether the lead has a deal (#435): its status and deal phase then come from the deals and are
 * not changed by hand (#444). Raw table name: drizzle aliases a joined table in the relational
 * queries
 */
export const leadHasDeals = sql<boolean>`exists (select 1 from deals d where d.lead_id = ${leads.id} and d.organization_id = ${leads.organizationId})`;

/** The next meeting date the latest hearing records ('YYYY-MM-DD'; NULL when it records none) */
const hearingNextMeetingDate = latestHearingValue(
  'nextMeetingDate',
  sql.raw(`(h.fields -> 'nextMeetingDate' ->> 'value') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`)
);

/** The first meeting sales confirmed from the respondent's preferred dates (#155), 'YYYY-MM-DD' */
const confirmedMeetingDate = sql<
  string | null
>`(select to_char(mr.confirmed_on, 'YYYY-MM-DD') from meeting_requests mr where mr.lead_id = ${leads.id} and mr.organization_id = ${leads.organizationId})`;

/**
 * Next meeting date, 'YYYY-MM-DD': the one the latest hearing records, else the first meeting
 * sales confirmed from the respondent's preferred dates (#155). NULL when neither exists.
 */
export const leadNextMeetingDate = sql<
  string | null
>`coalesce(${hearingNextMeetingDate}, ${confirmedMeetingDate})`;

/**
 * Time of the next meeting, 'HH:MM' in Japan (#556): hearings record dates only, so it is the
 * confirmed first meeting's time, when that meeting is on the next meeting date. NULL otherwise
 */
export const leadNextMeetingTime = sql<
  string | null
>`(select mr.confirmed_time from meeting_requests mr where mr.lead_id = ${leads.id} and mr.organization_id = ${leads.organizationId} and to_char(mr.confirmed_on, 'YYYY-MM-DD') = ${leadNextMeetingDate})`;

/** The next meeting is the confirmed first meeting (#155), not a date a hearing recorded (#556) */
export const leadNextMeetingIsFirst = sql<boolean>`(${hearingNextMeetingDate} is null and ${confirmedMeetingDate} is not null)`;

/**
 * Who set the next meeting date (#556): whoever recorded the latest hearing when the date is its
 * own, else whoever confirmed the first meeting. NULL without a date or when the account is gone
 */
export const leadNextMeetingSetBy = sql<
  string | null
>`(case when ${hearingNextMeetingDate} is not null then ${latestHearingAuthor} else (select mr.confirmed_by from meeting_requests mr where mr.lead_id = ${leads.id} and mr.organization_id = ${leads.organizationId} and mr.confirmed_on is not null) end)`;

/** Deal rating (a / b / c) of the latest hearing (NULL when it records none) */
export const leadDealRating = latestHearingValue(
  'dealRating',
  sql.raw(
    `(h.fields -> 'dealRating' ->> 'value') in (${DEAL_RATINGS.map((r) => `'${r}'`).join(', ')})`
  )
);

const MQL_LEVEL_LIST = sql.raw(AX_MQL_LEVELS.map((level) => `'${level}'`).join(', '));
/** `responses -> 'key'` of the lead, the summary of one diagnosis */
const responsesSummary = (key: string) => sql`(${leads.responses} -> ${sql.raw(`'${key}'`)})`;

const axSummary = responsesSummary(AX_RESPONSES_KEY);
const builderSummary = responsesSummary(BUILDER_RESPONSES_KEY);
const axMqlLevel = sql`(case when jsonb_typeof(${axSummary}) = 'object' then (case when (${axSummary} -> 'mql' ->> 'level') in (${MQL_LEVEL_LIST}) then (${axSummary} -> 'mql' ->> 'level') when (${axSummary} -> 'mqlCandidate') = 'true'::jsonb then 'fit' else 'none' end) end)`;
const builderMqlLevel = sql`(case when jsonb_typeof(${builderSummary}) = 'object' then (case when (${builderSummary} ->> 'mqlLevel') in (${MQL_LEVEL_LIST}) then (${builderSummary} ->> 'mqlLevel') when (${builderSummary} -> 'mqlQualified') = 'true'::jsonb then 'interest' else 'none' end) end)`;
/**
 * MQL level of the lead (#196): 'interest' | 'fit' | 'none', NULL without a diagnosis summary.
 * The same rules as leadMqlLevel in lib/features/leads/mql-level.ts, read from the stored
 * `responses` in the same query (no query per row):
 * - AX: `mql.level`, else (judged before #139) `mqlCandidate` true = 'fit', else 'none'
 * - builder: `mqlLevel`, else `mqlQualified` true = 'interest', else 'none'
 * and the higher of the two when a lead has both.
 */
export const leadMqlLevel = sql<AxMqlLevel | null>`(select case when 'interest' in (s.ax, s.builder) then 'interest' when 'fit' in (s.ax, s.builder) then 'fit' when 'none' in (s.ax, s.builder) then 'none' end from (select ${axMqlLevel} as ax, ${builderMqlLevel} as builder) s)`;

/**
 * The level the list sorts and filters by (#447): a lead judged MQL (an MQL date, also set by
 * hand without a diagnosis) counts as 関心あり, as its green badge says (LeadMqlBadges). The
 * analytics count leads by it too (#605), so the numbers match the list's filter
 */
export const listMqlLevel = sql<AxMqlLevel | null>`(case when ${leads.mqlQualifiedAt} is not null then 'interest' else ${leadMqlLevel} end)`;

/**
 * The lead is 関心あり (MQL) by the list's MQL level, the whole rule here so a count elsewhere
 * (#700: the QR campaigns' new leads) never names the level itself
 */
export const leadIsInterested = sql`${listMqlLevel} = ${'interest' satisfies AxMqlLevel}`;

/**
 * The lead asked for a consultation (相談申込): its conversion point is 'consultation', which the
 * diagnoses set with the request. The list's consultation filter; the QR campaigns count their
 * new leads by it too (#700)
 */
export const leadRequestedConsultation = eq(leads.conversionPoint, 'consultation');

/**
 * Position in a fixed order (pipeline order instead of alphabetical). Empty and unknown values
 * give NULL, so they go last with the "nulls last" of the ORDER BY.
 */
function pipelineOrder(column: AnyColumn, values: readonly string[]): SQL {
  const cases = values.map((value, index) => sql`when ${value} then ${sql.raw(String(index))}`);
  return sql`(case ${column} ${sql.join(cases, sql` `)} end)`;
}

/** What each sort key sorts by */
const SORT_EXPRESSIONS: Record<LeadSortKey, AnyColumn | SQL> = {
  createdAt: leads.createdAt,
  updatedAt: leads.updatedAt,
  name: leads.name,
  email: leads.email,
  company: leads.company,
  score: leads.score,
  status: pipelineOrder(leads.status, LEAD_STATUSES),
  dealPhase: pipelineOrder(leads.dealPhase, DEAL_PHASES),
  lastActivityAt: leadLastActivityAt,
  mqlQualifiedAt: leads.mqlQualifiedAt,
  // Assignee name (the email when no name); unassigned leads go last. Plain SQL with its own
  // alias for the same reason as leadLastActivityAt (#135)
  assignee: sql`(select coalesce(nullif(trim(u.name), ''), u.email) from users u where u.id = ${leads.assigneeUserId})`,
  // Latest hearing (#137): soonest date first / A first when ascending; none last
  nextMeetingDate: leadNextMeetingDate,
  dealRating: leadDealRating,
  // "When to act" (#151): a date column
  actBy: leads.actBy,
  // 関心あり, 適合, 対象外 when ascending; leads without a diagnosis last (#447)
  mqlLevel: sql`(case ${listMqlLevel} when 'interest' then 0 when 'fit' then 1 when 'none' then 2 end)`,
};

/**
 * ORDER BY of the list. Empty values (no name, no score, no MQL date...) always come last,
 * in both directions. Ties are broken by newest first and then by id, so pages never
 * overlap or skip rows.
 */
export function leadListOrderBy(
  sortBy: LeadSortKey = 'createdAt',
  sortOrder: 'asc' | 'desc' = 'desc'
): SQL[] {
  const expression = SORT_EXPRESSIONS[sortBy];
  const direction = sortOrder === 'asc' ? sql`asc` : sql`desc`;
  const order = [sql`${expression} ${direction} nulls last`];
  if (sortBy !== 'createdAt') order.push(desc(leads.createdAt));
  order.push(sortOrder === 'asc' && sortBy === 'createdAt' ? asc(leads.id) : desc(leads.id));
  return order;
}

/**
 * WHERE conditions of the list filters (without the organization condition and tags, which
 * the procedure adds). Multi-value filters match any of the values.
 */
export function leadListConditions(
  input: Omit<ListLeadsInput, 'limit' | 'offset'>,
  /** The member asking, for the assignee filter 'me' */
  currentUserId?: string,
  /** Clock for "today" and "this week" of the next meeting filter (Japan days) */
  now: Date = new Date()
): SQL[] {
  const conditions: (SQL | undefined)[] = [];

  const statuses = oneOrMany(input.status);
  if (statuses.length > 0) conditions.push(inArray(leads.status, statuses));
  const inflowSources = oneOrMany(input.inflowSource);
  if (inflowSources.length > 0) conditions.push(inArray(leads.inflowSource, inflowSources));
  const dealPhases = oneOrMany(input.dealPhase);
  if (dealPhases.length > 0) conditions.push(inArray(leads.dealPhase, dealPhases));
  const targetSystems = oneOrMany(input.targetSystem);
  if (targetSystems.length > 0) conditions.push(inArray(leads.targetSystem, targetSystems));

  if (input.source) conditions.push(eq(leads.source, input.source));

  const search = input.search?.trim();
  if (search) {
    const term = `%${escapeLike(search)}%`;
    conditions.push(
      or(ilike(leads.name, term), ilike(leads.email, term), ilike(leads.company, term))
    );
  }

  // Instants (kept for older callers)
  if (input.createdFrom) conditions.push(gte(leads.createdAt, new Date(input.createdFrom)));
  if (input.createdTo) conditions.push(lte(leads.createdAt, new Date(input.createdTo)));
  // Japan days, both ends included
  if (input.createdFromDay) {
    conditions.push(gte(leads.createdAt, jstDayStart(input.createdFromDay)));
  }
  if (input.createdToDay) conditions.push(lt(leads.createdAt, jstDayEnd(input.createdToDay)));

  if (input.scoreMin !== undefined) conditions.push(gte(leads.score, input.scoreMin));
  if (input.scoreMax !== undefined) conditions.push(lte(leads.score, input.scoreMax));

  if (input.consultationRequested === true) {
    conditions.push(leadRequestedConsultation);
  } else if (input.consultationRequested === false) {
    conditions.push(or(isNull(leads.conversionPoint), not(leadRequestedConsultation)));
  }

  if (input.mql === true) conditions.push(isNotNull(leads.mqlQualifiedAt));
  else if (input.mql === false) conditions.push(isNull(leads.mqlQualifiedAt));

  if (input.sqlDecision === 'undecided') conditions.push(isNull(leads.sqlDecision));
  else if (input.sqlDecision) conditions.push(eq(leads.sqlDecision, input.sqlDecision));

  // Assignee (#135); 'me' without a member matches nothing rather than everything
  if (input.assignee === 'unassigned') conditions.push(isNull(leads.assigneeUserId));
  else if (input.assignee === 'me') {
    conditions.push(currentUserId ? eq(leads.assigneeUserId, currentUserId) : sql`false`);
  } else if (input.assignee) conditions.push(eq(leads.assigneeUserId, input.assignee));

  // Latest hearing (#137). Dates are 'YYYY-MM-DD' text, so text order is date order
  const nextMeeting = nextMeetingCondition(input.nextMeeting, now);
  if (nextMeeting) conditions.push(nextMeeting);
  const ratings = oneOrMany(input.dealRating);
  if (ratings.length > 0) {
    conditions.push(
      sql`${leadDealRating} in (${sql.join(
        ratings.map((rating) => sql`${rating}`),
        sql`, `
      )})`
    );
  }

  // MQL level (#447): a lead with an MQL date is 関心あり; 'unknown' has no diagnosis and no MQL date
  const levels = oneOrMany(input.mqlLevel);
  if (levels.length > 0) {
    const known = levels.filter((level) => level !== 'unknown');
    const matches = [
      known.length > 0
        ? sql`${listMqlLevel} in (${sql.join(
            known.map((level) => sql`${level}`),
            sql`, `
          )})`
        : undefined,
      levels.includes('unknown') ? sql`${listMqlLevel} is null` : undefined,
    ].filter((c): c is SQL => c !== undefined);
    conditions.push(matches.length === 1 ? matches[0] : (or(...matches) as SQL));
  }

  // "When to act" (#151): set, or within the next months (past ones included)
  if (input.actTiming === 'has') conditions.push(isNotNull(leads.actBy));
  // Nobody comes back to the lead (#446): no "when to act" month and no open next action
  if (input.actTiming === 'none') {
    conditions.push(
      // A past month brings nobody back (actByAhead in act-timing/compute.ts)
      or(isNull(leads.actBy), lt(leads.actBy, `${jstDate(now).slice(0, 7)}-01`)) as SQL,
      sql`not exists (select 1 from lead_tasks t where t.lead_id = ${leads.id} and t.organization_id = ${leads.organizationId} and t.completed_at is null)`
    );
  }
  if (input.actTiming === 'soon') {
    const until = new Date(`${jstDate(now)}T00:00:00Z`);
    until.setUTCMonth(until.getUTCMonth() + ACT_TIMING_SOON_MONTHS);
    conditions.push(lte(leads.actBy, until.toISOString().slice(0, 10)));
  }

  return conditions.filter((c): c is SQL => c !== undefined);
}

/**
 * Condition of the next meeting filter (#137). "overdue": the latest hearing's next meeting
 * date is before today (Japan) — a newer hearing would be the latest one and replace the date,
 * so a passed date means no hearing was recorded for that meeting — and the lead is still open
 * (won and lost leads are left out). "thisWeek": Monday to Sunday
 * of the current Japan week, past days included.
 */
export function nextMeetingCondition(
  filter: ListLeadsInput['nextMeeting'],
  now: Date = new Date()
): SQL | undefined {
  switch (filter) {
    case 'has':
      return sql`${leadNextMeetingDate} is not null`;
    case 'none':
      return sql`${leadNextMeetingDate} is null`;
    case 'overdue':
      return sql`(${leadNextMeetingDate} < ${jstDate(now)} and ${notInArray(leads.status, [...NEXT_MEETING_CLOSED_STATUSES])})`;
    case 'thisWeek': {
      const monday = jstWeekStart(now);
      return sql`${leadNextMeetingDate} between ${monday} and ${addDays(monday, 6)}`;
    }
    default:
      return undefined;
  }
}

/**
 * Read a UTC timestamp without time zone as returned by the driver ('2026-10-15 12:00:00.123').
 * Relational-query extras skip Drizzle's column mapping, so the procedure converts it here.
 */
export function parseUtcTimestamp(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  const date = new Date(`${value.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}
