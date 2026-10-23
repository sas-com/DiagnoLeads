/**
 * API routes of the AX result by email (#154): the request from the result screen and the
 * buttons of the confirm page. The real route handlers are imported; the flow, the rate limits
 * and the database are mocked.
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const requestMock = vi.fn();
const confirmMock = vi.fn();
const declineMock = vi.fn();
const limitsMock = vi.fn();

const rejectedMock = vi.fn();

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  // Run the after() work at once so what it reports can be checked
  after: (task: () => unknown) => {
    void task();
  },
}));
vi.mock('@/lib/db/client', () => ({ db: {} }));
vi.mock('@/lib/ops/alert', () => ({
  reportServerError: vi.fn(),
  reportRejectedRequest: (...args: unknown[]) => rejectedMock(...args),
}));
vi.mock('@/lib/features/email/email-service', () => ({ sendEmail: vi.fn() }));
vi.mock('@/lib/features/diagnostics/ax-migration/result-email-flow', () => ({
  requestAxResultEmail: (...args: unknown[]) => requestMock(...args),
  confirmAxResultEmail: (...args: unknown[]) => confirmMock(...args),
  declineAxResultEmail: (...args: unknown[]) => declineMock(...args),
}));
vi.mock('@/lib/features/diagnostics/rate-limit', () => ({
  consumeRateLimits: (...args: unknown[]) => limitsMock(...args),
}));

const requestRoute = await import('@/app/api/diagnostics/ax-migration/result-email/route');
const confirmRoute = await import('@/app/api/diagnostics/ax-migration/result-email/confirm/route');

const SUBMISSION = '3f2c4a1e-8b7d-4c6e-9a5b-1d2e3f4a5b6c';
const TOKEN = 'AbC-_123456789012345678901234567890123456789';

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });

beforeEach(() => {
    rejectedMock.mockReset();
  vi.clearAllMocks();
  vi.stubEnv('AX_RESULT_EMAIL_ENABLED', 'true');
  requestMock.mockResolvedValue({ outcome: 'accepted', delivery: 'sent' });
  confirmMock.mockResolvedValue('sent');
  declineMock.mockResolvedValue('declined');
  limitsMock.mockResolvedValue({ allowed: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/diagnostics/ax-migration/result-email', () => {
  const PATH = '/api/diagnostics/ax-migration/result-email';
  const body = { submissionId: SUBMISSION, locale: 'ja' };

  it('passes only the submission and the language to the flow', async () => {
    const response = await requestRoute.POST(post(PATH, body));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'accepted' });
    expect(requestMock).toHaveBeenCalledWith(
      expect.anything(),
      { sendEmail: expect.any(Function) },
      { submissionId: SUBMISSION, locale: 'ja' }
    );
  });

  it.each([
    { outcome: 'accepted', delivery: 'sent' },
    { outcome: 'accepted', delivery: 'suppressed' },
    { outcome: 'accepted', delivery: 'recent_confirmation' },
    { outcome: 'accepted', delivery: 'not_allowed' },
    // A second press for the same diagnosis: telling it apart would show whether the first one
    // sent a confirmation (or found the address suppressed) or not
    { outcome: 'already_requested' },
  ])('answers the same accepted for %o', async (outcome) => {
    requestMock.mockResolvedValue(outcome);
    const response = await requestRoute.POST(post(PATH, body));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'accepted' });
  });

  it('cannot tell a second request for the same submission from a first one', async () => {
    requestMock.mockResolvedValueOnce({ outcome: 'accepted', delivery: 'recent_confirmation' });
    requestMock.mockResolvedValueOnce({ outcome: 'already_requested' });
    const first = await requestRoute.POST(post(PATH, body));
    const second = await requestRoute.POST(post(PATH, body));
    expect(second.status).toBe(first.status);
    expect(await second.text()).toBe(await first.text());
  });

  it.each([
    [{ outcome: 'closed' }, 409, { error: 'Closed', status: 'closed' }],
    [{ outcome: 'not_found' }, 404, { error: 'Not found' }],
    [{ outcome: 'unavailable' }, 503, { error: 'Unavailable', status: 'unavailable' }],
  ])('maps %o to %i', async (outcome, status, json) => {
    requestMock.mockResolvedValue(outcome);
    const response = await requestRoute.POST(post(PATH, body));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(json);
  });

  it.each([undefined, 'false', ''])('answers 404 while the feature flag is %s', async (value) => {
    if (value === undefined) vi.stubEnv('AX_RESULT_EMAIL_ENABLED', undefined as unknown as string);
    else vi.stubEnv('AX_RESULT_EMAIL_ENABLED', value);
    const response = await requestRoute.POST(post(PATH, body));
    expect(response.status).toBe(404);
    expect(requestMock).not.toHaveBeenCalled();
    expect(limitsMock).not.toHaveBeenCalled();
  });

  it('refuses another media type (415) and another origin (403)', async () => {
    const form = await requestRoute.POST(
      post(PATH, 'submissionId=x', { 'content-type': 'application/x-www-form-urlencoded' })
    );
    expect(form.status).toBe(415);
    const foreign = await requestRoute.POST(post(PATH, body, { origin: 'https://evil.example' }));
    expect(foreign.status).toBe(403);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it.each([
    ['no submission', { locale: 'ja' }],
    ['not a uuid', { submissionId: 'abc', locale: 'ja' }],
    ['another language', { submissionId: SUBMISSION, locale: 'fr' }],
    ['an address (never taken from the request)', { submissionId: SUBMISSION, locale: 'ja', email: 'x@example.com' }],
  ])('validates the body: %s', async (_, invalid) => {
    const response = await requestRoute.POST(post(PATH, invalid));
    // Unknown keys are dropped by zod; the address in the body is never used
    if ('email' in invalid) {
      expect(response.status).toBe(200);
      expect(requestMock.mock.calls[0][2]).toEqual({ submissionId: SUBMISSION, locale: 'ja' });
    } else {
      expect(response.status).toBe(400);
      expect(requestMock).not.toHaveBeenCalled();
    }
  });

  it('limits per address on Vercel (429 with Retry-After)', async () => {
    vi.stubEnv('VERCEL', '1');
    limitsMock.mockResolvedValue({ allowed: false, rule: 'ax-result-email-ip', retryAfterSeconds: 120 });
    const response = await requestRoute.POST(post(PATH, body, { 'x-real-ip': '203.0.113.7' }));
    expect(response.status).toBe(429);
    expect(rejectedMock).toHaveBeenCalledWith(expect.any(String), 'rate_limited');
    expect(response.headers.get('Retry-After')).toBe('120');
    expect(limitsMock.mock.calls[0][1]).toEqual([
      { rule: expect.objectContaining({ name: 'ax-result-email-ip', limit: 10 }), identifier: '203.0.113.7' },
    ]);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('answers 500 and logs no address when the flow fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    requestMock.mockRejectedValue(new Error('db down for taro@example.com'));
    const response = await requestRoute.POST(post(PATH, body));
    expect(response.status).toBe(500);
    expect(JSON.stringify(log.mock.calls)).not.toContain('taro@example.com');
    log.mockRestore();
  });
});

describe('POST /api/diagnostics/ax-migration/result-email/confirm', () => {
  const PATH = '/api/diagnostics/ax-migration/result-email/confirm';

  it.each(['sent', 'already_sent', 'expired_or_invalid', 'busy', 'unsubscribed'])(
    'answers %s for confirm',
    async (status) => {
      confirmMock.mockResolvedValue(status);
      const response = await confirmRoute.POST(post(PATH, { token: TOKEN, action: 'confirm' }));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status });
      expect(confirmMock).toHaveBeenCalledWith(
        expect.anything(),
        { sendEmail: expect.any(Function) },
        { token: TOKEN }
      );
      expect(declineMock).not.toHaveBeenCalled();
    }
  );

  it('answers 503 when the result could not be sent (the link stays valid)', async () => {
    confirmMock.mockResolvedValue('failed');
    const response = await confirmRoute.POST(post(PATH, { token: TOKEN, action: 'confirm' }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Unavailable', status: 'unavailable' });
  });

  it('declines with the token', async () => {
    const response = await confirmRoute.POST(post(PATH, { token: TOKEN, action: 'decline' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'declined' });
    expect(declineMock).toHaveBeenCalledWith(expect.anything(), { token: TOKEN });
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('works while the feature flag is off (a mailed confirmation keeps working)', async () => {
    vi.stubEnv('AX_RESULT_EMAIL_ENABLED', 'false');
    const response = await confirmRoute.POST(post(PATH, { token: TOKEN, action: 'confirm' }));
    expect(response.status).toBe(200);
  });

  it.each([
    ['no token', { action: 'confirm' }],
    ['a short token', { token: 'abc', action: 'confirm' }],
    ['other characters', { token: `${TOKEN.slice(0, 40)}+/=`, action: 'confirm' }],
    ['no action', { token: TOKEN }],
    ['another action', { token: TOKEN, action: 'unsubscribe' }],
  ])('refuses %s (400)', async (_, invalid) => {
    const response = await confirmRoute.POST(post(PATH, invalid));
    expect(response.status).toBe(400);
    expect(confirmMock).not.toHaveBeenCalled();
    expect(declineMock).not.toHaveBeenCalled();
  });

  it('refuses another media type (415), another origin (403) and a large body (413)', async () => {
    expect(
      (
        await confirmRoute.POST(
          post(PATH, `token=${TOKEN}`, { 'content-type': 'application/x-www-form-urlencoded' })
        )
      ).status
    ).toBe(415);
    expect(
      (await confirmRoute.POST(post(PATH, { token: TOKEN, action: 'confirm' }, { origin: 'https://evil.example' })))
        .status
    ).toBe(403);
    expect(
      (await confirmRoute.POST(post(PATH, { token: TOKEN, action: 'confirm', pad: 'x'.repeat(400) }))).status
    ).toBe(413);
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('limits per address on Vercel (20 an hour)', async () => {
    vi.stubEnv('VERCEL', '1');
    limitsMock.mockResolvedValue({ allowed: false, rule: 'ax-result-email-confirm-ip', retryAfterSeconds: 60 });
    const response = await confirmRoute.POST(
      post(PATH, { token: TOKEN, action: 'confirm' }, { 'x-real-ip': '203.0.113.7' })
    );
    expect(response.status).toBe(429);
    expect(rejectedMock).toHaveBeenCalledWith(expect.any(String), 'rate_limited');
    expect(limitsMock.mock.calls[0][1][0].rule).toMatchObject({ name: 'ax-result-email-confirm-ip', limit: 20 });
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('answers 500 and logs no token when the flow fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    confirmMock.mockRejectedValue(new Error(`boom ${TOKEN}`));
    const response = await confirmRoute.POST(post(PATH, { token: TOKEN, action: 'confirm' }));
    expect(response.status).toBe(500);
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN);
    log.mockRestore();
  });
});
