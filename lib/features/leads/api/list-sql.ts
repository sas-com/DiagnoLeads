/**
 * SQL for the lead list (#131): the filters and the sort order of `leads.list`.
 *
 * Every condition here is combined with the organization condition by the caller, so the list
 * never shows another organization's leads.
 */
import { leads } from '@/lib/db/schema';
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
  ne,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import { NEXT_MEETING_CLOSED_STATUSES, addDays, jstWeekStart } from '../list-query';
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
 * saved hearing. Comments are not counted: `lead_comments` has no index on `lead_id`, and
 * adding one is a schema change (#131 keeps the schema as is).
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

/** Next meeting date of the latest hearing, 'YYYY-MM-DD' (NULL when it records none) */
export const leadNextMeetingDate = latestHearingValue(
  'nextMeetingDate',
  sql.raw(`(h.fields -> 'nextMeetingDate' ->> 'value') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`)
);

/** Deal rating (a / b / c) of the latest hearing (NULL when it records none) */
export const leadDealRating = latestHearingValue(
  'dealRating',
  sql.raw(
    `(h.fields -> 'dealRating' ->> 'value') in (${DEAL_RATINGS.map((r) => `'${r}'`).join(', ')})`
  )
);

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
 * WHERE conditions of the list filters (without the organization condition, tags and the
 * advanced filter, which the procedure adds). Multi-value filters match any of the values.
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
    conditions.push(eq(leads.conversionPoint, 'consultation'));
  } else if (input.consultationRequested === false) {
    conditions.push(or(isNull(leads.conversionPoint), ne(leads.conversionPoint, 'consultation')));
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
