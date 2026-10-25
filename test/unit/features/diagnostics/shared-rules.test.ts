/**
 * #481: the AX diagnosis and the builder's diagnoses follow the same rules
 * (lib/features/diagnostics/service.ts): the notification limits and who hears about a
 * consultation request, the limit notices (mailed only for the operator's organization) and the
 * inflow source of an issued agency link. DB access and the channels are mocked.
 */
import type { DiagnosisNotification } from '@/lib/features/diagnosis-builder/notify';
import type { AxMigrationNotification } from '@/lib/features/diagnostics/ax-migration/notify';
import { as400Answers } from '@/test/fixtures/ax-migration';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const webhookMock = vi.fn();
const leadCreatedMock = vi.fn();
const inAppMock = vi.fn();
const sendEmailMock = vi.fn();
const quotaMock = vi.fn();
const agencyLinkMock = vi.fn();
const operator = vi.hoisted(() => ({ id: 'org-operator' as string | null }));
const env: { AX_DIAGNOSIS_SALES_EMAIL?: string } = {};

vi.mock('@/lib/env', () => ({ env }));
vi.mock('@/lib/db/client', () => ({ db: {} }));
vi.mock('@/lib/features/diagnostics/organization', () => ({
  resolveDiagnosisOrganizationId: () => operator.id,
}));
vi.mock('@/lib/features/diagnostics/rate-limit', () => ({
  consumeRateLimit: (...args: unknown[]) => quotaMock(...args),
}));
vi.mock('@/lib/features/webhooks/services/webhook-service', () => ({
  triggerWebhooks: (...args: unknown[]) => webhookMock(...args),
}));
vi.mock('@/lib/features/webhooks/services/lead-events', () => ({
  sendLeadCreatedById: (...args: unknown[]) => leadCreatedMock(...args),
}));
vi.mock('@/lib/features/notifications/notification-service', () => ({
  notifyOrganizationMembers: (...args: unknown[]) => inAppMock(...args),
}));
vi.mock('@/lib/features/challenge-guide/service', () => ({
  challengeEffectLine: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/features/email', () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
  isEmailConfigured: () => true,
}));
vi.mock('@/lib/features/agency-links/service', () => ({
  findActiveAgencyLink: (...args: unknown[]) => agencyLinkMock(...args),
}));
// No intake members: every member in-app, the sales addresses (when given) by email
vi.mock('@/lib/features/leads/assignment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/features/leads/assignment')>();
  return {
    ...actual,
    consultationRecipients: async (_db: unknown, _org: string, salesEmail?: string) => ({
      intakeUserIds: [],
      emails: actual.splitAddresses(salesEmail),
    }),
  };
});

const { notifyAxMigrationSubmission } = await import(
  '@/lib/features/diagnostics/ax-migration/notify'
);
const { notifyDiagnosisSubmission } = await import('@/lib/features/diagnosis-builder/notify');
const { evaluateAxMigration } = await import('@/lib/features/diagnostics/ax-migration/evaluate');
const { resolveInflow } = await import('@/lib/features/diagnostics/service');

const requestedAt = new Date('2026-10-16T01:00:00Z');

const axNotice = (organizationId: string, consultationRequested: boolean) =>
  ({
    organizationId,
    leadId: 'lead-1',
    submissionId: 'sub-1',
    company: '架空商事',
    name: '試験 太郎',
    email: 'taro@example.co.jp',
    result: evaluateAxMigration(as400Answers),
    consultationRequested,
    leadCreated: true,
    identityUnverified: false,
    requestedAt,
  }) satisfies AxMigrationNotification;

const builderNotice = (organizationId: string, consultationRequested: boolean) =>
  ({
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
    consultationRequested,
    leadCreated: true,
    identityUnverified: false,
    requestedAt,
  }) satisfies DiagnosisNotification;

type LimitKind = 'notifications' | 'consultation' | 'email';
const kindOf = (name: string): LimitKind =>
  name.includes('consultation') ? 'consultation' : name.includes('email') ? 'email' : 'notifications';

/** Each limit answers as given; `over` is how far a refused one is past its limit */
function limitsAnswer(allowed: Record<LimitKind, boolean>, over = 2) {
  quotaMock.mockImplementation(async (_db: unknown, rule: { name: string; limit: number }) => ({
    allowed: allowed[kindOf(rule.name)],
    count: allowed[kindOf(rule.name)] ? 1 : rule.limit + over,
    retryAfterSeconds: 0,
  }));
}

/** What went out, apart from what names the diagnosis */
function channels() {
  return {
    webhooks: webhookMock.mock.calls.length,
    leadCreated: leadCreatedMock.mock.calls.length,
    inApp: inAppMock.mock.calls.map((call) => call[1]),
    emails: sendEmailMock.mock.calls.map((call) => call[0].to),
    limits: quotaMock.mock.calls.map((call) => kindOf(call[1].name)),
  };
}

async function run(notify: () => Promise<void>) {
  vi.clearAllMocks();
  webhookMock.mockResolvedValue({ triggered: 1, failed: 0 });
  leadCreatedMock.mockResolvedValue(undefined);
  inAppMock.mockResolvedValue(undefined);
  sendEmailMock.mockResolvedValue({ id: 'mail-1' });
  await notify();
  return channels();
}

beforeEach(() => {
  operator.id = 'org-operator';
  env.AX_DIAGNOSIS_SALES_EMAIL = 'sales@example.jp';
});

describe('the notification rules of the AX diagnosis and the builder (#481)', () => {
  const states: Record<LimitKind, boolean>[] = [
    { notifications: true, consultation: true, email: true },
    // Past the hourly limit: only a consultation request, in-app and by email, no webhooks
    { notifications: false, consultation: true, email: true },
    { notifications: false, consultation: false, email: true },
    // Past the email cap: in-app only
    { notifications: true, consultation: true, email: false },
  ];

  for (const state of states) {
    for (const consultationRequested of [true, false]) {
      it(`sends the same for ${JSON.stringify(state)}, request ${consultationRequested}`, async () => {
        limitsAnswer(state);
        const ax = await run(() =>
          notifyAxMigrationSubmission(axNotice('org-operator', consultationRequested))
        );
        limitsAnswer(state);
        const builder = await run(() =>
          notifyDiagnosisSubmission(builderNotice('org-operator', consultationRequested))
        );
        expect(builder).toEqual(ax);
      });
    }
  }

  it('keeps a consultation request in the app past the hourly limit, without webhooks', async () => {
    limitsAnswer({ notifications: false, consultation: true, email: true });
    const builder = await run(() => notifyDiagnosisSubmission(builderNotice('org-operator', true)));
    expect(builder).toMatchObject({
      webhooks: 0,
      leadCreated: 0,
      inApp: ['consultation_requested'],
      emails: [['sales@example.jp']],
    });
  });

  it('tells the operator organization once by email and in-app when a limit is reached', async () => {
    limitsAnswer({ notifications: false, consultation: false, email: true }, 1);
    await run(() => notifyDiagnosisSubmission(builderNotice('org-operator', false)));
    expect(inAppMock).toHaveBeenCalledWith(
      'org-operator',
      'system',
      '【診断】通知を一時停止しました',
      expect.stringContaining('診断の通知が1時間に100件を超えた'),
      { diagnosisId: 'diag-1', limit: 'dx-notify-org' }
    );
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0]).toMatchObject({
      to: ['sales@example.jp'],
      subject: '【診断】通知を一時停止しました',
    });
  });

  it('never mails the operator sales about the limits of another organization', async () => {
    for (const notify of [
      () => notifyAxMigrationSubmission(axNotice('org-other', true)),
      () => notifyDiagnosisSubmission(builderNotice('org-other', true)),
    ]) {
      limitsAnswer({ notifications: false, consultation: false, email: false }, 1);
      await run(notify);
      // The members of that organization are told in-app; no email leaves at all
      expect(inAppMock).toHaveBeenCalledWith(
        'org-other',
        'system',
        expect.stringContaining('通知を一時停止しました'),
        expect.any(String),
        expect.objectContaining({ limit: expect.any(String) })
      );
      expect(sendEmailMock).not.toHaveBeenCalled();
    }
  });

  it('sends a consultation request of another organization to no sales address', async () => {
    limitsAnswer({ notifications: true, consultation: true, email: true });
    const ax = await run(() => notifyAxMigrationSubmission(axNotice('org-other', true)));
    const builder = await run(() => notifyDiagnosisSubmission(builderNotice('org-other', true)));
    expect(ax.emails).toEqual([]);
    expect(builder.emails).toEqual([]);
    expect(builder.inApp).toEqual(['consultation_requested']);
  });
});

describe('resolveInflow (#147, #265, #481)', () => {
  const database = {} as Parameters<typeof resolveInflow>[0];

  it('takes an issued agency link over the UTM parameters', async () => {
    agencyLinkMock.mockResolvedValue({
      id: 'link-1',
      agencyName: '架空テレアポ',
      kind: 'telemarketing_agency',
      memberUserId: null,
    });
    expect(
      await resolveInflow(database, 'org-1', { agency: 'abc', utmMedium: 'cpc', ref: 'x' })
    ).toEqual({
      inflowSource: 'telemarketing_agency',
      referrerName: null,
      agencyName: '架空テレアポ',
      agencyLinkId: 'link-1',
      referralMemberUserId: null,
    });
    expect(agencyLinkMock).toHaveBeenCalledWith(database, 'org-1', 'abc');
  });

  it("names the employee of an employee's own link as the referrer, not as an agency", async () => {
    agencyLinkMock.mockResolvedValue({
      id: 'link-2',
      agencyName: '社員 花子',
      kind: 'member_referral',
      memberUserId: 'user-1',
    });
    expect(await resolveInflow(database, 'org-1', { agency: 'def' })).toEqual({
      inflowSource: 'member_referral',
      referrerName: '社員 花子',
      agencyName: null,
      agencyLinkId: 'link-2',
      referralMemberUserId: 'user-1',
    });
  });

  it('falls back to the UTM parameters without a valid link', async () => {
    agencyLinkMock.mockResolvedValue(null);
    expect(await resolveInflow(database, 'org-1', { utmMedium: 'cpc' })).toEqual({
      inflowSource: 'advertising',
      referrerName: null,
      agencyName: null,
      agencyLinkId: null,
      referralMemberUserId: null,
    });
  });
});
