/**
 * notifyAxMigrationSubmission: which channels fire for which events.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accessAnswers, as400Answers } from '@/test/fixtures/ax-migration';

const webhookMock = vi.fn();
const inAppMock = vi.fn();
const sendEmailMock = vi.fn();
const isEmailConfiguredMock = vi.fn();
const quotaMock = vi.fn();
const env: { AX_DIAGNOSIS_SALES_EMAIL?: string } = {};

vi.mock('@/lib/env', () => ({ env }));
// Only the notice on data that needs care (#828) reads the database (the lead, its assignee, the
// members): its tests add select, the others see the empty object they compare against
const { dbMock, selectRows } = vi.hoisted(() => ({
  dbMock: {} as Record<string, unknown>,
  selectRows: [] as unknown[][],
}));
vi.mock('@/lib/db/client', () => ({ db: dbMock }));
// The AX diagnosis's organization is the operator's: its sales addresses are mailed (#481)
vi.mock('@/lib/features/diagnostics/organization', () => ({
  resolveDiagnosisOrganizationId: () => 'org-1',
}));
vi.mock('@/lib/features/diagnostics/rate-limit', () => ({
  consumeRateLimit: (...args: unknown[]) => quotaMock(...args),
}));
vi.mock('@/lib/features/webhooks/services/webhook-service', () => ({
  triggerWebhooks: (...args: unknown[]) => webhookMock(...args),
}));
// The members' own settings: only the notice on data that needs care (#828) reads them, when it
// falls back to every member
const prefsMock = vi.fn();
const wantsMock = vi.fn();
vi.mock('@/lib/features/notifications/notification-service', () => ({
  notifyOrganizationMembers: (...args: unknown[]) => inAppMock(...args),
  getOrCreatePreferences: (...args: unknown[]) => prefsMock(...args),
  shouldSendInAppNotification: (...args: unknown[]) => wantsMock(...args),
}));
const effectMock = vi.fn();
vi.mock('@/lib/features/challenge-guide/service', () => ({
  challengeEffectLine: (...args: unknown[]) => effectMock(...args),
}));
vi.mock('@/lib/features/email', () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
  isEmailConfigured: () => isEmailConfiguredMock(),
}));
// Who hears about a consultation request: the intake members (窓口, #135) when the organization
// has any. Most tests use an organization without them.
const recipientsMock = vi.fn();
const inAppIntakeMock = vi.fn();
vi.mock('@/lib/features/leads/assignment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/features/leads/assignment')>()),
  consultationRecipients: (...args: unknown[]) => recipientsMock(...args),
}));
vi.mock('@/lib/features/leads/assignment-notify', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/features/leads/assignment-notify')>()),
  notifyUsersInApp: (...args: unknown[]) => inAppIntakeMock(...args),
}));

const {
  notifyAxMigrationSubmission,
  buildSalesMessage,
  buildSalesEmail,
  buildDataAttentionNotice,
  notifyAccessDataAttention,
} = await import('@/lib/features/diagnostics/ax-migration/notify');
const { evaluateAxMigration } = await import('@/lib/features/diagnostics/ax-migration/evaluate');
const { splitAddresses } = await import('@/lib/features/leads/assignment');

/** Target industry and system, nothing that shows interest: 適合 only */
const result = evaluateAxMigration({ ...as400Answers, role: 'it_staff' });

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
    effectMock.mockResolvedValue(null);
    // No intake members: every member in-app, the sales addresses by email
    recipientsMock.mockImplementation(
      async (_db: unknown, _organizationId: string, salesEmail: string | undefined) => ({
        intakeUserIds: [],
        emails: splitAddresses(salesEmail),
      })
    );
    inAppIntakeMock.mockResolvedValue(undefined);
  });

  it('tells sales which conditions the Access path does not require (#292)', () => {
    const access = evaluateAxMigration(
      { ...accessAnswers, industry: 'other', role: 'business_staff', annual_revenue: 'over_30b' },
      undefined,
      new Date('2026-10-21T09:00:00+09:00'),
      {},
      { annual_revenue: ['1b_3b'], employees: [], sites: [] }
    );
    const { message } = buildSalesMessage({ ...base, result: access });
    expect(message).toContain('MQL: 適合のみ（システムは対象。業種・企業規模は問わない経路。');
    expect(message).toContain('企業規模: 対象の範囲外（この経路では問わない）');
  });

  it('tells sales the recommended Access path, and nothing for older results or other systems (#303)', async () => {
    const access = evaluateAxMigration(
      { ...accessAnswers, access_challenges: ['remote'] },
      undefined,
      new Date('2026-10-21T09:00:00+09:00')
    );
    expect(buildSalesMessage({ ...base, result: access }).message).toContain(
      '移行元: Microsoft Access / 進め方の目安: Web に移す /'
    );
    const { accessPath: _stored, ...older } = access;
    expect(buildSalesMessage({ ...base, result: older }).message).not.toContain('進め方の目安');
    expect(buildSalesMessage(base).message).not.toContain('進め方の目安');
    // The sales email shows the same row in its result table (#285)
    expect(
      buildSalesEmail({ ...base, result: access }, null, 'https://example.com/ja/leads/1').text
    ).toContain('進め方の目安: Web に移す');
    expect(buildSalesEmail(base, null, 'https://example.com/ja/leads/1').text).not.toContain(
      '進め方の目安'
    );

    await notifyAxMigrationSubmission({ ...base, result: access });
    expect(webhookMock).toHaveBeenCalledWith(
      'org-1',
      'diagnostic.submitted',
      expect.objectContaining({ platform: 'access', accessPath: 'web' })
    );
  });

  it('says nothing about what to ask when the diagnosis has no main challenge (#75)', () => {
    const none = { ...result, challenges: { ...result.challenges, primary: null } };
    const { message } = buildSalesMessage({ ...base, result: none }, '保守費を毎年下げられる');
    expect(message).toContain('主な課題: 特になし');
    expect(message).not.toContain('伝える効果');
    expect(message).not.toContain('次に聞くこと');
  });

  it('adds one line of the playbook effect and points to the lead page, never to webhooks (#75)', async () => {
    effectMock.mockResolvedValue('保守費を毎年下げられる');
    await notifyAxMigrationSubmission({ ...base, consultationRequested: true });
    expect(effectMock).toHaveBeenCalledWith('org-1', result.challenges.primary);
    const [, , , message] = inAppMock.mock.calls[0];
    expect(message).toContain('伝える効果: 保守費を毎年下げられる');
    expect(message).toContain('次に聞くことはリード画面で確認してください');
    expect(sendEmailMock.mock.calls[0][0].text).toContain('伝える効果: 保守費を毎年下げられる');
    expect(JSON.stringify(webhookMock.mock.calls[0])).not.toContain('保守費');
  });

  it('always triggers the diagnostic.submitted webhook', async () => {
    await notifyAxMigrationSubmission({ ...base, leadCreated: false });
    expect(webhookMock).toHaveBeenCalledWith(
      'org-1',
      'diagnostic.submitted',
      expect.objectContaining({
        leadId: 'lead-1',
        mql: false,
        mqlCandidate: true,
        mqlLevel: 'fit',
        mqlSignals: [],
      })
    );
  });

  it('notifies members in-app about a new lead', async () => {
    await notifyAxMigrationSubmission(base);
    expect(inAppMock).toHaveBeenCalledWith(
      'org-1',
      'lead_created',
      expect.stringContaining('【AX診断・適合】'),
      expect.stringContaining('MQL: 適合のみ'),
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
      expect.stringContaining('【相談申込・関心あり（MQL）】'),
      expect.any(String),
      expect.any(Object)
    );
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['sales1@example.jp', 'sales2@example.jp'],
        // The request itself is the strong signal, also when the stored result predates it
        subject: expect.stringMatching(/^【相談申込・関心あり（MQL）】/),
        text: expect.stringContaining('MQL: 関心あり（相談申込）'),
        html: expect.stringContaining('関心あり（相談申込）'),
      })
    );
    expect(webhookMock).toHaveBeenCalledWith(
      'org-1',
      'diagnostic.submitted',
      expect.objectContaining({ mql: true, mqlLevel: 'interest', mqlSignals: ['consultation'] })
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
      expect.stringContaining('【AX診断・別システム・適合】'),
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
    expect(title).toMatch(/^【相談申込・関心あり（MQL）】/);
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

  it('notifies no one about a plain submission past the hourly limit (the notice went out before)', async () => {
    overLimit('ax-notify-org', 150);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await notifyAxMigrationSubmission(base);
    expect(webhookMock).not.toHaveBeenCalled();
    expect(inAppMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('still shows a consultation request in the app past the hourly limit, without webhooks (#232)', async () => {
    overLimit('ax-notify-org', 150);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await notifyAxMigrationSubmission({ ...base, consultationRequested: true });
    expect(webhookMock).not.toHaveBeenCalled();
    expect(inAppMock).toHaveBeenCalledWith(
      'org-1',
      'consultation_requested',
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ consultationRequested: true })
    );
    // and by email, within the email quota
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0].to).toEqual(['sales1@example.jp', 'sales2@example.jp']);
    warnSpy.mockRestore();
  });

  it('notifies no one about a consultation request past both hourly limits (#232)', async () => {
    quotaMock.mockImplementation(async (_db: unknown, rule: { name: string }) =>
      rule.name === 'ax-notify-org' || rule.name === 'ax-notify-consultation-org'
        ? { allowed: false, count: 400, retryAfterSeconds: 3600 }
        : { allowed: true, count: 1, retryAfterSeconds: 0 }
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await notifyAxMigrationSubmission({ ...base, consultationRequested: true });
    expect(webhookMock).not.toHaveBeenCalled();
    expect(inAppMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('does not count plain submissions against the consultation cap (#232)', async () => {
    overLimit('ax-notify-org', 150);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await notifyAxMigrationSubmission(base);
    expect(quotaMock).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'ax-notify-consultation-org' }),
      expect.anything()
    );
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
      expect.stringContaining('相談申込は引き続き通知します'),
      expect.objectContaining({ limit: 'ax-notify-org' })
    );
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0].subject).toBe('【AX診断】通知を一時停止しました');
    expect(webhookMock).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  describe('with intake members (窓口, #135)', () => {
    const intake = {
      intakeUserIds: ['user-intake-1', 'user-intake-2'],
      emails: ['intake1@example.jp', 'intake2@example.jp'],
    };
    beforeEach(() => {
      recipientsMock.mockResolvedValue(intake);
    });

    /** The request reached the intake members only: in-app and, when `email`, by email */
    const expectIntakeOnly = (email: boolean) => {
      expect(inAppIntakeMock).toHaveBeenCalledTimes(1);
      expect(inAppIntakeMock).toHaveBeenCalledWith(
        intake.intakeUserIds,
        'org-1',
        'consultation_requested',
        expect.stringMatching(/^【相談申込・関心あり（MQL）】テスト製作所/),
        expect.stringContaining('相談申込がありました'),
        expect.objectContaining({ leadId: 'lead-1', consultationRequested: true })
      );
      // Not every member, and not the sales addresses
      expect(inAppMock).not.toHaveBeenCalledWith(
        'org-1',
        'consultation_requested',
        expect.anything(),
        expect.anything(),
        expect.anything()
      );
      if (email) {
        const requestEmails = sendEmailMock.mock.calls.filter(([mail]) =>
          String(mail.subject).startsWith('【相談申込')
        );
        expect(requestEmails).toEqual([[expect.objectContaining({ to: intake.emails })]]);
      } else {
        // No email at all, whatever its subject (the counts used are past a cap, not the first
        // over it, so no limit notice goes out either)
        expect(sendEmailMock).not.toHaveBeenCalled();
      }
    };

    it('sends a consultation request to the intake members only, in-app and by email', async () => {
      await notifyAxMigrationSubmission({ ...base, consultationRequested: true });
      expect(recipientsMock).toHaveBeenCalledWith(
        {},
        'org-1',
        'sales1@example.jp, sales2@example.jp'
      );
      expectIntakeOnly(true);
      expect(inAppMock).not.toHaveBeenCalled();
      expect(webhookMock).toHaveBeenCalled();
    });

    it('still reaches them past the hourly notification limit, without webhooks (#232, #241)', async () => {
      overLimit('ax-notify-org', 150);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await notifyAxMigrationSubmission({ ...base, consultationRequested: true });
      expect(quotaMock).toHaveBeenCalledWith(
        {},
        expect.objectContaining({ name: 'ax-notify-consultation-org' }),
        'org-1'
      );
      expect(webhookMock).not.toHaveBeenCalled();
      expectIntakeOnly(true);
      warnSpy.mockRestore();
    });

    it('keeps them in the app past the email cap (#241)', async () => {
      overLimit('ax-sales-email-org-hour', 15);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await notifyAxMigrationSubmission({ ...base, consultationRequested: true });
      expectIntakeOnly(false);
      warnSpy.mockRestore();
    });

    it('reaches no one past both hourly limits, without reading them (#232)', async () => {
      quotaMock.mockImplementation(async (_db: unknown, rule: { name: string }) =>
        rule.name === 'ax-notify-org' || rule.name === 'ax-notify-consultation-org'
          ? { allowed: false, count: 400, retryAfterSeconds: 3600 }
          : { allowed: true, count: 1, retryAfterSeconds: 0 }
      );
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await notifyAxMigrationSubmission({ ...base, consultationRequested: true });
      expect(recipientsMock).not.toHaveBeenCalled();
      expect(inAppIntakeMock).not.toHaveBeenCalled();
      expect(inAppMock).not.toHaveBeenCalled();
      expect(sendEmailMock).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('leaves a new lead without a consultation request to every member', async () => {
      await notifyAxMigrationSubmission(base);
      expect(recipientsMock).not.toHaveBeenCalled();
      expect(inAppIntakeMock).not.toHaveBeenCalled();
      expect(inAppMock).toHaveBeenCalledWith(
        'org-1',
        'lead_created',
        expect.any(String),
        expect.any(String),
        expect.any(Object)
      );
      expect(sendEmailMock).not.toHaveBeenCalled();
    });
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

describe('data that needs care in an Access tool (#828)', () => {
  const CHECK = '受けるかどうかや進め方（委託の覚書・作業の場所・エンジニアの同席）を、初回の相談の前に社内で確かめてください。';
  const notice = {
    organizationId: 'org-1',
    leadId: 'lead-1',
    submissionId: 'sub-1',
    kinds: ['sensitive', 'my_number'],
    consultationRequested: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    selectRows.length = 0;
    // Each select reads the next rows, whatever the query is made of
    dbMock.select = () => {
      const rows = selectRows.shift() ?? [];
      const query = {
        from: () => query,
        innerJoin: () => query,
        where: () => query,
        limit: () => query,
        then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(rows).then(resolve, reject),
      };
      return query;
    };
    quotaMock.mockResolvedValue({ allowed: true, count: 1, retryAfterSeconds: 0 });
    recipientsMock.mockResolvedValue({ intakeUserIds: [], emails: [] });
    inAppMock.mockResolvedValue(undefined);
    inAppIntakeMock.mockResolvedValue(undefined);
    prefsMock.mockImplementation(async (userId: string) => ({ userId }));
    wantsMock.mockReturnValue(true);
  });

  afterEach(() => {
    delete dbMock.select;
  });

  it('puts it first in the consultation notice, in the words of the question', () => {
    const { message } = buildSalesMessage({
      ...base,
      consultationRequested: true,
      dataAttention: ['sensitive', 'payment'],
    });
    expect(message).toContain(
      `取り扱いに注意する情報: 健康・病歴など、特に配慮が要る個人情報・クレジットカードの番号や銀行口座（${CHECK}）`
    );
    expect(message.indexOf('取り扱いに注意する情報')).toBeLessThan(message.indexOf('移行難易度'));
    // Nothing without such data
    expect(buildSalesMessage({ ...base, dataAttention: [] }).message).not.toContain('取り扱いに注意');
    expect(buildSalesMessage(base).message).not.toContain('取り扱いに注意');
  });

  it('marks the consultation email with a badge and a notice', () => {
    const email = buildSalesEmail(
      { ...base, consultationRequested: true, dataAttention: ['my_number'] },
      null,
      'https://example.com/ja/leads/1'
    );
    expect(email.text).toContain('取り扱いに注意する情報');
    expect(email.text).toContain(`マイナンバーが、ツールに入っていると回答しています。${CHECK}`);
    expect(
      buildSalesEmail({ ...base, consultationRequested: true }, null, 'https://example.com/ja/leads/1')
        .text
    ).not.toContain('取り扱いに注意');
  });

  it('words the follow-up notice as an in-house check, with no promise either way', () => {
    const { title, message } = buildDataAttentionNotice({
      company: 'テスト製作所',
      name: '山田',
      kinds: ['my_number', 'payment'],
    });
    expect(title).toBe(
      '【取り扱いに注意する情報】テスト製作所 山田 様の Access のツールに、マイナンバー・クレジットカードの番号や銀行口座が入っていると回答がありました'
    );
    expect(message).toContain(CHECK);
    expect(`${title}${message}`).not.toMatch(/お受けします|お受けできません|無料|必ず|安全/);
    expect(
      buildDataAttentionNotice({ company: null, name: null, kinds: ['sensitive'] }).title
    ).toContain('リードの Access のツールに');
  });

  it("tells the lead's assignee when there is one", async () => {
    selectRows.push(
      [{ name: '山田', company: 'テスト製作所', assigneeId: 'user-9' }],
      [{ userId: 'user-9', name: '担当', email: 'tanto@example.jp', role: 'member' }]
    );
    await notifyAccessDataAttention(notice);
    expect(inAppIntakeMock).toHaveBeenCalledTimes(1);
    expect(inAppIntakeMock).toHaveBeenCalledWith(
      ['user-9'],
      'org-1',
      'data_attention',
      expect.stringContaining('健康・病歴など、特に配慮が要る個人情報・マイナンバー'),
      expect.stringContaining('初回の相談の前に'),
      { leadId: 'lead-1', submissionId: 'sub-1', diagnosticKey: 'ax-migration', dataKinds: ['sensitive', 'my_number'] }
    );
    expect(inAppMock).not.toHaveBeenCalled();
  });

  it('tells the intake members when the lead has no assignee, or the assignee left', async () => {
    recipientsMock.mockResolvedValue({ intakeUserIds: ['user-1', 'user-2'], emails: [] });
    selectRows.push([{ name: '山田', company: 'テスト製作所', assigneeId: null }]);
    await notifyAccessDataAttention(notice);
    expect(inAppIntakeMock).toHaveBeenCalledWith(
      ['user-1', 'user-2'],
      'org-1',
      'data_attention',
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ leadId: 'lead-1' })
    );

    vi.clearAllMocks();
    recipientsMock.mockResolvedValue({ intakeUserIds: ['user-1'], emails: [] });
    quotaMock.mockResolvedValue({ allowed: true, count: 1, retryAfterSeconds: 0 });
    // The assignee is no longer a member, or can no longer hold leads (viewing only): the
    // query of the members who can hold leads finds nobody (its conditions are in the DB test)
    selectRows.push([{ name: '山田', company: 'テスト製作所', assigneeId: 'user-9' }], []);
    await notifyAccessDataAttention(notice);
    expect(inAppIntakeMock).toHaveBeenCalledWith(
      ['user-1'],
      'org-1',
      'data_attention',
      expect.any(String),
      expect.any(String),
      expect.anything()
    );
  });

  it('tells every member who takes consultation notices when there is neither an assignee nor intake members', async () => {
    selectRows.push(
      [{ name: '山田', company: 'テスト製作所', assigneeId: null }],
      [{ userId: 'user-1' }, { userId: 'user-2' }, { userId: 'user-3' }]
    );
    // user-2 turned off the notices of consultation requests
    wantsMock.mockImplementation((_type: string, prefs: { userId: string }) => prefs.userId !== 'user-2');
    await notifyAccessDataAttention(notice);
    expect(wantsMock).toHaveBeenCalledWith('consultation_requested', expect.anything());
    expect(inAppIntakeMock).toHaveBeenCalledWith(
      ['user-1', 'user-3'],
      'org-1',
      'data_attention',
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ dataKinds: ['sensitive', 'my_number'] })
    );
    expect(inAppMock).not.toHaveBeenCalled();
  });

  it('tells a member whose setting cannot be read, and nobody when all turned them off', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    selectRows.push(
      [{ name: '山田', company: 'テスト製作所', assigneeId: null }],
      [{ userId: 'user-1' }, { userId: 'user-2' }]
    );
    prefsMock.mockImplementation(async (userId: string) => {
      if (userId === 'user-1') throw new Error('db down');
      return { userId };
    });
    wantsMock.mockReturnValue(false);
    await notifyAccessDataAttention(notice);
    expect(inAppIntakeMock).toHaveBeenCalledWith(
      ['user-1'],
      'org-1',
      'data_attention',
      expect.any(String),
      expect.any(String),
      expect.anything()
    );

    vi.clearAllMocks();
    quotaMock.mockResolvedValue({ allowed: true, count: 1, retryAfterSeconds: 0 });
    prefsMock.mockImplementation(async (userId: string) => ({ userId }));
    wantsMock.mockReturnValue(false);
    selectRows.push(
      [{ name: '山田', company: 'テスト製作所', assigneeId: null }],
      [{ userId: 'user-1' }, { userId: 'user-2' }]
    );
    await notifyAccessDataAttention(notice);
    expect(inAppIntakeMock).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('sends nothing past the hourly limit or without the lead', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    quotaMock.mockResolvedValue({ allowed: false, count: 99, retryAfterSeconds: 60 });
    await notifyAccessDataAttention(notice);
    quotaMock.mockResolvedValue({ allowed: true, count: 1, retryAfterSeconds: 0 });
    await notifyAccessDataAttention(notice);
    expect(inAppMock).not.toHaveBeenCalled();
    expect(inAppIntakeMock).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('uses the consultation cap past the hourly limit when a consultation was requested (#232)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    recipientsMock.mockResolvedValue({ intakeUserIds: ['user-1'], emails: [] });
    // Past the hourly limit, within the consultation cap
    quotaMock
      .mockResolvedValueOnce({ allowed: false, count: 99, retryAfterSeconds: 60 })
      .mockResolvedValueOnce({ allowed: true, count: 1, retryAfterSeconds: 0 });
    selectRows.push([{ name: '山田', company: 'テスト製作所', assigneeId: null }]);
    await notifyAccessDataAttention({ ...notice, consultationRequested: true });
    expect(quotaMock).toHaveBeenCalledTimes(2);
    expect(inAppIntakeMock).toHaveBeenCalledWith(
      ['user-1'],
      'org-1',
      'data_attention',
      expect.any(String),
      expect.any(String),
      expect.anything()
    );

    // Without a consultation request the cap is not used
    vi.clearAllMocks();
    quotaMock.mockResolvedValue({ allowed: false, count: 99, retryAfterSeconds: 60 });
    await notifyAccessDataAttention(notice);
    expect(quotaMock).toHaveBeenCalledTimes(1);
    expect(inAppIntakeMock).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('leaves a failure to the caller, which reports it', async () => {
    selectRows.push([{ name: '山田', company: 'テスト製作所', assigneeId: null }]);
    recipientsMock.mockResolvedValue({ intakeUserIds: ['user-1'], emails: [] });
    inAppIntakeMock.mockRejectedValue(new Error('insert failed'));
    await expect(notifyAccessDataAttention(notice)).rejects.toThrow('insert failed');
  });
});
