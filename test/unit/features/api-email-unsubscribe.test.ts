/**
 * Unsubscribe API routes of the respondent mail (#154): the page button (JSON, same origin)
 * and the RFC 8058 one-click POST (form, from mail providers). The real route handlers are
 * imported; the unsubscribe and the rate limits are mocked.
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const unsubscribeMock = vi.fn();
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
vi.mock('@/lib/features/respondent-email', () => ({
  unsubscribeByToken: (...args: unknown[]) => unsubscribeMock(...args),
}));
vi.mock('@/lib/features/diagnostics/rate-limit', () => ({
  consumeRateLimits: (...args: unknown[]) => limitsMock(...args),
}));

const page = await import('@/app/api/email/unsubscribe/route');
const oneClick = await import('@/app/api/email/unsubscribe/one-click/route');

const TOKEN = 'AbC-_123456789012345678901234567890123456789';

beforeEach(() => {
    rejectedMock.mockReset();
  vi.clearAllMocks();
  unsubscribeMock.mockResolvedValue('done');
  limitsMock.mockResolvedValue({ allowed: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/email/unsubscribe (page button)', () => {
  const request = (body: unknown, headers: Record<string, string> = {}) =>
    new NextRequest('http://localhost/api/email/unsubscribe', {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: { 'content-type': 'application/json', ...headers },
    });

  it('unsubscribes with the page as the source and answers done', async () => {
    const response = await page.POST(request({ token: TOKEN }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'done' });
    expect(unsubscribeMock).toHaveBeenCalledWith(expect.anything(), TOKEN, 'unsubscribe_page');
  });

  it('answers not_found for an unknown token', async () => {
    unsubscribeMock.mockResolvedValue('not_found');
    const response = await page.POST(request({ token: TOKEN }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'not_found' });
  });

  it('refuses another media type (415)', async () => {
    const response = await page.POST(
      request(`token=${TOKEN}`, { 'content-type': 'application/x-www-form-urlencoded' })
    );
    expect(response.status).toBe(415);
    expect(unsubscribeMock).not.toHaveBeenCalled();
  });

  it('refuses another origin (403) and accepts its own', async () => {
    const foreign = await page.POST(request({ token: TOKEN }, { origin: 'https://evil.example' }));
    expect(foreign.status).toBe(403);
    expect(unsubscribeMock).not.toHaveBeenCalled();
    const own = await page.POST(request({ token: TOKEN }, { origin: 'http://localhost' }));
    expect(own.status).toBe(200);
  });

  it.each([
    ['no token', {}],
    ['a short token', { token: 'abc' }],
    ['characters outside base64url', { token: `${TOKEN.slice(0, 40)}+/=` }],
    ['a long token', { token: 'a'.repeat(129) }],
    ['a number', { token: 42 }],
  ])('answers 400 for %s', async (_label, body) => {
    const response = await page.POST(request(body));
    expect(response.status).toBe(400);
    expect(unsubscribeMock).not.toHaveBeenCalled();
  });

  it('answers 400 for broken JSON and 413 for a large body', async () => {
    expect((await page.POST(request('{'))).status).toBe(400);
    expect((await page.POST(request({ token: TOKEN, pad: 'x'.repeat(400) }))).status).toBe(413);
  });

  it('counts per address on Vercel and answers 429 over the limit', async () => {
    vi.stubEnv('VERCEL', '1');
    limitsMock.mockResolvedValue({ allowed: false, rule: 'email-unsubscribe-ip', retryAfterSeconds: 90 });
    const response = await page.POST(request({ token: TOKEN }, { 'x-real-ip': '203.0.113.9' }));
    expect(response.status).toBe(429);
    expect(rejectedMock).toHaveBeenCalledWith(expect.any(String), 'rate_limited');
    expect(response.headers.get('Retry-After')).toBe('90');
    expect(limitsMock).toHaveBeenCalledWith(expect.anything(), [
      { rule: expect.objectContaining({ name: 'email-unsubscribe-ip' }), identifier: '203.0.113.9' },
    ]);
    expect(unsubscribeMock).not.toHaveBeenCalled();
  });

  it('does not count per address where the address cannot be trusted', async () => {
    await page.POST(request({ token: TOKEN }, { 'x-real-ip': '203.0.113.9' }));
    expect(limitsMock).not.toHaveBeenCalled();
  });

  it('answers 500 on a database error and logs no token', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    unsubscribeMock.mockRejectedValue(new Error(`db down ${TOKEN}`));
    const response = await page.POST(request({ token: TOKEN }));
    expect(response.status).toBe(500);
    expect(JSON.stringify(error.mock.calls)).not.toContain(TOKEN);
    error.mockRestore();
  });
});

describe('/api/email/unsubscribe/one-click (RFC 8058)', () => {
  const url = (token: string | null = TOKEN) =>
    `http://localhost/api/email/unsubscribe/one-click${token === null ? '' : `?t=${token}`}`;
  const form = (
    token: string | null = TOKEN,
    body: BodyInit = 'List-Unsubscribe=One-Click',
    headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' }
  ) => new NextRequest(url(token), { method: 'POST', body, headers });

  it('unsubscribes with one_click as the source and answers 200 with an empty body', async () => {
    const response = await oneClick.POST(form());
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    expect(unsubscribeMock).toHaveBeenCalledWith(expect.anything(), TOKEN, 'one_click');
  });

  it('accepts multipart/form-data', async () => {
    const body = new FormData();
    body.set('List-Unsubscribe', 'One-Click');
    const response = await oneClick.POST(
      new NextRequest(url(), { method: 'POST', body })
    );
    expect(response.status).toBe(200);
    expect(unsubscribeMock).toHaveBeenCalledWith(expect.anything(), TOKEN, 'one_click');
  });

  it('does not need an Origin (mail providers post server to server) and ignores a foreign one', async () => {
    const response = await oneClick.POST(
      form(TOKEN, 'List-Unsubscribe=One-Click', {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://mail.example',
      })
    );
    expect(response.status).toBe(200);
    expect(unsubscribeMock).toHaveBeenCalled();
  });

  it('answers the same for an unknown, a malformed and a missing token', async () => {
    unsubscribeMock.mockResolvedValue('not_found');
    const valid = await oneClick.POST(form());
    const unknown = await oneClick.POST(form('Z'.repeat(43)));
    const malformed = await oneClick.POST(form('not a token!'));
    const missing = await oneClick.POST(form(null));
    for (const response of [valid, unknown, malformed, missing]) {
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('');
    }
    // A malformed or missing token is not looked up
    expect(unsubscribeMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['application/json', JSON.stringify({ 'List-Unsubscribe': 'One-Click' })],
    ['text/plain', 'List-Unsubscribe=One-Click'],
  ])('refuses %s (415)', async (contentType, body) => {
    const response = await oneClick.POST(form(TOKEN, body, { 'content-type': contentType }));
    expect(response.status).toBe(415);
    expect(unsubscribeMock).not.toHaveBeenCalled();
  });

  it.each(['', 'List-Unsubscribe=Yes', 'unsubscribe=1'])(
    'refuses a body other than List-Unsubscribe=One-Click (%j)',
    async (body) => {
      const response = await oneClick.POST(form(TOKEN, body));
      expect(response.status).toBe(400);
      expect(unsubscribeMock).not.toHaveBeenCalled();
    }
  );

  it('refuses a large body (413)', async () => {
    const response = await oneClick.POST(
      form(TOKEN, `List-Unsubscribe=One-Click&pad=${'x'.repeat(3000)}`)
    );
    expect(response.status).toBe(413);
    expect(unsubscribeMock).not.toHaveBeenCalled();
  });

  it('counts per address on Vercel with its own loose rule and answers 429 over it', async () => {
    vi.stubEnv('VERCEL', '1');
    const allowed = await oneClick.POST(
      form(TOKEN, 'List-Unsubscribe=One-Click', {
        'content-type': 'application/x-www-form-urlencoded',
        'x-real-ip': '198.51.100.7',
      })
    );
    expect(allowed.status).toBe(200);
    expect(limitsMock).toHaveBeenCalledWith(expect.anything(), [
      {
        rule: expect.objectContaining({ name: 'email-unsubscribe-one-click-ip', limit: 300 }),
        identifier: '198.51.100.7',
      },
    ]);

    limitsMock.mockResolvedValue({ allowed: false, rule: 'x', retryAfterSeconds: 30 });
    unsubscribeMock.mockClear();
    const refused = await oneClick.POST(
      form(TOKEN, 'List-Unsubscribe=One-Click', {
        'content-type': 'application/x-www-form-urlencoded',
        'x-real-ip': '198.51.100.7',
      })
    );
    expect(refused.status).toBe(429);
    expect(rejectedMock).toHaveBeenCalledWith(expect.any(String), 'rate_limited');
    expect(refused.headers.get('Retry-After')).toBe('30');
    expect(unsubscribeMock).not.toHaveBeenCalled();
  });

  it('answers 500 on a database error (so the provider retries) and logs no token', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    unsubscribeMock.mockRejectedValue(new Error(`db down ${TOKEN}`));
    const response = await oneClick.POST(form());
    expect(response.status).toBe(500);
    expect(JSON.stringify(error.mock.calls)).not.toContain(TOKEN);
    error.mockRestore();
  });

  it('never unsubscribes on GET (mail scanners prefetch links)', async () => {
    const response = oneClick.GET();
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
    expect(await response.text()).toContain('配信停止');
    expect(unsubscribeMock).not.toHaveBeenCalled();
    expect(limitsMock).not.toHaveBeenCalled();
  });
});
