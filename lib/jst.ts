/**
 * Calendar days in Japan time (UTC+9, no daylight saving). Moved out of
 * lib/features/analytics/dashboard.ts so other features read them without importing analytics (#471).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
export const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

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
