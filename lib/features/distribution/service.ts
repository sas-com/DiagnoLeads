/**
 * What other features may do with the QR campaigns (docs/ARCHITECTURE.md: other features read
 * distribution through types.ts and this file only). distribution imports no other feature
 * (decision 2026-10-24-qr-short-code-entry), so the diagnoses call in here, never the reverse,
 * and the import cycles of the features stay as they are.
 */
import type { db as defaultDb } from '@/lib/db/client';
import { qrCampaigns } from '@/lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { SHORT_CODE_PATTERN } from './types';

type Database = typeof defaultDb;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Transaction;

/**
 * Count a lead made from a scan of a campaign (#700, owner decision of 2026-10-25): adds one to
 * completion_count of the campaign of the organization with this short code. The code is the one
 * the /q/ entry passed on to the diagnosis (QR_CODE_PARAM), which the answer kept; it is compared
 * as the entry compares it (case-sensitive text equality, through the unique index of
 * short_code). A code of another organization's campaign, a code no campaign has and what cannot
 * be a code count nothing: false then, never an error.
 *
 * A paused or expired campaign still counts: the scan was made while it was open, and the
 * respondent may answer after it closed (at the end of the event). The scan rows are not touched
 * (qr_scans.converted and lead_id stay unused), so a scan never points at a person.
 *
 * One statement; the row lock of the update counts submissions at the same moment exactly. The
 * diagnoses run it in a savepoint of the transaction that creates the lead, so the count commits
 * and rolls back with the lead, and a failure of the count never fails the submission
 * (countQrCompletion, lib/features/diagnostics/service.ts).
 */
export async function countCampaignCompletion(
  db: Executor,
  { organizationId, shortCode }: { organizationId: string; shortCode: string }
): Promise<boolean> {
  if (!SHORT_CODE_PATTERN.test(shortCode)) return false;
  const counted = await db
    .update(qrCampaigns)
    .set({ completionCount: sql`${qrCampaigns.completionCount} + 1` })
    .where(
      and(eq(qrCampaigns.organizationId, organizationId), eq(qrCampaigns.shortCode, shortCode))
    )
    .returning({ id: qrCampaigns.id });
  return counted.length > 0;
}
