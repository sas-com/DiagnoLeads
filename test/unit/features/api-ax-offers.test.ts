/**
 * AX diagnosis document / seminar offer requests (#153): the real route handler is called with
 * the real request guard and schema; the database, the rate limit store and the offer service
 * are mocked.
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { requestInfoOffer, consumeRateLimit, reportServerError, reportRejectedRequest, afterTasks } =
  vi.hoisted(() => ({
    requestInfoOffer: vi.fn(),
    consumeRateLimit: vi.fn(),
    reportServerError: vi.fn(),
    reportRejectedRequest: vi.fn(),
    afterTasks: [] as Array<() => unknown>,
  }));

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  // Kept to run once the response is back, as Next.js runs after() work
  after: (task: () => unknown) => {
    afterTasks.push(task);
  },
}));
vi.mock('@/lib/ops/alert', () => ({ reportServerError, reportRejectedRequest }));
vi.mock('@/lib/db/client', () => ({ db: {} }));
vi.mock('@/lib/features/diagnostics/rate-limit', () => ({ consumeRateLimit }));
vi.mock('@/lib/features/info-offers/service', () => ({ requestInfoOffer }));

const { POST } = await import('@/app/api/diagnostics/ax-migration/offers/route');

const SUBMISSION_ID = '33333333-3333-4333-8333-333333333333';
const BODY = { submissionId: SUBMISSION_ID, kind: 'document', offerId: 'as400-checklist' };

const request = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost/api/diagnostics/ax-migration/offers', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });

/** Runs the work kept with after(), as Next.js does once the response is back */
async function runAfterTasks() {
  for (const task of afterTasks.splice(0)) await task();
}

async function post(req: NextRequest) {
  const res = await POST(req);
  await runAfterTasks();
  return res;
}

describe('POST /api/diagnostics/ax-migration/offers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    afterTasks.length = 0;
    consumeRateLimit.mockResolvedValue({ allowed: true, count: 1, retryAfterSeconds: 0 });
    requestInfoOffer.mockResolvedValue({
      ok: true,
      alreadyRequested: false,
      url: 'https://files.example/as400-checklist.pdf',
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('records the request and hands out where the document is', async () => {
    const res = await post(request(BODY));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      alreadyRequested: false,
      url: 'https://files.example/as400-checklist.pdf',
    });
    expect(requestInfoOffer).toHaveBeenCalledWith(expect.anything(), BODY);
  });

  it('answers a seminar sign-up without a url, and says when it was already requested', async () => {
    requestInfoOffer.mockResolvedValue({ ok: true, alreadyRequested: true, url: null });

    const res = await post(request({ ...BODY, kind: 'seminar', offerId: 'webinar-1105' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, alreadyRequested: true });
  });

  it('answers 404 for a submission that does not exist', async () => {
    requestInfoOffer.mockResolvedValue({ ok: false, reason: 'not_found' });

    const res = await post(request(BODY));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });

  it.each(['closed', 'unavailable'] as const)(
    'answers 409 with the reason when the offer is %s',
    async (reason) => {
      requestInfoOffer.mockResolvedValue({ ok: false, reason });

      const res = await post(request(BODY));

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'Unavailable', code: reason });
    }
  );

  it.each([
    ['a submission id that is not a uuid', { ...BODY, submissionId: 'nope' }],
    ['an unknown kind', { ...BODY, kind: 'video' }],
    ['an offer id with characters outside the allowed set', { ...BODY, offerId: '../secret' }],
    ['a missing offer id', { submissionId: SUBMISSION_ID, kind: 'document' }],
  ])('rejects %s with 400 before touching the database', async (_label, body) => {
    const res = await post(request(body));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Validation failed' });
    expect(consumeRateLimit).not.toHaveBeenCalled();
    expect(requestInfoOffer).not.toHaveBeenCalled();
  });

  it('rejects a body that is not JSON with 400', async () => {
    const res = await post(request('{"submissionId":'));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid JSON' });
    expect(requestInfoOffer).not.toHaveBeenCalled();
  });

  it('rejects a body over 1 KB with 413 even without a Content-Length', async () => {
    const res = await post(request({ ...BODY, padding: 'x'.repeat(1100) }));

    expect(res.status).toBe(413);
    expect(requestInfoOffer).not.toHaveBeenCalled();
  });

  it('rejects a text/plain request that a cross-site form could send with 415', async () => {
    const res = await post(request(BODY, { 'content-type': 'text/plain' }));

    expect(res.status).toBe(415);
    expect(requestInfoOffer).not.toHaveBeenCalled();
  });

  it('rejects a request from another origin with 403', async () => {
    const res = await post(request(BODY, { origin: 'https://evil.example' }));

    expect(res.status).toBe(403);
    expect(requestInfoOffer).not.toHaveBeenCalled();
  });

  it('counts requests per address on Vercel', async () => {
    vi.stubEnv('VERCEL', '1');

    await post(request(BODY, { 'x-real-ip': '203.0.113.5' }));

    expect(consumeRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'ax-offers-ip' }),
      '203.0.113.5'
    );
  });

  it('counts an IPv6 address by its /64, so rotating within it does not reset the count', async () => {
    vi.stubEnv('VERCEL', '1');

    await post(request(BODY, { 'x-real-ip': '2001:db8:abcd:12:aaaa:bbbb:cccc:dddd' }));

    expect(consumeRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'ax-offers-ip' }),
      '2001:0db8:abcd:0012::/64'
    );
  });

  it('answers 429 with Retry-After over the per-address limit and reports the rejection', async () => {
    vi.stubEnv('VERCEL', '1');
    consumeRateLimit.mockResolvedValue({ allowed: false, count: 31, retryAfterSeconds: 120 });

    const res = await POST(request(BODY, { 'x-real-ip': '203.0.113.5' }));

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('120');
    expect(requestInfoOffer).not.toHaveBeenCalled();
    expect(reportRejectedRequest).not.toHaveBeenCalled();
    await runAfterTasks();
    expect(reportRejectedRequest).toHaveBeenCalledWith('ax-diagnosis/offers', 'rate_limited');
  });

  it('does not count per address where the address cannot be trusted (not on Vercel)', async () => {
    vi.stubEnv('VERCEL', '');

    await post(request(BODY, { 'x-real-ip': '203.0.113.5' }));

    expect(consumeRateLimit).not.toHaveBeenCalled();
    expect(requestInfoOffer).toHaveBeenCalledTimes(1);
  });

  it('answers 500 without details when the service fails, and reports it after the response', async () => {
    const error = new Error('db down');
    requestInfoOffer.mockRejectedValue(error);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(request(BODY));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal server error' });
    // Not while the response waits: only once it is back
    expect(reportServerError).not.toHaveBeenCalled();
    await runAfterTasks();
    expect(reportServerError).toHaveBeenCalledWith('ax-diagnosis/offers', error);
    errorSpy.mockRestore();
  });
});
