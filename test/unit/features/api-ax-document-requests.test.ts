/**
 * API routes of the document requests of the AX landing pages (#899): the form and the mailed
 * link. The real route handlers are imported; the flow, the rate limits, Turnstile and the
 * database are mocked.
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const requestMock = vi.fn();
const openMock = vi.fn();
const limitsMock = vi.fn();
const notifyMock = vi.fn();
const turnstileMock = vi.fn();
const rejectedMock = vi.fn();

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
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
vi.mock('@/lib/features/diagnostics/ax-migration/document-request', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/features/diagnostics/ax-migration/document-request')>()),
  requestAxDocument: (...args: unknown[]) => requestMock(...args),
}));
vi.mock('@/lib/features/diagnostics/ax-migration/notify', () => ({
  notifyAxDocumentRequest: (...args: unknown[]) => notifyMock(...args),
}));
vi.mock('@/lib/features/info-offers/service', () => ({
  LANDING_DOCUMENT_LINK_TTL_MS: 1000,
  getLandingDocument: vi.fn(),
  recordLandingOfferRequest: vi.fn(),
  openLandingDocument: (...args: unknown[]) => openMock(...args),
}));
vi.mock('@/lib/features/diagnostics/rate-limit', () => ({
  consumeRateLimits: (...args: unknown[]) => limitsMock(...args),
  pruneRateLimits: vi.fn(async () => undefined),
}));
vi.mock('@/lib/features/diagnostics/turnstile', () => ({
  turnstileSiteKey: () => 'site-key',
  verifyTurnstile: (...args: unknown[]) => turnstileMock(...args),
}));
vi.mock('@/lib/features/diagnostics/organization', () => ({
  resolveDiagnosisOrganizationId: () => '11111111-1111-4111-8111-111111111111',
}));

const requestRoute = await import('@/app/api/ax-migration/document-requests/route');
const openRoute = await import('@/app/api/ax-migration/documents/[token]/route');

const PATH = '/api/ax-migration/document-requests';
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost${PATH}`, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });

const body = {
  contact: {
    company: '架空製作所',
    name: '架空 太郎',
    email: 'taro@example.co.jp',
    phone: '03-0000-0000',
    department: '情報システム部',
  },
  systems: ['as400'],
  privacyConsent: true,
  locale: 'ja',
  turnstileToken: 'token',
};
const recorded = {
  id: '22222222-2222-4222-8222-222222222222',
  leadId: '33333333-3333-4333-8333-333333333333',
  leadCreated: true,
  documentTitle: '架空のサービス資料',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('APP_TEST_MODE', 'false');
  vi.stubEnv('AX_DOCUMENT_REQUEST_ENABLED', 'true');
  limitsMock.mockResolvedValue({ allowed: true });
  turnstileMock.mockResolvedValue({ ok: true });
  requestMock.mockResolvedValue({ outcome: 'accepted', delivery: 'sent', request: recorded });
  notifyMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/ax-migration/document-requests', () => {
  it('records the request, answers accepted and tells sales', async () => {
    const response = await requestRoute.POST(post(body));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'accepted' });
    expect(requestMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sendEmail: expect.any(Function), offers: expect.any(Object) }),
      '11111111-1111-4111-8111-111111111111',
      expect.objectContaining({ contact: expect.objectContaining({ phone: '03-0000-0000' }) })
    );
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: recorded.leadId, requestId: recorded.id, leadCreated: true })
    );
  });

  it.each(['suppressed', 'recent_link', 'not_allowed'])(
    'answers the same for a %s delivery',
    async (delivery) => {
      requestMock.mockResolvedValue({ outcome: 'accepted', delivery, request: recorded });
      const response = await requestRoute.POST(post(body));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'accepted' });
    }
  );

  it('asks to send again when the mail could not be sent, and still tells sales', async () => {
    requestMock.mockResolvedValue({ outcome: 'accepted', delivery: 'failed', request: recorded });
    const response = await requestRoute.POST(post(body));
    expect(response.status).toBe(503);
    expect(notifyMock).toHaveBeenCalled();
  });

  it('is 404 while no document is offered and 503 when the quota is used up', async () => {
    requestMock.mockResolvedValue({ outcome: 'closed' });
    expect((await requestRoute.POST(post(body))).status).toBe(404);
    requestMock.mockResolvedValue({ outcome: 'unavailable' });
    expect((await requestRoute.POST(post(body))).status).toBe(503);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('requires the phone and the privacy consent', async () => {
    const noPhone = { ...body, contact: { ...body.contact, phone: '' } };
    expect((await requestRoute.POST(post(noPhone))).status).toBe(400);
    expect((await requestRoute.POST(post({ ...body, privacyConsent: false }))).status).toBe(400);
    expect((await requestRoute.POST(post({ ...body, systems: ['vax'] }))).status).toBe(400);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('stores nothing for a filled honeypot, and answers like a success', async () => {
    const response = await requestRoute.POST(post({ ...body, website: 'https://spam.example' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'accepted' });
    expect(requestMock).not.toHaveBeenCalled();
    expect(rejectedMock).toHaveBeenCalledWith('ax-document-request', 'honeypot');
  });

  it('refuses a failed bot check and a rate limit before recording', async () => {
    turnstileMock.mockResolvedValue({ ok: false, reason: 'failed' });
    expect((await requestRoute.POST(post(body))).status).toBe(403);
    turnstileMock.mockResolvedValue({ ok: true });
    limitsMock.mockResolvedValue({ allowed: false, retryAfterSeconds: 60, rule: 'x' });
    expect((await requestRoute.POST(post(body))).status).toBe(429);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('stays closed until AX_DOCUMENT_REQUEST_ENABLED is turned on', async () => {
    vi.stubEnv('AX_DOCUMENT_REQUEST_ENABLED', '');
    expect((await requestRoute.POST(post(body))).status).toBe(404);
    expect(limitsMock).not.toHaveBeenCalled();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('limits per mailbox, so +tags of one address share the limits (#899 review)', async () => {
    const tagged = { ...body, contact: { ...body.contact, email: 'Someone+7@Example.co.jp' } };
    await requestRoute.POST(post(tagged));
    const identifiers = limitsMock.mock.calls[0][1].map((rule: { identifier: string }) => rule.identifier);
    expect(identifiers).toContain('someone@example.co.jp');
    expect(identifiers).not.toContain('someone+7@example.co.jp');
  });
});

describe('GET /api/ax-migration/documents/[token]', () => {
  const get = (token: string) =>
    openRoute.GET(new NextRequest(`http://localhost/api/ax-migration/documents/${token}`), {
      params: Promise.resolve({ token }),
    });

  it('redirects to the document without caching or a referrer', async () => {
    openMock.mockResolvedValue({ outcome: 'open', url: 'https://files.example.com/a.pdf' });
    const response = await get('abcDEF_1234567890');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://files.example.com/a.pdf');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it.each(['expired', 'not_found', 'unavailable'])(
    'sends a %s link to the landing page',
    async (outcome) => {
      openMock.mockResolvedValue({ outcome });
      const response = await get('abcDEF_1234567890');
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe(
        `http://localhost/ja/ax-migration?document_link=${outcome}`
      );
    }
  );

  it('stops a sweep of links', async () => {
    // Per-address limits count only where the address can be trusted (Vercel)
    vi.stubEnv('VERCEL', '1');
    limitsMock.mockResolvedValue({ allowed: false, retryAfterSeconds: 60, rule: 'x' });
    const response = await openRoute.GET(
      new NextRequest('http://localhost/api/ax-migration/documents/abcDEF_1234567890', {
        headers: { 'x-real-ip': '203.0.113.7' },
      }),
      { params: Promise.resolve({ token: 'abcDEF_1234567890' }) }
    );
    expect(response.status).toBe(429);
    expect(openMock).not.toHaveBeenCalled();
  });
});
