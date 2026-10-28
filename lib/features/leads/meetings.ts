/**
 * Meetings from the hearings, for the dashboard (#137). No schema of its own: everything is read
 * from `lead_hearings` (the latest hearing of a lead for the next meeting, the first one for
 * the KPI).
 *
 * - getWeekMeetings: leads whose latest hearing's next meeting date is in the current Japan
 *   week (Monday to Sunday), earliest first.
 * - getMyMeetings: the user's own meetings from today to Sunday, for 今日 (#556).
 * - getNextMeetingRate: KPI 「初回商談から次回日程が決まった率」, see nextMeetingRate below.
 */
import type { db as defaultDb } from '@/lib/db/client';
import { leads, users } from '@/lib/db/schema';
import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';
import { dashboardPeriod, jstDay } from '../analytics/dashboard';
import {
  leadDealRating,
  leadNextMeetingDate,
  leadNextMeetingIsFirst,
  leadNextMeetingSetBy,
  leadNextMeetingTime,
  nested,
  nextMeetingCondition,
} from './api/list-sql';
import { addDays, jstWeekStart } from './list-query';
import { jstDate } from './types/pipeline';

type Database = typeof defaultDb;

/** Meetings listed on the dashboard card; the rest are in the list (preset 今週の商談) */
export const WEEK_MEETINGS_SHOWN = 10;
/** The user's meetings listed on 今日 (#556); those past it are only counted */
export const MY_MEETINGS_SHOWN = 50;

export interface WeekMeeting {
  leadId: string;
  name: string | null;
  company: string | null;
  /** Lead status: won and lost leads get no "overdue" marker */
  status: string;
  /** 'YYYY-MM-DD' */
  nextMeetingDate: string;
  dealRating: string | null;
  assignee: { id: string; name: string | null; email: string } | null;
}

export async function getWeekMeetings(
  db: Database,
  organizationId: string,
  now: Date = new Date()
): Promise<{
  weekStart: string;
  weekEnd: string;
  today: string;
  total: number;
  items: WeekMeeting[];
}> {
  const weekStart = jstWeekStart(now);
  const where = and(
    eq(leads.organizationId, organizationId),
    nextMeetingCondition('thisWeek', now)
  );
  const [countRows, rows] = await Promise.all([
    db.select({ total: sql<number>`count(*)::int` }).from(leads).where(where),
    db
      .select({
        leadId: leads.id,
        name: leads.name,
        company: leads.company,
        status: leads.status,
        nextMeetingDate: leadNextMeetingDate,
        dealRating: leadDealRating,
        assigneeId: users.id,
        assigneeName: users.name,
        assigneeEmail: users.email,
      })
      .from(leads)
      .leftJoin(users, eq(users.id, leads.assigneeUserId))
      .where(where)
      .orderBy(asc(leadNextMeetingDate), asc(leads.company), asc(leads.id))
      .limit(WEEK_MEETINGS_SHOWN),
  ]);
  return {
    weekStart,
    weekEnd: addDays(weekStart, 6),
    today: jstDay(now),
    total: Number(countRows[0]?.total ?? 0),
    items: rows.map((row) => ({
      leadId: row.leadId,
      name: row.name,
      company: row.company,
      status: row.status,
      nextMeetingDate: row.nextMeetingDate ?? '',
      dealRating: row.dealRating,
      assignee:
        row.assigneeId && row.assigneeEmail
          ? { id: row.assigneeId, name: row.assigneeName, email: row.assigneeEmail }
          : null,
    })),
  };
}

export interface MyMeeting {
  leadId: string;
  name: string | null;
  company: string | null;
  /** Lead status: won and lost leads keep their meetings, as on the dashboard */
  status: string;
  /** 'YYYY-MM-DD' */
  nextMeetingDate: string;
  /** 'HH:MM' in Japan: only a confirmed first meeting has a time (hearings record dates) */
  nextMeetingTime: string | null;
  /** The first meeting confirmed from the respondent's preferred dates (#155) */
  firstMeeting: boolean;
  dealRating: string | null;
  /** Nobody is assigned to the lead: the meeting is the user's because they set the date */
  unassigned: boolean;
}

/**
 * The user's meetings for 今日 (#556): leads whose next meeting date is from today to Sunday of
 * the current Japan week (the passed days of the week are left out; won and lost leads stay, as on
 * the dashboard). The user's are the leads assigned to them, and the leads nobody is assigned to
 * whose date they set (leadNextMeetingSetBy). Soonest first; within a day, the meetings with a
 * time first in time order, then by company. The first MY_MEETINGS_SHOWN, and how many there are.
 */
export async function getMyMeetings(
  db: Database,
  input: { organizationId: string; userId: string },
  now: Date = new Date()
): Promise<{ today: string; weekEnd: string; total: number; items: MyMeeting[] }> {
  const today = jstDate(now);
  const weekEnd = addDays(jstWeekStart(now), 6);
  const where = and(
    eq(leads.organizationId, input.organizationId),
    sql`${leadNextMeetingDate} between ${today} and ${weekEnd}`,
    or(
      eq(leads.assigneeUserId, input.userId),
      and(isNull(leads.assigneeUserId), sql`${leadNextMeetingSetBy} = ${input.userId}`)
    )
  );
  const [countRows, rows] = await Promise.all([
    db.select({ total: sql<number>`count(*)::int` }).from(leads).where(where),
    db
      // From leads alone: each value of list-sql.ts goes through nested()
      .select({
        leadId: leads.id,
        name: leads.name,
        company: leads.company,
        status: leads.status,
        assigneeUserId: leads.assigneeUserId,
        nextMeetingDate: nested(leadNextMeetingDate),
        nextMeetingTime: nested(leadNextMeetingTime),
        firstMeeting: nested(leadNextMeetingIsFirst),
        dealRating: nested(leadDealRating),
      })
      .from(leads)
      .where(where)
      .orderBy(
        asc(leadNextMeetingDate),
        sql`${leadNextMeetingTime} asc nulls last`,
        asc(leads.company),
        asc(leads.id)
      )
      .limit(MY_MEETINGS_SHOWN),
  ]);
  return {
    today,
    weekEnd,
    total: Number(countRows[0]?.total ?? 0),
    items: rows.map((row) => ({
      leadId: row.leadId,
      name: row.name,
      company: row.company,
      status: row.status,
      nextMeetingDate: row.nextMeetingDate ?? '',
      nextMeetingTime: row.nextMeetingTime,
      firstMeeting: Boolean(row.firstMeeting),
      dealRating: row.dealRating,
      unassigned: row.assigneeUserId === null,
    })),
  };
}

/**
 * KPI 「初回商談から次回日程が決まった率」 for the dashboard period:
 *
 *   first meetings  = leads whose first hearing (earliest held_on, then created_at, then id)
 *                     was held in the period (Japan days, today included)
 *   with next date  = of those, the leads whose first hearing records a next meeting date
 *   rate            = with next date / first meetings (null when there was no first meeting)
 *
 * A date entered only in a later hearing does not count: the KPI measures whether the first
 * meeting reached its goal (fixing the next meeting).
 */
export function nextMeetingRate(firstMeetings: number, withNextMeeting: number): number | null {
  return firstMeetings > 0 ? withNextMeeting / firstMeetings : null;
}

export async function getNextMeetingRate(
  db: Database,
  organizationId: string,
  days: number,
  now: Date = new Date()
): Promise<{
  from: string;
  to: string;
  firstMeetings: number;
  withNextMeeting: number;
  rate: number | null;
}> {
  const from = jstDay(dashboardPeriod(days, now).from);
  const to = jstDay(now);
  const result = await db.execute<{ first_meetings: number; with_next: number }>(sql`
    select
      count(*)::int as first_meetings,
      count(*) filter (
        where (f.fields -> 'nextMeetingDate' ->> 'value') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      )::int as with_next
    from (
      select distinct on (h.lead_id) h.lead_id, h.held_on, h.fields
      from lead_hearings h
      where h.organization_id = ${organizationId}
      order by h.lead_id, h.held_on asc, h.created_at asc, h.id asc
    ) f
    where f.held_on between ${from} and ${to}
  `);
  const row = Array.from(result)[0];
  const firstMeetings = Number(row?.first_meetings ?? 0);
  const withNextMeeting = Number(row?.with_next ?? 0);
  return {
    from,
    to,
    firstMeetings,
    withNextMeeting,
    rate: nextMeetingRate(firstMeetings, withNextMeeting),
  };
}
