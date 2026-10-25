/**
 * The short code of a QR campaign in a diagnosis answer (#700, owner decision of 2026-10-25): the
 * /q/ entry adds it to the address of the diagnosis, the answer keeps it in tracking like the UTM
 * values when it can be a code (dropped otherwise, never rejected), and countQrCompletion counts
 * a lead the submission created for the campaign of its organization, in a savepoint whose
 * failure keeps the submission going. The counting on PostgreSQL (the savepoint, the lock
 * timeout) is in test/unit/integration/qr-campaign-completions.db.test.ts.
 */
import type { db as defaultDb } from '@/lib/db/client';
import { axMigrationSubmissionSchema } from '@/lib/features/diagnostics/ax-migration/submission-service';
import { type QrCompletionSubmission, countQrCompletion } from '@/lib/features/diagnostics/service';
import { compactTracking, trackingSchema } from '@/lib/features/diagnostics/tracking';
import { diagnosisSubmissionSchema } from '@/lib/features/diagnosis-builder/submission-service';
import { as400Answers } from '@/test/fixtures/ax-migration';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ countCampaignCompletion: vi.fn() }));
vi.mock('@/lib/features/distribution/service', () => ({
  countCampaignCompletion: mocks.countCampaignCompletion,
}));

type Database = typeof defaultDb;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

describe('trackingSchema: qr (#700)', () => {
  it('keeps a short code of letters and digits, case and all', () => {
    expect(trackingSchema.parse({ qr: 'AbCd2345' }).qr).toBe('AbCd2345');
  });

  it('drops what cannot be a code, without rejecting the answer', () => {
    for (const qr of ['', 'ab-cd', 'ab/cd', '../x', 'abc def', 'Ａbc', 'a'.repeat(65), 12345, null]) {
      const parsed = trackingSchema.safeParse({ utmSource: 'qrcode', qr });
      expect(parsed.success, String(qr)).toBe(true);
      expect(parsed.data, String(qr)).toEqual({ utmSource: 'qrcode' });
    }
  });

  it('is stored with the UTM values', () => {
    const tracking = trackingSchema.parse({ utmSource: 'qrcode', utmMedium: 'offline', qr: 'AbCd2345' });
    expect(compactTracking(tracking)).toEqual({
      utmSource: 'qrcode',
      utmMedium: 'offline',
      qr: 'AbCd2345',
    });
  });

  it('is read from the answers of the AX diagnosis and of the builder diagnoses', () => {
    const contact = { company: '架空商事', name: '試験 太郎', email: 'taro@example.co.jp' };
    const ax = axMigrationSubmissionSchema.parse({
      answers: as400Answers,
      contact,
      privacyConsent: true,
      tracking: { qr: 'AbCd2345' },
    });
    const builder = diagnosisSubmissionSchema.parse({
      versionId: '770e8400-e29b-41d4-a716-446655440001',
      answers: {},
      contact,
      privacyConsent: true,
      consentVersion: '2026-10-01',
      tracking: { qr: 'AbCd2345' },
    });
    expect([ax.tracking.qr, builder.tracking.qr]).toEqual(['AbCd2345', 'AbCd2345']);
  });
});

describe('countQrCompletion (#700)', () => {
  // The submission's transaction runs the count in a savepoint (tx.transaction)
  const savepoint = { execute: vi.fn() };
  const tx = {
    transaction: vi.fn(async (work: (sp: typeof savepoint) => unknown) => work(savepoint)),
  };
  const transaction = tx as unknown as Transaction;
  const NEW_LEAD: QrCompletionSubmission = {
    organizationId: 'org-a',
    leadCreated: true,
    isTest: false,
    tracking: { qr: 'AbCd2345' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.countCampaignCompletion.mockResolvedValue(true);
    savepoint.execute.mockResolvedValue([{ previous: '0' }]);
  });

  it("counts a lead the submission created for the campaign of the submission's organization", async () => {
    expect(await countQrCompletion(transaction, NEW_LEAD)).toEqual({ counted: true, failure: null });
    expect(tx.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.countCampaignCompletion).toHaveBeenCalledTimes(1);
    // In the savepoint, between setting the lock timeout and setting the previous one again
    expect(mocks.countCampaignCompletion).toHaveBeenCalledWith(savepoint, {
      organizationId: 'org-a',
      shortCode: 'AbCd2345',
    });
    expect(savepoint.execute).toHaveBeenCalledTimes(2);
    const [setLockTimeout, setPrevious] = savepoint.execute.mock.invocationCallOrder;
    const [count] = mocks.countCampaignCompletion.mock.invocationCallOrder;
    expect(setLockTimeout).toBeLessThan(count);
    expect(setPrevious).toBeGreaterThan(count);
  });

  it('answers not counted when no campaign of the organization has the code', async () => {
    mocks.countCampaignCompletion.mockResolvedValue(false);
    expect(await countQrCompletion(transaction, NEW_LEAD)).toEqual({ counted: false, failure: null });
  });

  it('keeps the submission going when the count fails, and logs the name and code only', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    // What a policy of RLS without a grant would throw (the message holds the query's values)
    const refused = Object.assign(
      new Error('permission denied for table qr_campaigns: update ... params: org-a,AbCd2345'),
      { name: 'PostgresError', code: '42501' }
    );
    mocks.countCampaignCompletion.mockRejectedValue(refused);

    expect(await countQrCompletion(transaction, NEW_LEAD)).toEqual({
      counted: false,
      failure: { error: refused },
    });
    expect(consoleError).toHaveBeenCalledWith('QR completion not counted:', 'PostgresError', '42501');
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('AbCd2345');
    consoleError.mockRestore();
  });

  it('does not count a submission linked to a lead that was already there', async () => {
    expect(await countQrCompletion(transaction, { ...NEW_LEAD, leadCreated: false })).toEqual({
      counted: false,
      failure: null,
    });
    expect(tx.transaction).not.toHaveBeenCalled();
    expect(mocks.countCampaignCompletion).not.toHaveBeenCalled();
  });

  it('does not count a test answer', async () => {
    expect(await countQrCompletion(transaction, { ...NEW_LEAD, isTest: true })).toEqual({
      counted: false,
      failure: null,
    });
    expect(tx.transaction).not.toHaveBeenCalled();
    expect(mocks.countCampaignCompletion).not.toHaveBeenCalled();
  });

  it('asks nothing of the database for an answer without a code', async () => {
    for (const tracking of [{}, { qr: undefined }, { qr: '' }]) {
      expect(await countQrCompletion(transaction, { ...NEW_LEAD, tracking })).toEqual({
        counted: false,
        failure: null,
      });
    }
    expect(tx.transaction).not.toHaveBeenCalled();
    expect(mocks.countCampaignCompletion).not.toHaveBeenCalled();
  });
});
