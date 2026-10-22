/**
 * Unsubscribe by the token of a respondent mail (#154): the page button and the RFC 8058
 * one-click POST both end here. The token names one send; its address goes on the suppression
 * list of that send's organization.
 *
 * Neither the token nor the address is logged.
 */
import type { Database } from '@/lib/db/client';
import { respondentEmailSends } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { suppress } from './suppression';
import { hashToken } from './tokens';

export type UnsubscribeSource = 'one_click' | 'unsubscribe_page';

export type UnsubscribeOutcome = 'done' | 'not_found';

/** The database or a transaction of it */
export type UnsubscribeDatabase = Pick<Database, 'select' | 'insert'>;

/**
 * Put the address of the send the token belongs to on its organization's suppression list.
 * Idempotent: a second use of the token (or another mail to an address already suppressed)
 * answers 'done' and keeps the first suppression. Tokens do not expire: an unsubscribe link must
 * keep working for as long as the mail can be read.
 */
export async function unsubscribeByToken(
  db: UnsubscribeDatabase,
  token: string,
  source: UnsubscribeSource
): Promise<UnsubscribeOutcome> {
  if (typeof token !== 'string' || token.length === 0) return 'not_found';
  const [send] = await db
    .select({
      id: respondentEmailSends.id,
      organizationId: respondentEmailSends.organizationId,
      email: respondentEmailSends.email,
    })
    .from(respondentEmailSends)
    .where(eq(respondentEmailSends.unsubscribeTokenHash, hashToken(token)))
    .limit(1);
  if (!send) return 'not_found';

  await suppress(db, {
    organizationId: send.organizationId,
    email: send.email,
    reason: 'unsubscribed',
    source,
    sendId: send.id,
  });
  return 'done';
}
