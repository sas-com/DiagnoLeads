import type { db as defaultDb } from '@/lib/db/client';
import { diagnosticSubmissions, leads } from '@/lib/db/schema';
import { consultationDeadline } from '@/lib/features/diagnostics/ax-migration/notify';
import { LEAD_STATUSES, type LeadStatus } from '@/lib/features/leads/types/pipeline';
import { addDays, differenceInBusinessDays } from 'date-fns';
import { and, count, desc, eq, gte, lt, min, sql } from 'drizzle-orm';

type Database = typeof defaultDb;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Waiting requests read (oldest first) and shown on the dashboard */
const PENDING_LIMIT = 50;
const PENDING_SHOWN = 8;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** Calendar day in Japan (YYYY-MM-DD) of an instant */
export function jstDay(instant: Date): string {
  return new Date(instant.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * The period ends now and starts at the beginning of the Japanese day `days - 1` days ago, so
 * "7 days" is today and the six days before. The previous period has the same length.
 */
export function dashboardPeriod(days: number, now: Date = new Date()) {
  const todayStart = new Date(`${jstDay(now)}T00:00:00+09:00`);
  const from = new Date(todayStart.getTime() - (days - 1) * DAY_MS);
  const previousFrom = new Date(from.getTime() - days * DAY_MS);
  return { from, to: now, previousFrom };
}

/** How close a contact deadline is, in business days (weekends skipped, like the deadline rule) */
export type DeadlineStatus =
  | { due: 'overdue'; businessDays: number }
  | { due: 'today'; businessDays: 0 }
  | { due: 'tomorrow'; businessDays: number }
  | { due: 'later'; businessDays: number };

/** Noon UTC of a calendar day (YYYY-MM-DD or YYYY/MM/DD), so weekday math ignores time zones */
function calendarDay(day: string): Date {
  const [year, month, date] = day.split(/[-/]/).map(Number);
  return new Date(Date.UTC(year, month - 1, date, 12));
}

/**
 * Lateness of a deadline seen from today (both Japan calendar days). An overdue request is at
 * least one business day late, even when today is a weekend.
 */
export function deadlineStatus(deadline: string, today: string): DeadlineStatus {
  const due = calendarDay(deadline);
  const now = calendarDay(today);
  if (due.getTime() < now.getTime()) {
    return { due: 'overdue', businessDays: Math.max(1, differenceInBusinessDays(now, due)) };
  }
  if (due.getTime() === now.getTime()) return { due: 'today', businessDays: 0 };
  const businessDays = Math.max(1, differenceInBusinessDays(due, now));
  if (due.getTime() === addDays(now, 1).getTime()) return { due: 'tomorrow', businessDays };
  return { due: 'later', businessDays };
}

export type DashboardTrendPoint = {
  /** First and last Japan calendar day (YYYY-MM-DD) of the bar */
  start: string;
  end: string;
  leads: number;
  consultations: number;
};

/** Periods longer than this are shown per week instead of per day */
const DAILY_TREND_MAX_DAYS = 30;

/**
 * Bars of the trend chart: one per day up to 30 days, otherwise one per week (Monday to Sunday,
 * the first and last week cut at the period edges).
 */
export function bucketTrend(daily: { date: string; leads: number; consultations: number }[]): {
  unit: 'day' | 'week';
  points: DashboardTrendPoint[];
} {
  if (daily.length <= DAILY_TREND_MAX_DAYS) {
    return {
      unit: 'day',
      points: daily.map((d) => ({
        start: d.date,
        end: d.date,
        leads: d.leads,
        consultations: d.consultations,
      })),
    };
  }
  const points: DashboardTrendPoint[] = [];
  for (const day of daily) {
    const monday = calendarDay(day.date).getUTCDay() === 1;
    const last = points.at(-1);
    if (!last || monday) {
      points.push({
        start: day.date,
        end: day.date,
        leads: day.leads,
        consultations: day.consultations,
      });
    } else {
      last.end = day.date;
      last.leads += day.leads;
      last.consultations += day.consultations;
    }
  }
  return { unit: 'week', points };
}

/** Most leads first; "unknown" (not from the AX diagnosis) always last */
export function sortPlatforms(platforms: { platform: string; count: number }[]) {
  return [...platforms].sort((a, b) => {
    if ((a.platform === 'unknown') !== (b.platform === 'unknown')) {
      return a.platform === 'unknown' ? 1 : -1;
    }
    return b.count - a.count;
  });
}

export type DashboardPendingConsultation = {
  id: string;
  name: string | null;
  company: string | null;
  platform: string | null;
  requestedAt: Date;
  /** Contact deadline (YYYY/MM/DD, Japan), the same rule as the sales email */
  deadline: string;
  overdue: boolean;
} & DeadlineStatus;

export type DashboardSummary = {
  days: number;
  newLeads: number;
  previousNewLeads: number;
  consultations: number;
  previousConsultations: number;
  mql: number;
  previousMql: number;
  /** Average score of the leads created in the period; null when there are none */
  averageScore: number | null;
  previousAverageScore: number | null;
  daily: { date: string; leads: number; consultations: number }[];
  /** Bars of the trend chart: per day up to 30 days, per week beyond */
  trend: { unit: 'day' | 'week'; points: DashboardTrendPoint[] };
  statuses: { status: LeadStatus; count: number }[];
  platforms: { platform: string; count: number }[];
  pendingConsultations: DashboardPendingConsultation[];
  pendingConsultationTotal: number;
  recentLeads: {
    id: string;
    name: string | null;
    company: string | null;
    platform: string | null;
    score: number | null;
    status: LeadStatus;
    /** Qualified as MQL (at any time) */
    mql: boolean;
    consultation: boolean;
    createdAt: Date;
  }[];
};

const platformOf = sql<string | null>`${leads.responses}->'axMigration'->>'platform'`;
const isConsultation = eq(leads.conversionPoint, 'consultation');

/**
 * Figures for the dashboard of one organization. Counts are real and compared with the
 * previous period of the same length; days without leads appear as zero.
 */
export async function getDashboardSummary(
  db: Database,
  organizationId: string,
  days: number,
  now: Date = new Date()
): Promise<DashboardSummary> {
  const { from, previousFrom } = dashboardPeriod(days, now);
  const inOrg = eq(leads.organizationId, organizationId);
  const between = (start: Date, end: Date) =>
    and(inOrg, gte(leads.createdAt, start), lt(leads.createdAt, end));
  const current = between(from, new Date(now.getTime() + 1));

  const nowEnd = new Date(now.getTime() + 1);
  const fromIso = from.toISOString();
  const previousFromIso = previousFrom.toISOString();
  const endIso = nowEnd.toISOString();
  // created_at and mql_qualified_at hold UTC without a time zone
  const createdIn = (start: string, end: string) =>
    sql`${leads.createdAt} >= (${start}::timestamptz AT TIME ZONE 'UTC') and ${leads.createdAt} < (${end}::timestamptz AT TIME ZONE 'UTC')`;
  const mqlIn = (start: string, end: string) =>
    sql`${leads.mqlQualifiedAt} >= (${start}::timestamptz AT TIME ZONE 'UTC') and ${leads.mqlQualifiedAt} < (${end}::timestamptz AT TIME ZONE 'UTC')`;
  const consultation = sql`${leads.conversionPoint} = 'consultation'`;

  const [figures, dailyRows, statusRows, platformRows, pendingRows, recentRows] = await Promise.all(
    [
      // Every count of both periods in one pass over the organization's leads
      db
        .select({
          newLeads: sql<number>`count(*) filter (where ${createdIn(fromIso, endIso)})`,
          previousNewLeads: sql<number>`count(*) filter (where ${createdIn(previousFromIso, fromIso)})`,
          consultations: sql<number>`count(*) filter (where ${createdIn(fromIso, endIso)} and ${consultation})`,
          previousConsultations: sql<number>`count(*) filter (where ${createdIn(previousFromIso, fromIso)} and ${consultation})`,
          mql: sql<number>`count(*) filter (where ${mqlIn(fromIso, endIso)})`,
          previousMql: sql<number>`count(*) filter (where ${mqlIn(previousFromIso, fromIso)})`,
          averageScore: sql<
            string | null
          >`avg(${leads.score}) filter (where ${createdIn(fromIso, endIso)})`,
          previousAverageScore: sql<
            string | null
          >`avg(${leads.score}) filter (where ${createdIn(previousFromIso, fromIso)})`,
          pendingTotal: sql<number>`count(*) filter (where ${consultation} and ${leads.status} = 'new')`,
        })
        .from(leads)
        .where(inOrg),
      db
        .select({
          day: sql<string>`to_char((${leads.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD')`,
          leads: count(),
          consultations: sql<number>`count(*) filter (where ${leads.conversionPoint} = 'consultation')`,
        })
        .from(leads)
        .where(current)
        .groupBy(sql`1`),
      db
        .select({ status: leads.status, value: count() })
        .from(leads)
        .where(inOrg)
        .groupBy(leads.status),
      db
        .select({ platform: platformOf, value: count() })
        .from(leads)
        .where(current)
        .groupBy(sql`1`),
      // Consultation requests nobody has acted on yet (still "new"), oldest request first
      db
        .select({
          id: leads.id,
          name: leads.name,
          company: leads.company,
          platform: platformOf,
          createdAt: leads.createdAt,
          requestedAt: min(diagnosticSubmissions.consultationRequestedAt),
        })
        .from(leads)
        .leftJoin(
          diagnosticSubmissions,
          and(
            eq(diagnosticSubmissions.leadId, leads.id),
            eq(diagnosticSubmissions.organizationId, organizationId)
          )
        )
        .where(and(inOrg, isConsultation, eq(leads.status, 'new')))
        .groupBy(leads.id)
        .orderBy(
          sql`coalesce(min(${diagnosticSubmissions.consultationRequestedAt}), ${leads.createdAt})`
        )
        .limit(PENDING_LIMIT),
      db
        .select({
          id: leads.id,
          name: leads.name,
          company: leads.company,
          platform: platformOf,
          score: leads.score,
          status: leads.status,
          mqlQualifiedAt: leads.mqlQualifiedAt,
          conversionPoint: leads.conversionPoint,
          createdAt: leads.createdAt,
        })
        .from(leads)
        .where(inOrg)
        .orderBy(desc(leads.createdAt))
        .limit(6),
    ]
  );
  const totals = figures[0];

  const byDay = new Map(dailyRows.map((row) => [row.day, row]));
  const daily = Array.from({ length: days }, (_, i) => {
    const date = jstDay(new Date(from.getTime() + i * DAY_MS + JST_OFFSET_MS / 2));
    const row = byDay.get(date);
    return { date, leads: Number(row?.leads ?? 0), consultations: Number(row?.consultations ?? 0) };
  });

  const statusCounts = new Map(statusRows.map((row) => [row.status, Number(row.value)]));
  const today = jstDay(now).replaceAll('-', '/');
  const pending = pendingRows
    .map((row) => {
      const requestedAt = row.requestedAt ?? row.createdAt;
      const deadline = consultationDeadline(requestedAt);
      return {
        id: row.id,
        name: row.name,
        company: row.company,
        platform: row.platform,
        requestedAt,
        deadline,
        overdue: deadline < today,
        ...deadlineStatus(deadline, today),
      };
    })
    .sort((a, b) => a.deadline.localeCompare(b.deadline));
  const roundedAverage = (value: string | null | undefined) =>
    value === null || value === undefined ? null : Math.round(Number(value));

  return {
    days,
    newLeads: Number(totals?.newLeads ?? 0),
    previousNewLeads: Number(totals?.previousNewLeads ?? 0),
    consultations: Number(totals?.consultations ?? 0),
    previousConsultations: Number(totals?.previousConsultations ?? 0),
    mql: Number(totals?.mql ?? 0),
    previousMql: Number(totals?.previousMql ?? 0),
    averageScore: roundedAverage(totals?.averageScore),
    previousAverageScore: roundedAverage(totals?.previousAverageScore),
    daily,
    trend: bucketTrend(daily),
    statuses: LEAD_STATUSES.map((status) => ({ status, count: statusCounts.get(status) ?? 0 })),
    platforms: sortPlatforms(
      platformRows.map((row) => ({ platform: row.platform ?? 'unknown', count: Number(row.value) }))
    ),
    pendingConsultations: pending.slice(0, PENDING_SHOWN),
    pendingConsultationTotal: Number(totals?.pendingTotal ?? 0),
    recentLeads: recentRows.map((row) => ({
      id: row.id,
      name: row.name,
      company: row.company,
      platform: row.platform,
      score: row.score,
      status: row.status as LeadStatus,
      mql: row.mqlQualifiedAt !== null,
      consultation: row.conversionPoint === 'consultation',
      createdAt: row.createdAt,
    })),
  };
}
