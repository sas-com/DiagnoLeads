import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendEmail = vi.fn(async () => ({ id: 'mail-1' }));
const isEmailConfigured = vi.fn(() => true);
vi.mock('@/lib/features/email', () => ({ sendEmail, isEmailConfigured }));

const consumeRateLimit = vi.fn();
vi.mock('@/lib/features/diagnostics/rate-limit', () => ({ consumeRateLimit }));

const env: Record<string, string | undefined> = {};
vi.mock('@/lib/env', () => ({ env }));

const { reportServerError, summarizeServerError } = await import('@/lib/ops/alert');
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
    const mail = sendEmail.mock.calls[0]?.[0] as unknown as { to: string[]; subject: string; text: string };
    expect(mail.to).toEqual(['sales@sas-com.com']);
    expect(mail.subject).toContain('ax-diagnosis/submit');
    expect(mail.text).toContain('PostgresError (23505)');
    expect(mail.text).not.toContain('taro@example.co.jp');

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
