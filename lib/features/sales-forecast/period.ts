/**
 * Periods of the forecast (Refs #437): this month, this quarter and this fiscal year, from
 * today in Japan and the month the organization's fiscal year starts. Quarters follow the
 * fiscal year, so an April year has April-June as its first quarter.
 */
import {
  DEFAULT_FISCAL_YEAR_START_MONTH,
  type MonthRange,
  addMonths,
  fiscalYearOf,
  fiscalYearRange,
  monthRange,
} from '@/lib/features/sales-targets/types/fiscal-year';
import { z } from 'zod';

export const FORECAST_PERIODS = ['thisMonth', 'thisQuarter', 'thisFiscalYear'] as const;
export const forecastPeriodEnum = z.enum(FORECAST_PERIODS);
export type ForecastPeriod = z.infer<typeof forecastPeriodEnum>;

export function forecastRange(
  period: ForecastPeriod,
  today: string,
  startMonth: number = DEFAULT_FISCAL_YEAR_START_MONTH
): MonthRange {
  const [year, month] = today.split('-').map(Number);
  switch (period) {
    case 'thisMonth':
      return monthRange(year, month, 1);
    case 'thisQuarter': {
      // Months since the fiscal year started, rounded down to the quarter
      const sinceStart = (month - startMonth + 12) % 12;
      const start = addMonths(year, month, -(sinceStart % 3));
      return monthRange(start.year, start.month, 3);
    }
    default:
      return fiscalYearRange(fiscalYearOf(year, month, startMonth), startMonth);
  }
}
