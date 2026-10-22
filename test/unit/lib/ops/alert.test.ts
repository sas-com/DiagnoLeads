import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendEmail = vi.fn(async () => ({ id: 'mail-1' }));
const isEmailConfigured = vi.fn(() => true);
vi.mock('@/lib/features/email', () => ({ sendEmail, isEmailConfigured }));

const consumeRateLimit = vi.fn();
vi.mock('@/lib/features/diagnostics/rate-limit', () => ({ consumeRateLimit }));

const env: Record<string, string | undefined> = {};
vi.mock('@/lib/env', () => ({ env }));

const { REJECTION_ALERT_RULE, reportRejectedRequest, reportServerError, summarizeServerError } =
  await import('@/lib/ops/alert');
const database = {} as never;

function dbError() {
  const error = new Error(
    'duplicate key value violates unique constraint "leads_email_key" for taro@example.co.jp'
  ) as Error & Record<string, unknown>;
  error.name = 'PostgresError';
  error.code = '23505';
  error.table_name = 'leads';
  error.constraint_name = 'leads_email_key';
  error.detail = 'Key (email)=(taro@example.co.jp) already exists.';
  return error;
}

beforeEach(() => {
  env.OPS_ALERT_EMAIL = undefined;
  env.AX_DIAGNOSIS_SALES_EMAIL = 'sales@sas-com.com';
  consumeRateLimit.mockResolvedValue({ allowed: true, count: 1, retryAfterSeconds: 600 });
});
afterEach(() => vi.clearAllMocks());

describe('summarizeServerError', () => {
  it('keeps names and code locations, never the message or detail', () => {
    const summary = summarizeServerError(dbError());
    expect(summary).toMatchObject({
      name: 'PostgresError',
      code: '23505',
      table: 'leads',
      constraint: 'leads_email_key',
    });
    expect(JSON.stringify(summary)).not.toContain('taro@example.co.jp');
  });
});

describe('summarizeServerError frames', () => {
  it('keeps real stack frames only, not message lines that look like one', () => {
    const error = new Error('lookup failed\nat taro@example.co.jp (entered by the respondent)');
    error.stack = [
      'Error: lookup failed',
      'at taro@example.co.jp (entered by the respondent)',
      '    at handler (/var/task/.next/server/app/api/route.js:1:2345)',
      '    at async run (node:internal/process/task_queues:95:5)',
    ].join('\n');
    expect(summarizeServerError(error).frames).toEqual([
      'at handler (/var/task/.next/server/app/api/route.js:1:2345)',
      'at async run (node:internal/process/task_queues:95:5)',
    ]);
  });
});

describe('reportServerError', () => {
  it('falls back to the per-instance count when the shared count hangs', async () => {
    vi.useFakeTimers();
    consumeRateLimit.mockReturnValue(new Promise(() => {}));
    const pending = reportServerError('cron/test-db-hang', dbError(), { database });
    await vi.advanceTimersByTimeAsync(2100);
    await pending;
    expect(sendEmail).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('emails the alert address, falling back to the AX sales address', async () => {
    await reportServerError('ax-diagnosis/submit', dbError(), { database });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const mail = sendEmail.mock.calls[0]?.[0] as unknown as {
      to: string[];
      subject: string;
      text: string;
      html: string;
    };
    expect(mail.to).toEqual(['sales@sas-com.com']);
    expect(mail.subject).toContain('ax-diagnosis/submit');
    expect(mail.text).toContain('PostgresError (23505)');
    expect(mail.text).not.toContain('taro@example.co.jp');
    expect(mail.html).toContain('PostgresError (23505)');
    expect(mail.html).not.toContain('taro@example.co.jp');

    env.OPS_ALERT_EMAIL = 'ops@sas-com.com, oncall@sas-com.com';
    await reportServerError('ax-diagnosis/submit', dbError(), { database });
    const second = sendEmail.mock.calls[1]?.[0] as unknown as { to: string[] };
    expect(second.to).toEqual(['ops@sas-com.com', 'oncall@sas-com.com']);
  });

  it('sends at most one alert per place within the window', async () => {
    consumeRateLimit.mockResolvedValue({ allowed: false, count: 2, retryAfterSeconds: 300 });
    await reportServerError('ax-diagnosis/submit', dbError(), { database });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('counts per instance when the database is down', async () => {
    consumeRateLimit.mockRejectedValue(new Error('connection refused'));
    const now = new Date('2026-10-18T00:00:00Z');
    await reportServerError('cron/test-db-down', dbError(), { database, now });
    await reportServerError('cron/test-db-down', dbError(), {
      database,
      now: new Date(now.getTime() + 60_000),
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('does nothing without a recipient or mail service, and never throws', async () => {
    env.AX_DIAGNOSIS_SALES_EMAIL = undefined;
    await reportServerError('x', dbError(), { database });
    expect(sendEmail).not.toHaveBeenCalled();

    env.AX_DIAGNOSIS_SALES_EMAIL = 'sales@sas-com.com';
    sendEmail.mockRejectedValueOnce(new Error('resend down'));
    await expect(reportServerError('y', dbError(), { database })).resolves.toBeUndefined();
  });
});

describe('reportRejectedRequest (#351)', () => {
  /** The shared count: refusals counted so far in this window, this one included */
  function counts(rejections: number) {
    consumeRateLimit.mockResolvedValue({
      allowed: rejections <= REJECTION_ALERT_RULE.limit,
      count: rejections,
      retryAfterSeconds: 600,
    });
  }

  it('counts each refusal per place and stays quiet up to the limit', async () => {
    counts(REJECTION_ALERT_RULE.limit);
    await reportRejectedRequest('ax-diagnosis/submit', 'verification_failed', { database });
    expect(consumeRateLimit).toHaveBeenCalledWith(
      database,
      REJECTION_ALERT_RULE,
      'ax-diagnosis/submit',
      expect.any(Date)
    );
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('emails once the limit is passed, with the place and the reason', async () => {
    counts(REJECTION_ALERT_RULE.limit + 1);
    await reportRejectedRequest('ax-diagnosis/submit', 'honeypot', { database });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    // One write per refusal: the count itself decides the one mail of the window
    expect(consumeRateLimit).toHaveBeenCalledTimes(1);
    const mail = sendEmail.mock.calls[0]?.[0] as unknown as {
      to: string[];
      subject: string;
      text: string;
    };
    expect(mail.to).toEqual(['sales@sas-com.com']);
    expect(mail.subject).toContain('ax-diagnosis/submit');
    expect(mail.text).toContain('honeypot');
    expect(mail.text).toContain(String(REJECTION_ALERT_RULE.limit + 1));
  });

  it('sends at most one alert per place within the window', async () => {
    counts(REJECTION_ALERT_RULE.limit + 2);
    await reportRejectedRequest('ax-diagnosis/submit', 'rate_limited', { database });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('counts nothing without a recipient or mail service', async () => {
    env.AX_DIAGNOSIS_SALES_EMAIL = undefined;
    counts(REJECTION_ALERT_RULE.limit + 1);
    await reportRejectedRequest('ax-diagnosis/submit', 'honeypot', { database });
    expect(consumeRateLimit).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('never throws, and sends nothing when the count cannot be taken', async () => {
    consumeRateLimit.mockRejectedValue(new Error('connection refused'));
    await expect(
      reportRejectedRequest('ax-diagnosis/submit', 'verification_failed', { database })
    ).resolves.toBeUndefined();
    expect(sendEmail).not.toHaveBeenCalled();

    counts(REJECTION_ALERT_RULE.limit + 1);
    sendEmail.mockRejectedValueOnce(new Error('resend down'));
    await expect(
      reportRejectedRequest('ax-diagnosis/submit', 'verification_failed', { database })
    ).resolves.toBeUndefined();
  });
});
