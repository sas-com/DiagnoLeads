/**
 * The expiry of a QR campaign as the settings page shows and sets it (#695). Pure, so the page
 * can import it.
 *
 * People enter a day, meant in Japan (the events are), and the campaign answers scans through the
 * end of that day: it is stored as 23:59:59.999 of that day in Japan, the last instant before the
 * next day begins there. The /q/ entry closes a campaign from its expires_at on
 * (isCampaignExpired), so a scan at midnight of the next day is the first one refused.
 */

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Read part by part (formatToParts), not as the formatted string: this runs in the browser, and
 * the shape a locale formats a date in is up to the browser's ICU ('en-CA' gives 'YYYY-MM-DD' in
 * most versions, not in all). Read off another shape, every day would be taken for not a day of
 * the calendar, and no expiry could be saved
 */
const TOKYO_DAY = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The day in Japan of an instant ('YYYY-MM-DD') */
export function jstDayOf(instant: Date): string {
  const parts = new Map(TOKYO_DAY.formatToParts(instant).map((part) => [part.type, part.value]));
  const year = (parts.get('year') ?? '').padStart(4, '0');
  return `${year}-${parts.get('month')}-${parts.get('day')}`;
}

/**
 * What updateCampaign and createCampaign are sent for a day in Japan ('YYYY-MM-DD', as a date
 * input gives it): the end of that day in Japan as an ISO string in UTC. null for anything that
 * is not a day of the calendar ('2026-02-30' is not taken for 2 March)
 */
export function expiryOfJstDay(day: string): string | null {
  if (!DAY_PATTERN.test(day)) return null;
  const end = new Date(`${day}T23:59:59.999+09:00`);
  if (Number.isNaN(end.getTime()) || jstDayOf(end) !== day) return null;
  return end.toISOString();
}

/** Why the page sends no expiry for a day chosen on it */
export type ExpiryDayProblem = 'invalid_day' | 'past_day';

/**
 * The expiry the page sends for a day chosen on it (expiryOfJstDay), or why it sends none. A day
 * already over in Japan is refused: the entry refuses scans from expires_at on
 * (isCampaignExpired), so the campaign would close the moment it is saved, and a past day picked
 * by mistake to extend a campaign mid-event would stop its QR at once. Pausing a campaign is what
 * its switch is for. The day of `now` itself is taken: the campaign stays open to its end.
 * A check of the page only (the browser's clock); the API takes any expiry, as before
 */
export function expiryOfChosenDay(
  day: string,
  now: Date
): { expiresAt: string } | { problem: ExpiryDayProblem } {
  const expiresAt = expiryOfJstDay(day);
  if (expiresAt === null) return { problem: 'invalid_day' };
  if (new Date(expiresAt).getTime() <= now.getTime()) return { problem: 'past_day' };
  return { expiresAt };
}

/**
 * The last day in Japan on which a campaign with this expiry answers scans, to fill the date
 * input with: the day of the instant just before the expiry. For an expiry set on the page that
 * is the day entered; one set through the API at midnight in Japan gives the day before, the last
 * day it was open
 */
export function lastOpenJstDayOf(expiresAt: Date): string {
  return jstDayOf(new Date(expiresAt.getTime() - 1));
}
