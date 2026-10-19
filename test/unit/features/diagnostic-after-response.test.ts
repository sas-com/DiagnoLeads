/**
 * The generic diagnosis form sends its webhooks and result email after the response with
 * after() (#69): nothing starts before the response, and both run when after() runs them.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { after, triggerWebhooks, sendEmail, mockDb } = vi.hoisted(() => {
  const mockDb = {
    select: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    insert: vi.fn(),
    values: vi.fn(),
    returning: vi.fn(),
  };
  return { after: vi.fn(), triggerWebhooks: vi.fn(), sendEmail: vi.fn(), mockDb };
});

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after,
}));
vi.mock('@/lib/db/client', () => ({ db: mockDb }));
vi.mock('@/lib/env', () => ({ env: { DEFAULT_ORGANIZATION_ID: 'org-1' } }));
vi.mock('@/lib/features/diagnostics/legacy-form', () => ({
  isLegacyDiagnosticFormEnabled: () => true,
}));
vi.mock('@/lib/features/email', () => ({
  isEmailConfigured: () => true,
  sendEmail,
  generateDiagnosticResultEmail: () => ({ subject: 'Result', html: '<p>r</p>', text: 'r' }),
}));
vi.mock('@/lib/features/webhooks/services/webhook-service', () => ({ triggerWebhooks }));

const { POST } = await import('@/app/api/diagnostic/route');

const submission = {
  companyName: 'Example Co',
  industry: 'technology',
  employeeCount: '51-200',
  name: 'Taro',
  email: 'taro@example.com',
  currentChallenge: 'c',
  primaryGoal: 'g',
  timeline: 'immediate',
  budget: '10k-50k',
  locale: 'en',
};

const submit = () =>
  POST(
    new NextRequest('https://example.com/api/diagnostic', {
      method: 'POST',
      body: JSON.stringify(submission),
    })
  );

describe('POST /api/diagnostic side effects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of ['select', 'from', 'where', 'insert', 'values'] as const) {
      mockDb[key].mockReturnValue(mockDb);
    }
    mockDb.limit.mockResolvedValue([{ id: 'org-1' }]);
    mockDb.returning.mockResolvedValue([{ id: 'lead-1' }]);
    triggerWebhooks.mockResolvedValue({ triggered: 1, failed: 0 });
    sendEmail.mockResolvedValue({ success: true });
  });

  it('responds without starting them, and schedules both with after()', async () => {
    const res = await submit();
    expect(res.status).toBe(200);
    expect(triggerWebhooks).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(after).toHaveBeenCalledTimes(2);

    await Promise.all(after.mock.calls.map(([task]) => (task as () => Promise<unknown>)()));
    expect(triggerWebhooks).toHaveBeenCalledWith(
      'org-1',
      'diagnostic.submitted',
      expect.objectContaining({ leadId: 'lead-1', email: 'taro@example.com', source: 'website' })
    );
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'taro@example.com', subject: 'Result' })
    );
  });

  it('a failing webhook or email does not reject the after() task', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    triggerWebhooks.mockRejectedValue(new Error('db down'));
    sendEmail.mockRejectedValue(new Error('smtp down'));
    await submit();
    for (const [task] of after.mock.calls) {
      await expect((task as () => Promise<unknown>)()).resolves.toBeUndefined();
    }
  });
});
