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

const TOKYO_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' });

/** The day in Japan of an instant ('YYYY-MM-DD') */
export function jstDayOf(instant: Date): string {
  return TOKYO_DAY.format(instant);
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

/**
 * The last day in Japan on which a campaign with this expiry answers scans, to fill the date
 * input with: the day of the instant just before the expiry. For an expiry set on the page that
 * is the day entered; one set through the API at midnight in Japan gives the day before, the last
 * day it was open
 */
export function lastOpenJstDayOf(expiresAt: Date): string {
  return jstDayOf(new Date(expiresAt.getTime() - 1));
}
