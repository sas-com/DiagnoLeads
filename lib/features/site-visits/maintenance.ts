import type { db as defaultDb } from '@/lib/db/client';
import { siteVisitDaily, siteVisitSalts, siteVisits } from '@/lib/db/schema';
import { count, countDistinct, gte, lt, or, sql } from 'drizzle-orm';
import { visitDayOf } from './visitor';

type Database = typeof defaultDb;

/** Single views are kept this many days; after that only the daily totals remain (#412) */
export const SITE_VISIT_RETENTION_DAYS = 90;

/** Days recounted on each run, so a day still receiving views is completed by the next run */
const RECOUNT_DAYS = 2;

const dayBefore = (day: string, days: number) => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
};

/**
 * Daily maintenance (shares the daily cron): writes the totals of the last days and of the days
 * about to be deleted (so a missed run loses no totals), deletes the views older than the
 * retention and the salts of past days.
 */
export async function maintainSiteVisits(db: Database, now: Date = new Date()) {
  const today = visitDayOf(now);
  const cutoff = dayBefore(today, SITE_VISIT_RETENTION_DAYS);
  const totals = await db
    .select({
      organizationId: siteVisits.organizationId,
      day: siteVisits.day,
      path: siteVisits.path,
      pageType: sql<string>`max(${siteVisits.pageType})`,
      visitors: countDistinct(siteVisits.visitorHash),
      pageviews: count(),
    })
    .from(siteVisits)
    .where(or(gte(siteVisits.day, dayBefore(today, RECOUNT_DAYS)), lt(siteVisits.day, cutoff)))
    .groupBy(siteVisits.organizationId, siteVisits.day, siteVisits.path);

  for (const row of totals) {
    await db
      .insert(siteVisitDaily)
      .values({ ...row, updatedAt: now })
      .onConflictDoUpdate({
        target: [siteVisitDaily.organizationId, siteVisitDaily.day, siteVisitDaily.path],
        set: {
          pageType: row.pageType,
          visitors: row.visitors,
          pageviews: row.pageviews,
          updatedAt: now,
        },
      });
  }

  const deleted = await db
    .delete(siteVisits)
    .where(lt(siteVisits.day, cutoff))
    .returning({ id: siteVisits.id });
  await db.delete(siteVisitSalts).where(lt(siteVisitSalts.day, today));

  return { daysCounted: totals.length, deleted: deleted.length };
}
