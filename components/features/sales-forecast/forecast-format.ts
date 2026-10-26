/**
 * Dates and months on the forecast screens (Refs #721): a Japan calendar day ("2026/10/01"),
 * the name of a month ("4月", "April") and a month of a year ("2026年10月", "October 2026").
 */

const intlLocale = (locale: string) => (locale === 'ja' ? 'ja-JP' : 'en-US');

/** A calendar day given as YYYY-MM-DD, written for the locale */
export function formatPlainDay(day: string, locale: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`));
}

/** The name of a month, 1-12 */
export function formatMonthName(month: number, locale: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2000, month - 1, 1))
  );
}

/** A month given by its first day (YYYY-MM-01), with its year */
export function formatYearMonth(firstDay: string, locale: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${firstDay}T00:00:00Z`));
}
