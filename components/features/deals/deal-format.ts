/**
 * Formatting for the deals screens (Refs #436): yen amounts, days in a stage and the close date
 * periods of the board's filter. Dates are Japan calendar days (YYYY-MM-DD).
 */

const intlLocale = (locale: string) => (locale === 'ja' ? 'ja-JP' : 'en-US');

/** "¥3,000,000"; null when there is no amount */
export function formatYen(amount: number | null, locale: string): string | null {
  if (amount === null) return null;
  return new Intl.NumberFormat(intlLocale(locale), {
    style: 'currency',
    currency: 'JPY',
    maximumFractionDigits: 0,
  }).format(amount);
}

/** "￥300万" in Japanese, "¥3M" in English: the column totals */
export function formatYenCompact(amount: number, locale: string): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    style: 'currency',
    currency: 'JPY',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(amount);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days since the moment (0 on the same day) */
export function daysSince(from: Date | string, now: Date = new Date()): number {
  const start = typeof from === 'string' ? new Date(from) : from;
  return Math.max(0, Math.floor((now.getTime() - start.getTime()) / DAY_MS));
}

export const DEAL_PERIODS = ['all', 'thisMonth', 'nextMonth', 'thisQuarter'] as const;
export type DealPeriod = (typeof DEAL_PERIODS)[number];

export const isDealPeriod = (value: string | null): value is DealPeriod =>
  (DEAL_PERIODS as readonly string[]).includes(value ?? '');

const iso = (year: number, month: number, day: number) =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

/** First and last day of `months` months from the month at `offset` months after today's */
function monthRange(today: string, offset: number, months: number) {
  const [year, month] = today.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1 + offset, 1));
  const end = new Date(Date.UTC(year, month - 1 + offset + months, 0));
  return {
    closeFrom: iso(start.getUTCFullYear(), start.getUTCMonth() + 1, 1),
    closeTo: iso(end.getUTCFullYear(), end.getUTCMonth() + 1, end.getUTCDate()),
  };
}

/** Close date range of a period, from today (Japan); empty for "all" */
export function periodRange(
  period: DealPeriod,
  today: string
): { closeFrom?: string; closeTo?: string } {
  switch (period) {
    case 'thisMonth':
      return monthRange(today, 0, 1);
    case 'nextMonth':
      return monthRange(today, 1, 1);
    case 'thisQuarter': {
      // Calendar quarters (Jan-Mar, Apr-Jun, ...), which are also the quarters of an April year
      const month = Number(today.slice(5, 7));
      return monthRange(today, -((month - 1) % 3), 3);
    }
    default:
      return {};
  }
}
