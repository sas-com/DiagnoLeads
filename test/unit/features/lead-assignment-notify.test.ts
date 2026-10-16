/**
 * #135 notifications: consultation requests go to the intake members (窓口) when set, and the
 * assignee is told when a lead is assigned to them.
 */
import { as400Answers } from '@/test/fixtures/ax-migration';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendEmailMock = vi.fn();
const isEmailConfiguredMock = vi.fn();
const createNotificationMock = vi.fn();
const consultationRecipientsMock = vi.fn();
const inAppAllMock = vi.fn();
const prefs = { inAppAssignedToMe: true, inAppConsultationRequested: true };
const prefsMock = vi.fn();
const env: { AX_DIAGNOSIS_SALES_EMAIL?: string } = {};

vi.mock('@/lib/env', () => ({ env }));
vi.mock('@/lib/db/client', () => ({ db: { marker: 'db' } }));
vi.mock('@/lib/features/diagnostics/rate-limit', () => ({
  consumeRateLimit: vi.fn().mockResolvedValue({ allowed: true, count: 1, retryAfterSeconds: 0 }),
}));
vi.mock('@/lib/features/webhooks/services/webhook-service', () => ({
  triggerWebhooks: vi.fn().mockResolvedValue({ triggered: 0, failed: 0 }),
}));
vi.mock('@/lib/features/notifications/notification-service', () => ({
  notifyOrganizationMembers: (...args: unknown[]) => inAppAllMock(...args),
  createNotification: (...args: unknown[]) => createNotificationMock(...args),
  getOrCreatePreferences: (...args: unknown[]) => prefsMock(...args),
  shouldSendInAppNotification: (type: string, p: typeof prefs) =>
    type === 'lead_assigned' ? p.inAppAssignedToMe : p.inAppConsultationRequested,
}));
vi.mock('@/lib/features/email', () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
  isEmailConfigured: () => isEmailConfiguredMock(),
}));
vi.mock('@/lib/features/leads/assignment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/features/leads/assignment')>()),
  consultationRecipients: (...args: unknown[]) => consultationRecipientsMock(...args),
}));

const { notifyAxMigrationSubmission } = await import('@/lib/features/diagnostics/ax-migration/notify');
const { evaluateAxMigration } = await import('@/lib/features/diagnostics/ax-migration/evaluate');
const { notifyLeadAssigned, buildAssignmentMessage } = await import(
  '@/lib/features/leads/assignment-notify'
);
const { consultationRecipients: realConsultationRecipients, splitAddresses } =
  await vi.importActual<typeof import('@/lib/features/leads/assignment')>(
    '@/lib/features/leads/assignment'
  );

const consultation = {
  organizationId: 'org-1',
  leadId: 'lead-1',
  submissionId: 'sub-1',
  company: 'テスト製作所',
  name: '山田',
  email: 'yamada@example.jp',
  result: evaluateAxMigration(as400Answers),
  consultationRequested: true,
  leadCreated: true,
  identityUnverified: false,
  requestedAt: new Date('2026-10-09T01:00:00Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  sendEmailMock.mockResolvedValue({ id: 'mail-1' });
  inAppAllMock.mockResolvedValue(undefined);
  prefs.inAppAssignedToMe = true;
  prefs.inAppConsultationRequested = true;
  prefsMock.mockImplementation(async () => prefs);
  createNotificationMock.mockResolvedValue(undefined);
  isEmailConfiguredMock.mockReturnValue(true);
  env.AX_DIAGNOSIS_SALES_EMAIL = 'sales@example.jp';
});

afterEach(() => {
  delete process.env.APP_TEST_MODE;
});

describe('consultation request recipients', () => {
  it('tells only the intake members, in-app and by email, when intake is set', async () => {
    consultationRecipientsMock.mockResolvedValue({
      intakeUserIds: ['user-a', 'user-b'],
      emails: ['intake@example.jp', 'intake2@example.jp'],
    });
    await notifyAxMigrationSubmission(consultation);
    expect(consultationRecipientsMock).toHaveBeenCalledWith({ marker: 'db' }, 'org-1', 'sales@example.jp');
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: ['intake@example.jp', 'intake2@example.jp'] })
    );
    expect(inAppAllMock).not.toHaveBeenCalled();
    expect(createNotificationMock).toHaveBeenCalledTimes(2);
    expect(createNotificationMock.mock.calls.map(([n]) => n.userId)).toEqual(['user-a', 'user-b']);
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        type: 'consultation_requested',
        title: expect.stringContaining('【相談申込'),
        data: expect.objectContaining({ leadId: 'lead-1' }),
      })
    );
  });

  it("respects an intake member's own setting for consultation requests in-app", async () => {
    consultationRecipientsMock.mockResolvedValue({
      intakeUserIds: ['user-a', 'user-b'],
      emails: ['intake@example.jp'],
    });
    prefsMock.mockImplementation(async (userId: string) =>
      userId === 'user-a' ? { ...prefs, inAppConsultationRequested: false } : prefs
    );
    await notifyAxMigrationSubmission(consultation);
    expect(createNotificationMock.mock.calls.map(([n]) => n.userId)).toEqual(['user-b']);
    expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({ to: ['intake@example.jp'] }));
  });

  it('tells every member in-app and the sales addresses by email without intake', async () => {
    consultationRecipientsMock.mockResolvedValue({ intakeUserIds: [], emails: ['sales@example.jp'] });
    await notifyAxMigrationSubmission(consultation);
    expect(inAppAllMock).toHaveBeenCalledWith(
      'org-1',
      'consultation_requested',
      expect.any(String),
      expect.any(String),
      expect.any(Object)
    );
    expect(createNotificationMock).not.toHaveBeenCalled();
    expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({ to: ['sales@example.jp'] }));
  });

  it('keeps notifying every member about new leads without a consultation request', async () => {
    await notifyAxMigrationSubmission({ ...consultation, consultationRequested: false });
    expect(inAppAllMock).toHaveBeenCalledWith(
      'org-1',
      'lead_created',
      expect.any(String),
      expect.any(String),
      expect.any(Object)
    );
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  it('applies the test mode filter to the intake members too', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.APP_TEST_MODE = 'true';
    consultationRecipientsMock.mockResolvedValue({
      intakeUserIds: ['user-a', 'user-b'],
      emails: ['intake@sas-com.com', 'outside@example.jp'],
    });
    await notifyAxMigrationSubmission(consultation);
    expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({ to: ['intake@sas-com.com'] }));
    warn.mockRestore();
  });

  it('does not look up the intake for a diagnosis without a consultation request', async () => {
    await notifyAxMigrationSubmission({ ...consultation, consultationRequested: false });
    expect(consultationRecipientsMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('falls back to the sales addresses when the intake cannot be read', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = {
      select: () => {
        throw new Error('db down');
      },
    };
    // biome-ignore lint/suspicious/noExplicitAny: a database that fails
    const recipients = await realConsultationRecipients(broken as any, 'org-1', 'a@example.jp, b@example.jp');
    expect(recipients).toEqual({ intakeUserIds: [], emails: ['a@example.jp', 'b@example.jp'] });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('splits the sales address setting', () => {
    expect(splitAddresses(' a@example.jp, ,b@example.jp ')).toEqual(['a@example.jp', 'b@example.jp']);
    expect(splitAddresses(undefined)).toEqual([]);
  });
});

describe('notifyLeadAssigned', () => {
  const assigned = {
    organizationId: 'org-1',
    leadId: 'lead-1',
    leadName: '山田',
    company: 'テスト<製作所>',
    assignee: { userId: 'user-2', email: 'sato@example.jp', name: '佐藤' },
    assignedByName: '窓口 太郎',
  };

  it('tells the assignee in-app and by email, with a link to the lead', async () => {
    await notifyLeadAssigned(assigned);
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-2',
        organizationId: 'org-1',
        type: 'lead_assigned',
        data: { leadId: 'lead-1' },
      })
    );
    const mail = sendEmailMock.mock.calls[0][0];
    expect(mail.to).toEqual(['sato@example.jp']);
    expect(mail.subject).toBe('【担当割り当て】テスト<製作所> 山田 様 の担当になりました');
    expect(mail.text).toContain('窓口 太郎 さんが');
    expect(mail.text).toContain('/ja/leads/lead-1');
    expect(mail.html).toContain('テスト&lt;製作所&gt;');
    expect(mail.html).not.toContain('テスト<製作所>');
  });

  it('mails only company addresses in test mode (the in-app notification still goes)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.APP_TEST_MODE = 'true';
    await notifyLeadAssigned(assigned);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(createNotificationMock).toHaveBeenCalled();

    await notifyLeadAssigned({ ...assigned, assignee: { ...assigned.assignee, email: 'sato@sas-com.com' } });
    expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({ to: ['sato@sas-com.com'] }));
    warn.mockRestore();
  });

  it('sends no email when the mail provider is not configured', async () => {
    isEmailConfiguredMock.mockReturnValue(false);
    await notifyLeadAssigned(assigned);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(createNotificationMock).toHaveBeenCalled();
  });

  it('never rejects when a channel fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    createNotificationMock.mockRejectedValue(new Error('db'));
    sendEmailMock.mockRejectedValue(new Error('mail'));
    await expect(notifyLeadAssigned(assigned)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  it('sends nothing when the assignee turned off 自分が担当に割り当てられたとき', async () => {
    prefs.inAppAssignedToMe = false;
    await notifyLeadAssigned(assigned);
    expect(prefsMock).toHaveBeenCalledWith('user-2', 'org-1');
    expect(createNotificationMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('still notifies when the setting cannot be read', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    prefsMock.mockRejectedValue(new Error('db'));
    await notifyLeadAssigned(assigned);
    expect(createNotificationMock).toHaveBeenCalled();
    expect(sendEmailMock).toHaveBeenCalled();
    error.mockRestore();
  });

  it('reads well without a company or name', async () => {
    const { title } = buildAssignmentMessage(
      { ...assigned, company: null, leadName: null, assignedByName: null },
      'https://app.example.jp'
    );
    expect(title).toBe('【担当割り当て】リード の担当になりました');
  });
});
