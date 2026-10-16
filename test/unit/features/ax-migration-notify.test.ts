/**
 * notifyAxMigrationSubmission: which channels fire for which events.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { as400Answers } from '@/test/fixtures/ax-migration';

const webhookMock = vi.fn();
const inAppMock = vi.fn();
const sendEmailMock = vi.fn();
const isEmailConfiguredMock = vi.fn();
const quotaMock = vi.fn();
const env: { AX_DIAGNOSIS_SALES_EMAIL?: string } = {};

vi.mock('@/lib/env', () => ({ env }));
vi.mock('@/lib/db/client', () => ({ db: {} }));
vi.mock('@/lib/features/diagnostics/rate-limit', () => ({
  consumeRateLimit: (...args: unknown[]) => quotaMock(...args),
}));
vi.mock('@/lib/features/webhooks/services/webhook-service', () => ({
  triggerWebhooks: (...args: unknown[]) => webhookMock(...args),
}));
vi.mock('@/lib/features/notifications/notification-service', () => ({
  notifyOrganizationMembers: (...args: unknown[]) => inAppMock(...args),
}));
vi.mock('@/lib/features/email', () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
  isEmailConfigured: () => isEmailConfiguredMock(),
}));

const { notifyAxMigrationSubmission } = await import('@/lib/features/diagnostics/ax-migration/notify');
const { evaluateAxMigration } = await import('@/lib/features/diagnostics/ax-migration/evaluate');

const result = evaluateAxMigration(as400Answers);

const base = {
  organizationId: 'org-1',
  leadId: 'lead-1',
  submissionId: 'sub-1',
  company: 'テスト製作所',
  name: '山田',
  email: 'yamada@example.jp',
  result,
  consultationRequested: false,
  leadCreated: true,
  identityUnverified: false,
  requestedAt: new Date('2026-10-09T01:00:00Z'),
};

describe('notifyAxMigrationSubmission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    webhookMock.mockResolvedValue({ triggered: 1, failed: 0 });
    inAppMock.mockResolvedValue(undefined);
    sendEmailMock.mockResolvedValue({ id: 'mail-1' });
    isEmailConfiguredMock.mockReturnValue(true);
    quotaMock.mockResolvedValue({ allowed: true, count: 1, retryAfterSeconds: 0 });
    env.AX_DIAGNOSIS_SALES_EMAIL = 'sales1@example.jp, sales2@example.jp';
  });

  it('always triggers the diagnostic.submitted webhook', async () => {
    await notifyAxMigrationSubmission({ ...base, leadCreated: false });
    expect(webhookMock).toHaveBeenCalledWith(
      'org-1',
      'diagnostic.submitted',
      expect.objectContaining({ leadId: 'lead-1', mqlCandidate: true })
    );
  });

  it('notifies members in-app about a new lead', async () => {
    await notifyAxMigrationSubmission(base);
    expect(inAppMock).toHaveBeenCalledWith(
      'org-1',
      'lead_created',
      expect.stringContaining('【AX診断】'),
      expect.any(String),
      expect.objectContaining({ submissionId: 'sub-1' })
    );
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('does not ping members for a repeat answer without a consultation request', async () => {
    await notifyAxMigrationSubmission({ ...base, leadCreated: false, identityUnverified: true });
    expect(inAppMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('sends a consultation request in-app and by email to every sales address', async () => {
    await notifyAxMigrationSubmission({ ...base, consultationRequested: true });
    expect(inAppMock).toHaveBeenCalledWith(
      'org-1',
      'consultation_requested',
      expect.stringContaining('【相談申込】'),
      expect.any(String),
      expect.any(Object)
    );
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: ['sales1@example.jp', 'sales2@example.jp'] })
    );
  });

  it('in test mode mails only company sales addresses, and skips without using the quota when none', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.APP_TEST_MODE = 'true';
    try {
      env.AX_DIAGNOSIS_SALES_EMAIL = 'sales@sas-com.com, partner@example.jp';
      await notifyAxMigrationSubmission({ ...base, consultationRequested: true });
      expect(sendEmailMock).toHaveBeenCalledWith(
        expect.objectContaining({ to: ['sales@sas-com.com'] })
      );

      sendEmailMock.mockClear();
      quotaMock.mockClear();
      env.AX_DIAGNOSIS_SALES_EMAIL = 'partner@example.jp';
      await notifyAxMigrationSubmission({ ...base, consultationRequested: true });
      expect(sendEmailMock).not.toHaveBeenCalled();
      expect(
        quotaMock.mock.calls.some(([rule]) => String((rule as { name: string }).name).startsWith('ax-sales-email'))
      ).toBe(false);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('allowed in test mode'));
      expect(inAppMock).toHaveBeenCalled();
    } finally {
      delete process.env.APP_TEST_MODE;
    }
  });

  it('skips the email when no sales address or mail provider is configured, and says so', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    env.AX_DIAGNOSIS_SALES_EMAIL = undefined;
    await notifyAxMigrationSubmission({ ...base, consultationRequested: true });
    isEmailConfiguredMock.mockReturnValue(false);
    env.AX_DIAGNOSIS_SALES_EMAIL = 'sales@example.jp';
    await notifyAxMigrationSubmission({ ...base, consultationRequested: true });
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy.mock.calls[0][0]).toContain('no sales email sent');
    warnSpy.mockRestore();
  });

  it('does not warn about the email for a diagnosis without a consultation request', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    env.AX_DIAGNOSIS_SALES_EMAIL = undefined;
    await notifyAxMigrationSubmission(base);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('escapes HTML in names put into the email body', async () => {
    await notifyAxMigrationSubmission({
      ...base,
      consultationRequested: true,
      company: '<script>alert(1)</script>',
    });
    const html: string = sendEmailMock.mock.calls[0][0].html;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('does not reject when one channel fails', async () => {
    webhookMock.mockRejectedValue(new Error('webhook down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      notifyAxMigrationSubmission({ ...base, consultationRequested: true })
    ).resolves.toBeUndefined();
    expect(sendEmailMock).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
  it('tells sales about another system of the same respondent, without the unverified mark', async () => {
    await notifyAxMigrationSubmission({ ...base, leadCreated: false, additionalSystem: true });
    expect(inAppMock).toHaveBeenCalledWith(
      'org-1',
      'lead_scored',
      expect.stringContaining('【AX診断・別システム】'),
      expect.stringContaining('最初の診断と同じ画面から、別のシステムも続けて診断されました'),
      expect.objectContaining({ additionalSystem: true, identityUnverified: false })
    );
    expect(inAppMock.mock.calls[0][2]).not.toContain('本人未確認');
    expect(webhookMock).toHaveBeenCalledWith(
      'org-1',
      'diagnostic.submitted',
      expect.objectContaining({ additionalSystem: true })
    );
  });

  it('keeps a consultation request from another system a plain consultation request', async () => {
    await notifyAxMigrationSubmission({
      ...base,
      leadCreated: false,
      additionalSystem: true,
      consultationRequested: true,
    });
    const [, type, title, message] = inAppMock.mock.calls[0];
    expect(type).toBe('consultation_requested');
    expect(title).toMatch(/^【相談申込】/);
    expect(message).toContain('別のシステムも続けて診断されました');
    expect(sendEmailMock).toHaveBeenCalled();
  });

  /** The quota answer for one rule; every other rule is within its limit */
  const overLimit = (ruleName: string, count: number) =>
    quotaMock.mockImplementation(async (_db: unknown, rule: { name: string; limit: number }) =>
      rule.name === ruleName
        ? { allowed: false, count, retryAfterSeconds: 3600 }
        : { allowed: true, count: 1, retryAfterSeconds: 0 }
    );

  it('sends no sales email past the daily limit, but still notifies in-app', async () => {
    overLimit('ax-sales-email-org', 40);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await notifyAxMigrationSubmission({ ...base, consultationRequested: true });
    expect(quotaMock).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ name: 'ax-sales-email-org' }),
      'org-1'
    );
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(inAppMock).toHaveBeenCalledTimes(1);
    expect(inAppMock.mock.calls[0][1]).toBe('consultation_requested');
    warnSpy.mockRestore();
  });

  it('tells the members and sales once when the daily email limit is reached', async () => {
    overLimit('ax-sales-email-org', 31);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await notifyAxMigrationSubmission({ ...base, consultationRequested: true });
    expect(inAppMock).toHaveBeenCalledWith(
      'org-1',
      'system',
      '【AX診断】営業宛てメールを一時停止しました',
      expect.stringContaining('1日30通'),
      expect.objectContaining({ limit: 'ax-sales-email-org' })
    );
    // One email that says so (sales who read only email learn it too); not the request itself
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: '【AX診断】営業宛てメールを一時停止しました',
        text: expect.stringContaining('コンバージョンポイント：相談申込'),
      })
    );
    warnSpy.mockRestore();
  });

  it('keeps a burst from using up the day: an hourly email cap, checked first', async () => {
    overLimit('ax-sales-email-org-hour', 11);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await notifyAxMigrationSubmission({ ...base, consultationRequested: true });
    // The request itself is in-app only, and the daily cap is not used up by it
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0].subject).toBe('【AX診断】営業宛てメールを一時停止しました');
    expect(sendEmailMock.mock.calls[0][0].text).toContain('1時間に10通');
    expect(quotaMock).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'ax-sales-email-org' }),
      expect.anything()
    );
    expect(inAppMock).toHaveBeenCalledWith(
      'org-1',
      'consultation_requested',
      expect.any(String),
      expect.any(String),
      expect.any(Object)
    );
    warnSpy.mockRestore();
  });

  it('sends no sales email when the daily limit cannot be checked', async () => {
    quotaMock.mockImplementation(async (_db: unknown, rule: { name: string }) => {
      if (rule.name === 'ax-sales-email-org') throw new Error('db down');
      return { allowed: true, count: 1, retryAfterSeconds: 0 };
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await notifyAxMigrationSubmission({ ...base, consultationRequested: true });
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(inAppMock).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('notifies no one past the hourly limit of the organization (the notice went out before)', async () => {
    overLimit('ax-notify-org', 150);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await notifyAxMigrationSubmission({ ...base, consultationRequested: true });
    expect(webhookMock).not.toHaveBeenCalled();
    expect(inAppMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('tells the members and sales once when the hourly limit is reached', async () => {
    overLimit('ax-notify-org', 101);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await notifyAxMigrationSubmission(base);
    expect(inAppMock).toHaveBeenCalledTimes(1);
    expect(inAppMock).toHaveBeenCalledWith(
      'org-1',
      'system',
      '【AX診断】通知を一時停止しました',
      expect.stringContaining('リード一覧（コンバージョンポイント：相談申込）で確認'),
      expect.objectContaining({ limit: 'ax-notify-org' })
    );
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0].subject).toBe('【AX診断】通知を一時停止しました');
    expect(webhookMock).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('still notifies when the hourly limit cannot be checked', async () => {
    quotaMock.mockImplementation(async (_db: unknown, rule: { name: string }) => {
      if (rule.name === 'ax-notify-org') throw new Error('db down');
      return { allowed: true, count: 1, retryAfterSeconds: 0 };
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await notifyAxMigrationSubmission(base);
    expect(webhookMock).toHaveBeenCalled();
    expect(inAppMock).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
