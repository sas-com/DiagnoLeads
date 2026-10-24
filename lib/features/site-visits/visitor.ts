import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { db as defaultDb } from '@/lib/db/client';
import { siteVisitSalts } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { jstDate } from '@/lib/features/leads/types/pipeline';
import { eq, lt } from 'drizzle-orm';

type Database = typeof defaultDb;

/**
 * Visitors are counted without a cookie and without storing the IP address or the browser
 * (#412): a visitor is a keyed hash (HMAC with the server secret) of the day's salt, the
 * organization, the IP address and the user agent. The salt is random, kept only for its day in
 * Japan and deleted afterwards, so the hashes of one day cannot be matched with another day's;
 * the key stays on the server, so neither can the database or a backup alone be matched against
 * known or guessed addresses.
 */

/** The day in Japan a view counts for ('YYYY-MM-DD') */
export const visitDayOf = (now: Date = new Date()) => jstDate(now);

/**
 * The salt of the current day, kept by this server once read: the views after the first (and
 * the ones refused) do not ask the database for it again. Only one day is held.
 */
let remembered: { day: string; salt: string } | null = null;

/** Tests that empty the salts table between cases start from the database again */
export function forgetDaySaltForTests(): void {
  remembered = null;
}

/**
 * The salt of the day, made by the first view of the day. The salts of past days are deleted
 * here as well (the daily maintenance does it too, for days without views); a later day's salt
 * is left alone, so two servers on either side of midnight do not delete each other's.
 */
export async function daySalt(db: Pick<Database, 'insert' | 'select' | 'delete'>, day: string) {
  if (remembered?.day === day) return remembered.salt;
  await db
    .insert(siteVisitSalts)
    .values({ day, salt: randomBytes(32).toString('base64url') })
    .onConflictDoNothing();
  const [row] = await db
    .select({ salt: siteVisitSalts.salt })
    .from(siteVisitSalts)
    .where(eq(siteVisitSalts.day, day));
  await db.delete(siteVisitSalts).where(lt(siteVisitSalts.day, day));
  if (!row) throw new Error(`No site visit salt for ${day}`);
  remembered = { day, salt: row.salt };
  return row.salt;
}

/**
 * What the rate limits count a visitor as: the day's salt and the address block, without the
 * browser, so changing the user agent does not get past them. The rate limit key is a keyed
 * hash of this in turn (rateLimitKey)
 */
export function rateLimitIdentityOf(salt: string, ipBlockValue: string): string {
  return createHash('sha256').update(`${salt}\n${ipBlockValue}`).digest('base64url');
}

export function visitorHashOf(input: {
  salt: string;
  organizationId: string;
  ip: string;
  userAgent: string;
}): string {
  return createHmac('sha256', env.BETTER_AUTH_SECRET)
    .update(`site-visit:${input.salt}\n${input.organizationId}\n${input.ip}\n${input.userAgent}`)
    .digest('base64url');
}
