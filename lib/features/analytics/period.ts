import { dashboardPeriod } from './dashboard';
import type { DateRange } from './types/schemas';

const RANGE_DAYS: Record<Exclude<DateRange, 'all'>, number> = { '7d': 7, '30d': 30, '90d': 90 };

/**
 * Start of the analytics period, on Japanese calendar days like the dashboard:
 * "7 days" is today (JST) and the six days before. `null` means all time (no lower bound).
 */
export function analyticsPeriodStart(dateRange: DateRange, now: Date = new Date()): Date | null {
  if (dateRange === 'all') return null;
  return dashboardPeriod(RANGE_DAYS[dateRange], now).from;
}

/** Start of the current month in Japan (1st, 00:00 JST) */
export function jstMonthStart(now: Date = new Date()): Date {
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString();
  return new Date(`${jstNow.slice(0, 7)}-01T00:00:00+09:00`);
}
