/**
 * Suppression list of respondent mail (#154): addresses of an organization that must not be
 * mailed. Checked right before every send. Rows outlive the lead (no foreign key to leads).
 */
import type { Database } from '@/lib/db/client';
import { emailSuppressions } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { normaliseEmail } from './normalize';

export type SuppressionReason =
  | 'unsubscribed'
  | 'not_requested'
  | 'bounced'
  | 'complained'
  | 'staff';

export type SuppressionSource =
  | 'one_click'
  | 'unsubscribe_page'
  | 'confirm_page'
  | 'resend_webhook'
  | 'staff';

/** The database or a transaction of it */
export type SuppressionDatabase = Pick<Database, 'select' | 'insert'>;

/**
 * Whether the address must not be mailed. An address that is not exactly one plain address is
 * treated as suppressed, so a caller that forgets to validate still sends nothing.
 */
export async function isSuppressed(
  db: Pick<Database, 'select'>,
  organizationId: string,
  email: string
): Promise<boolean> {
  const normalised = normaliseEmail(email);
  if (!normalised) return true;
  const rows = await db
    .select({ id: emailSuppressions.id })
    .from(emailSuppressions)
    .where(
      and(
        eq(emailSuppressions.organizationId, organizationId),
        eq(emailSuppressions.email, normalised)
      )
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Put the address on the organization's suppression list. Idempotent: an address already on the
 * list keeps its first reason and source. Returns whether a new row was written.
 */
export async function suppress(
  db: Pick<Database, 'insert'>,
  input: {
    organizationId: string;
    email: string;
    reason: SuppressionReason;
    source: SuppressionSource;
    sendId?: string | null;
    createdBy?: string | null;
  }
): Promise<{ created: boolean }> {
  const email = normaliseEmail(input.email);
  if (!email) throw new Error('suppress: not a single plain email address');
  const rows = await db
    .insert(emailSuppressions)
    .values({
      organizationId: input.organizationId,
      email,
      reason: input.reason,
      source: input.source,
      sendId: input.sendId ?? null,
      createdBy: input.createdBy ?? null,
    })
    .onConflictDoNothing({ target: [emailSuppressions.organizationId, emailSuppressions.email] })
    .returning({ id: emailSuppressions.id });
  return { created: rows.length > 0 };
}
