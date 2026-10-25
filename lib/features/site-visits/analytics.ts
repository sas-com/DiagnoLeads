import type { db as defaultDb } from '@/lib/db/client';
import { diagnoses } from '@/lib/db/schema';
import { getColumn } from '@/lib/features/ax-site/columns';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { SiteAnalyticsPeriod } from './analytics-schemas';
import { SITE_VISIT_RETENTION_DAYS } from './maintenance';
import type { SitePageType } from './pages';
import { visitDayOf } from './visitor';

type Database = typeof defaultDb;

/**
 * Site analytics (#755, Epic #411): daily visitors and page views of the organization's public
 * pages, from the site's own measurement (#412). Views of the last 90 days are counted from
 * site_visits, older days from the daily totals (site_visit_daily); a day is taken from one of
 * them only. A period's visitors are the sum of its days (a visitor cannot be matched across
 * days). Only totals leave this module, never a visitor hash.
 */

export interface SiteDay {
  day: string;
  visitors: number;
  pageviews: number;
}

export interface SitePageTotal {
  path: string;
  pageType: SitePageType;
  /** Column title or diagnosis name; null for the fixed pages, named by the screen */
  title: string | null;
  visitors: number;
  pageviews: number;
}

export interface SiteOverview {
  from: string;
  to: string;
  days: SiteDay[];
  totals: { visitors: number; pageviews: number };
  previous: { visitors: number; pageviews: number };
  pages: SitePageTotal[];
  /** The last day with a recorded view, or null when nothing has been recorded yet */
  lastRecordedDay: string | null;
}

/** Pages listed, most visitors first */
const PAGE_LIMIT = 50;

const shiftDay = (day: string, days: number) => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

interface Row {
  day: string;
  path: string;
  page_type: string;
  visitors: number;
  pageviews: number;
}

/** Totals per day and path between two days (inclusive), from views or daily totals */
async function totalsBetween(
  db: Database,
  organizationId: string,
  from: string,
  to: string,
  rawFrom: string
): Promise<Row[]> {
  const result = await db.execute(sql`
    select day::text as day, path, max(page_type) as page_type,
      count(distinct visitor_hash)::int as visitors, count(*)::int as pageviews
    from site_visits
    where organization_id = ${organizationId} and day >= ${from}::date and day <= ${to}::date
      and day >= ${rawFrom}::date
    group by day, path
    union all
    select day::text as day, path, page_type, visitors, pageviews
    from site_visit_daily
    where organization_id = ${organizationId} and day >= ${from}::date and day <= ${to}::date
      and day < ${rawFrom}::date
  `);
  return result as unknown as Row[];
}

/** Names of the builder diagnoses among the paths (/ja/d/<slug>), of this organization only */
async function diagnosisNames(db: Database, organizationId: string, slugs: string[]) {
  if (slugs.length === 0) return new Map<string, string>();
  const rows = await db
    .select({ slug: diagnoses.slug, name: diagnoses.name })
    .from(diagnoses)
    .where(and(eq(diagnoses.organizationId, organizationId), inArray(diagnoses.slug, slugs)));
  return new Map(rows.map((row) => [row.slug, row.name]));
}

const lastSegment = (path: string) => path.slice(path.lastIndexOf('/') + 1);

export async function getSiteOverview(
  db: Database,
  input: { organizationId: string; days: SiteAnalyticsPeriod; now?: Date }
): Promise<SiteOverview> {
  const to = visitDayOf(input.now ?? new Date());
  const from = shiftDay(to, -(input.days - 1));
  const previousTo = shiftDay(from, -1);
  const previousFrom = shiftDay(previousTo, -(input.days - 1));
  const rawFrom = shiftDay(to, -SITE_VISIT_RETENTION_DAYS);

  const [current, previous, last] = await Promise.all([
    totalsBetween(db, input.organizationId, from, to, rawFrom),
    totalsBetween(db, input.organizationId, previousFrom, previousTo, rawFrom),
    db.execute(sql`
      select greatest(
        (select max(day) from site_visits where organization_id = ${input.organizationId}),
        (select max(day) from site_visit_daily where organization_id = ${input.organizationId})
      )::text as day
    `),
  ]);

  const byDay = new Map<string, SiteDay>();
  for (let day = from; day <= to; day = shiftDay(day, 1)) {
    byDay.set(day, { day, visitors: 0, pageviews: 0 });
  }
  const byPage = new Map<string, Omit<SitePageTotal, 'title'>>();
  for (const row of current) {
    const day = byDay.get(row.day);
    if (day) {
      day.visitors += row.visitors;
      day.pageviews += row.pageviews;
    }
    const page = byPage.get(row.path) ?? {
      path: row.path,
      pageType: row.page_type as SitePageType,
      visitors: 0,
      pageviews: 0,
    };
    page.visitors += row.visitors;
    page.pageviews += row.pageviews;
    byPage.set(row.path, page);
  }

  const topPages = [...byPage.values()]
    .sort(
      (a, b) => b.visitors - a.visitors || b.pageviews - a.pageviews || a.path.localeCompare(b.path)
    )
    .slice(0, PAGE_LIMIT);
  const names = await diagnosisNames(
    db,
    input.organizationId,
    topPages.filter((page) => page.pageType === 'diagnosis').map((page) => lastSegment(page.path))
  );
  const pages = topPages.map((page) => ({
    ...page,
    title:
      page.pageType === 'ax-column'
        ? (getColumn(lastSegment(page.path))?.title ?? null)
        : page.pageType === 'diagnosis'
          ? (names.get(lastSegment(page.path)) ?? null)
          : null,
  }));

  const days = [...byDay.values()];
  const sum = (rows: { visitors: number; pageviews: number }[]) =>
    rows.reduce(
      (total, row) => ({
        visitors: total.visitors + row.visitors,
        pageviews: total.pageviews + row.pageviews,
      }),
      { visitors: 0, pageviews: 0 }
    );
  const [lastRow] = last as unknown as { day: string | null }[];

  return {
    from,
    to,
    days,
    totals: sum(days),
    previous: sum(previous),
    pages,
    lastRecordedDay: lastRow?.day ?? null,
  };
}
