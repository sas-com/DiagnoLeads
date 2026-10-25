/**
 * Consultation requests (相談申込) of the public diagnoses: the same rules for the AX diagnosis
 * and the diagnoses made in the builder (decision 2026-10-24-diagnosis-shared-rules, #481)
 */
import { addBusinessDays } from 'date-fns';

/**
 * A request is taken from the result screen for a day after the answer (#232). A submission id
 * seen later (or leaked) cannot place one: the request answers 409
 */
export const CONSULTATION_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Sales get in touch within this many business days of a request */
export const CONSULTATION_RESPONSE_BUSINESS_DAYS = 2;

/**
 * 相談申込への連絡期限（土日を除く営業日。祝日は考慮しない）
 * Counted on the Japan calendar regardless of the server time zone (Vercel runs in UTC).
 * Returns the deadline as a JST calendar date in yyyy/MM/dd.
 */
export function consultationDeadline(
  requestedAt: Date,
  businessDays = CONSULTATION_RESPONSE_BUSINESS_DAYS
): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(requestedAt);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  // Build a UTC-noon date for the JST calendar day so weekday math is time-zone independent
  const jstDay = new Date(Date.UTC(part('year'), part('month') - 1, part('day'), 12));
  const deadline = addBusinessDays(jstDay, businessDays);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${deadline.getUTCFullYear()}/${pad(deadline.getUTCMonth() + 1)}/${pad(deadline.getUTCDate())}`;
}
