/**
 * The organization's fiscal year (Refs #437): the month it starts in (April unless set in
 * organizations.settings.salesForecast) and the months of a fiscal year, named by the year it
 * starts in. Targets are set per month of a fiscal year.
 */
import { z } from 'zod';

export const DEFAULT_FISCAL_YEAR_START_MONTH = 4;
export const fiscalYearStartMonthSchema = z.number().int().min(1).max(12);

/** Key of the forecast settings in organizations.settings */
export const SALES_FORECAST_SETTINGS_KEY = 'salesForecast';

export interface MonthRange {
  /** First day of the range (YYYY-MM-DD) */
  from: string;
  /** Last day of the range (YYYY-MM-DD) */
  to: string;
  /** First day of each month in the range (YYYY-MM-01), the keys of the targets */
  months: string[];
}

const pad = (value: number) => String(value).padStart(2, '0');

/** Year and month (1-12) `offset` months after year-month */
export function addMonths(
  year: number,
  month: number,
  offset: number
): { year: number; month: number } {
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

/** `months` months from year-month */
export function monthRange(year: number, month: number, months: number): MonthRange {
  const starts = Array.from({ length: months }, (_, index) => addMonths(year, month, index));
  const last = starts[starts.length - 1];
  const lastDay = new Date(Date.UTC(last.year, last.month, 0)).getUTCDate();
  return {
    from: `${starts[0].year}-${pad(starts[0].month)}-01`,
    to: `${last.year}-${pad(last.month)}-${pad(lastDay)}`,
    months: starts.map((start) => `${start.year}-${pad(start.month)}-01`),
  };
}

/** The fiscal year containing the month, named by the year it starts in */
export function fiscalYearOf(year: number, month: number, startMonth: number): number {
  return month >= startMonth ? year : year - 1;
}

export function fiscalYearRange(fiscalYear: number, startMonth: number): MonthRange {
  return monthRange(fiscalYear, startMonth, 12);
}

/** The start month stored in the organization settings; broken values read as April */
export function readFiscalYearStartMonth(settings: unknown): number {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return DEFAULT_FISCAL_YEAR_START_MONTH;
  }
  const stored = (settings as Record<string, unknown>)[SALES_FORECAST_SETTINGS_KEY];
  const month =
    stored && typeof stored === 'object'
      ? (stored as { fiscalYearStartMonth?: unknown }).fiscalYearStartMonth
      : undefined;
  const parsed = fiscalYearStartMonthSchema.safeParse(month);
  return parsed.success ? parsed.data : DEFAULT_FISCAL_YEAR_START_MONTH;
}
