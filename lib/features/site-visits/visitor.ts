import { createHash, randomBytes } from 'node:crypto';
import type { db as defaultDb } from '@/lib/db/client';
import { siteVisitSalts } from '@/lib/db/schema';
import { jstDate } from '@/lib/features/leads/types/pipeline';
import { eq, lt } from 'drizzle-orm';

type Database = typeof defaultDb;

/**
 * Visitors are counted without a cookie and without storing the IP address or the browser
 * (#412): a visitor is the hash of the day's salt, the organization, the IP address and the user
 * agent. The salt is random, kept only for its day in Japan and deleted afterwards, so the hashes
 * of one day cannot be matched with another day's, nor turned back into an address.
 */

/** The day in Japan a view counts for ('YYYY-MM-DD') */
export const visitDayOf = (now: Date = new Date()) => jstDate(now);

/**
 * The salt of the day, made by the first view of the day. The salts of past days are deleted
 * here as well (the daily maintenance does it too, for days without views); a later day's salt
 * is left alone, so two servers on either side of midnight do not delete each other's.
 */
export async function daySalt(db: Pick<Database, 'insert' | 'select' | 'delete'>, day: string) {
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
  return row.salt;
}

/**
 * What the rate limit counts a visitor as: the day's salt and the address block (IPv6 by its
 * /64), without the browser, so changing the user agent does not get past it
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
  return createHash('sha256')
    .update(`${input.salt}\n${input.organizationId}\n${input.ip}\n${input.userAgent}`)
    .digest('base64url');
}
