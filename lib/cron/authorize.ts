import { timingSafeEqual } from 'node:crypto';

/**
 * Whether a request comes from Vercel Cron: it sends "Authorization: Bearer <CRON_SECRET>".
 * Without CRON_SECRET set, nobody is let in.
 */
export function isCronRequest(request: Request, secret = process.env.CRON_SECRET): boolean {
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(request.headers.get('authorization') ?? '');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
