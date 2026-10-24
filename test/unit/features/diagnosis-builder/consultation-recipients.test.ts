/**
 * #481: a consultation request on a builder diagnosis reaches only people of the diagnosis's
 * organization. The sales addresses (AX_DIAGNOSIS_SALES_EMAIL) are used only for the operator's
 * organization (the one that receives the AX diagnosis) when it has no intake members.
 */
import type { DiagnosisNotification } from '@/lib/features/diagnosis-builder/notify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendEmailMock = vi.fn();
const isEmailConfiguredMock = vi.fn();
const createNotificationMock = vi.fn();
const inAppAllMock = vi.fn();
const consultationRecipientsMock = vi.fn();
const operator = vi.hoisted(() => ({ id: null as string | null }));
const env: { AX_DIAGNOSIS_SALES_EMAIL?: string } = {};

vi.mock('@/lib/env', () => ({ env }));
vi.mock('@/lib/db/client', () => ({ db: { marker: 'db' } }));
vi.mock('@/lib/features/diagnostics/organization', () => ({
  resolveDiagnosisOrganizationId: () => operator.id,
}));
vi.mock('@/lib/features/diagnostics/rate-limit', () => ({
  consumeRateLimit: vi.fn().mockResolvedValue({ allowed: true, count: 1, retryAfterSeconds: 0 }),
}));
vi.mock('@/lib/features/webhooks/services/webhook-service', () => ({
  triggerWebhooks: vi.fn().mockResolvedValue({ triggered: 0, failed: 0 }),
}));
vi.mock('@/lib/features/webhooks/services/lead-events', () => ({
  sendLeadCreatedById: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/features/notifications/notification-service', () => ({
  notifyOrganizationMembers: (...args: unknown[]) => inAppAllMock(...args),
  createNotification: (...args: unknown[]) => createNotificationMock(...args),
  getOrCreatePreferences: vi.fn().mockResolvedValue({ inAppConsultationRequested: true }),
  shouldSendInAppNotification: () => true,
}));
vi.mock('@/lib/features/email', () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
  isEmailConfigured: () => isEmailConfiguredMock(),
}));
vi.mock('@/lib/features/leads/assignment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/features/leads/assignment')>()),
  consultationRecipients: (...args: unknown[]) => consultationRecipientsMock(...args),
}));

const { builderConsultationRecipients, notifyDiagnosisSubmission } = await import(
  '@/lib/features/diagnosis-builder/notify'
);

const OPERATOR = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const consultation = (organizationId: string): DiagnosisNotification => ({
  organizationId,
  diagnosisId: 'diag-1',
  diagnosisTitle: '架空の準備度チェック',
  leadId: 'lead-1',
  submissionId: 'sub-1',
  company: '架空商事',
  name: '試験 太郎',
  email: 'taro@example.co.jp',
  resultTypeName: '計画型',
  leadScore: 70,
  mqlLevel: 'interest',
  mqlQualified: true,
  mqlReasons: ['相談申込'],
  consultationRequested: true,
  leadCreated: false,
  identityUnverified: false,
  requestedAt: new Date('2026-10-16T01:00:00Z'),
});

beforeEach(() => {
  vi.clearAllMocks();
  sendEmailMock.mockResolvedValue({ id: 'mail-1' });
  inAppAllMock.mockResolvedValue(undefined);
  createNotificationMock.mockResolvedValue(undefined);
  isEmailConfiguredMock.mockReturnValue(true);
  operator.id = OPERATOR;
  env.AX_DIAGNOSIS_SALES_EMAIL = 'sales@example.jp';
});

describe('builderConsultationRecipients', () => {
  it("falls back to the sales addresses only for the operator's organization", async () => {
    consultationRecipientsMock.mockResolvedValue({ intakeUserIds: [], emails: [] });
    await builderConsultationRecipients({ marker: 'tx' } as never, OPERATOR);
    expect(consultationRecipientsMock).toHaveBeenLastCalledWith(
      { marker: 'tx' },
      OPERATOR,
      'sales@example.jp'
    );
    await builderConsultationRecipients({ marker: 'tx' } as never, OTHER);
    expect(consultationRecipientsMock).toHaveBeenLastCalledWith({ marker: 'tx' }, OTHER, undefined);
  });

  it('gives no organization the sales addresses when no operator is configured', async () => {
    operator.id = null;
    consultationRecipientsMock.mockResolvedValue({ intakeUserIds: [], emails: [] });
    await builderConsultationRecipients({ marker: 'tx' } as never, OPERATOR);
    expect(consultationRecipientsMock).toHaveBeenLastCalledWith({ marker: 'tx' }, OPERATOR, undefined);
  });
});

describe('notifyDiagnosisSubmission: consultation recipients', () => {
  it("mails the sales addresses for the operator's diagnosis without intake", async () => {
    consultationRecipientsMock.mockResolvedValue({ intakeUserIds: [], emails: ['sales@example.jp'] });
    await notifyDiagnosisSubmission(consultation(OPERATOR));
    expect(consultationRecipientsMock).toHaveBeenCalledWith({ marker: 'db' }, OPERATOR, 'sales@example.jp');
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({ to: ['sales@example.jp'] }));
    expect(inAppAllMock).toHaveBeenCalledWith(
      OPERATOR,
      'consultation_requested',
      expect.any(String),
      expect.any(String),
      expect.any(Object)
    );
  });

  it('never mails the sales addresses for another organization without intake (in-app to its members)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consultationRecipientsMock.mockResolvedValue({ intakeUserIds: [], emails: [] });
    await notifyDiagnosisSubmission(consultation(OTHER));
    expect(consultationRecipientsMock).toHaveBeenCalledWith({ marker: 'db' }, OTHER, undefined);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(inAppAllMock).toHaveBeenCalledWith(
      OTHER,
      'consultation_requested',
      expect.any(String),
      expect.any(String),
      expect.any(Object)
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no intake member'));
    warn.mockRestore();
  });

  it('tells a test-mode filter apart from a missing address in the runtime logs', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('APP_TEST_MODE', 'true');
    vi.stubEnv('APP_TEST_MODE_EMAIL_DOMAINS', 'company.example.jp');
    try {
      consultationRecipientsMock.mockResolvedValue({
        intakeUserIds: ['user-a'],
        emails: ['a@other.example.jp'],
      });
      await notifyDiagnosisSubmission(consultation(OTHER));
      expect(sendEmailMock).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('no recipient is allowed in test mode'));
      expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('no intake member'));
    } finally {
      vi.unstubAllEnvs();
      warn.mockRestore();
    }
  });

  it('tells only the intake members of the organization, in-app and by email', async () => {
    consultationRecipientsMock.mockResolvedValue({
      intakeUserIds: ['user-a', 'user-b'],
      emails: ['a@other.example.jp', 'b@other.example.jp'],
    });
    await notifyDiagnosisSubmission(consultation(OTHER));
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: ['a@other.example.jp', 'b@other.example.jp'] })
    );
    expect(inAppAllMock).not.toHaveBeenCalled();
    expect(createNotificationMock.mock.calls.map(([n]) => [n.userId, n.organizationId])).toEqual([
      ['user-a', OTHER],
      ['user-b', OTHER],
    ]);
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'consultation_requested', data: expect.objectContaining({ leadId: 'lead-1' }) })
    );
  });

  it('does not look up the recipients for a submission without a consultation request', async () => {
    await notifyDiagnosisSubmission({
      ...consultation(OTHER),
      consultationRequested: false,
      leadCreated: true,
    });
    expect(consultationRecipientsMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(inAppAllMock).toHaveBeenCalledWith(
      OTHER,
      'lead_created',
      expect.any(String),
      expect.any(String),
      expect.any(Object)
    );
  });
});
