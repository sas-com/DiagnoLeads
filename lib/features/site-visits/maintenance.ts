import type { db as defaultDb } from '@/lib/db/client';
import { siteVisitSalts, siteVisits } from '@/lib/db/schema';
import { pruneRateLimits } from '@/lib/features/diagnostics/rate-limit';
import { lt, sql } from 'drizzle-orm';
import { visitDayOf } from './visitor';

type Database = typeof defaultDb;

/** Single views are kept this many days; after that only the daily totals remain (#412) */
export const SITE_VISIT_RETENTION_DAYS = 90;

/** Days recounted on each run, so a day still receiving views is completed by the next run */
const RECOUNT_DAYS = 2;

/**
 * Batches of the rate limit clean-up per run: views add a window per address and day, far more
 * than the forms whose submissions otherwise do the clean-up (500 rows per batch)
 */
const RATE_LIMIT_PRUNE_BATCHES = 40;

const dayBefore = (day: string, days: number) => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
};

/**
 * Daily maintenance (shares the daily cron): writes the totals of the last days and of the days
 * about to be deleted (so a missed run loses no totals) in one statement, then deletes the views
 * older than the retention, the salts of past days and the ended rate limit windows.
 */
export async function maintainSiteVisits(db: Database, now: Date = new Date()) {
  const today = visitDayOf(now);
  const cutoff = dayBefore(today, SITE_VISIT_RETENTION_DAYS);
  const recountFrom = dayBefore(today, RECOUNT_DAYS);

  const totals = await db.execute(sql`
    insert into site_visit_daily (organization_id, day, path, page_type, visitors, pageviews, updated_at)
    select organization_id, day, path, max(page_type), count(distinct visitor_hash), count(*), ${now.toISOString()}::timestamptz
    from ${siteVisits}
    where day >= ${recountFrom}::date or day < ${cutoff}::date
    group by organization_id, day, path
    on conflict (organization_id, day, path) do update set
      page_type = excluded.page_type,
      visitors = excluded.visitors,
      pageviews = excluded.pageviews,
      updated_at = excluded.updated_at
  `);

  const deleted = await db
    .delete(siteVisits)
    .where(lt(siteVisits.day, cutoff))
    .returning({ id: siteVisits.id });
  await db.delete(siteVisitSalts).where(lt(siteVisitSalts.day, today));
  for (let batch = 0; batch < RATE_LIMIT_PRUNE_BATCHES; batch++) {
    await pruneRateLimits(db, now);
  }

  return { daysCounted: totals.count ?? 0, deleted: deleted.length };
}
