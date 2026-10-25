/**
 * The short code of a QR campaign in a diagnosis answer (#700, owner decision of 2026-10-25): the
 * /q/ entry adds it to the address of the diagnosis, the answer keeps it in tracking like the UTM
 * values when it can be a code (dropped otherwise, never rejected), and countQrCompletion counts
 * a lead the submission created for the campaign of its organization. The counting on
 * PostgreSQL is in test/unit/integration/qr-campaign-completions.db.test.ts.
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
  const tx = {} as unknown as Transaction;
  const NEW_LEAD: QrCompletionSubmission = {
    organizationId: 'org-a',
    leadCreated: true,
    isTest: false,
    tracking: { qr: 'AbCd2345' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.countCampaignCompletion.mockResolvedValue(true);
  });

  it("counts a lead the submission created for the campaign of the submission's organization", async () => {
    expect(await countQrCompletion(tx, NEW_LEAD)).toBe(true);
    expect(mocks.countCampaignCompletion).toHaveBeenCalledTimes(1);
    expect(mocks.countCampaignCompletion).toHaveBeenCalledWith(tx, {
      organizationId: 'org-a',
      shortCode: 'AbCd2345',
    });
  });

  it('answers false when no campaign of the organization has the code', async () => {
    mocks.countCampaignCompletion.mockResolvedValue(false);
    expect(await countQrCompletion(tx, NEW_LEAD)).toBe(false);
  });

  it('does not count a submission linked to a lead that was already there', async () => {
    expect(await countQrCompletion(tx, { ...NEW_LEAD, leadCreated: false })).toBe(false);
    expect(mocks.countCampaignCompletion).not.toHaveBeenCalled();
  });

  it('does not count a test answer', async () => {
    expect(await countQrCompletion(tx, { ...NEW_LEAD, isTest: true })).toBe(false);
    expect(mocks.countCampaignCompletion).not.toHaveBeenCalled();
  });

  it('asks nothing of the database for an answer without a code', async () => {
    for (const tracking of [{}, { qr: undefined }, { qr: '' }]) {
      expect(await countQrCompletion(tx, { ...NEW_LEAD, tracking })).toBe(false);
    }
    expect(mocks.countCampaignCompletion).not.toHaveBeenCalled();
  });
});
