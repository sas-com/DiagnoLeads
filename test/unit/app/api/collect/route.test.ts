import { POST } from '@/app/api/collect/route';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// /api/collect only records views of measured pages from the site itself, while it is on (#412)

const { recordSiteVisit, reportServerError } = vi.hoisted(() => ({
  recordSiteVisit: vi.fn(),
  reportServerError: vi.fn(),
}));
vi.mock('@/lib/features/site-visits/record', () => ({ recordSiteVisit }));
vi.mock('@/lib/ops/alert', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ops/alert')>()),
  reportServerError,
}));
vi.mock('@/lib/db/client', () => ({ db: {} }));
const { afterTasks } = vi.hoisted(() => ({ afterTasks: [] as (() => unknown)[] }));
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  // Kept to run once the response is back, as Next.js runs after() work
  after: (task: () => unknown) => {
    afterTasks.push(task);
  },
}));

/** POST, then run the after() work it left, as Next.js does once the response has been sent */
async function post(req: NextRequest) {
  const res = await POST(req);
  for (const task of afterTasks.splice(0)) await task();
  return res;
}

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

function beacon(
  body: unknown,
  headers: Record<string, string> = {}
): NextRequest {
  return new NextRequest('https://app.example/api/collect', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: {
      origin: 'https://app.example',
      'user-agent': CHROME,
      'x-real-ip': '203.0.113.5',
      ...headers,
    },
  });
}

const VIEW = {
  path: '/ja/ax-migration/access',
  search: '?utm_source=newsletter&from=ax-lp-targets-access',
  referrer: 'https://www.google.com/search?q=access',
};

describe('POST /api/collect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    afterTasks.length = 0;
    vi.stubEnv('SITE_VISITS_ENABLED', 'true');
    vi.stubEnv('VERCEL', '1');
    recordSiteVisit.mockResolvedValue('recorded');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('records a view with the page, its parameters and the host of the referrer only', async () => {
    const res = await post(beacon(VIEW));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(recordSiteVisit).toHaveBeenCalledTimes(1);
    expect(recordSiteVisit.mock.calls[0][1]).toEqual({
      page: { path: '/ja/ax-migration/access', pageType: 'ax-access-lp', owner: { kind: 'operator' } },
      params: {
        utmSource: 'newsletter',
        utmMedium: null,
        utmCampaign: null,
        utmContent: null,
        utmTerm: null,
        fromRef: 'ax-lp-targets-access',
      },
      referrerHost: 'www.google.com',
      ip: '203.0.113.5',
      userAgent: CHROME,
    });
  });

  it('writes nothing while the measurement is off', async () => {
    vi.stubEnv('SITE_VISITS_ENABLED', '');
    expect((await post(beacon(VIEW))).status).toBe(204);
    vi.stubEnv('SITE_VISITS_ENABLED', 'false');
    expect((await post(beacon(VIEW))).status).toBe(204);
    expect(recordSiteVisit).not.toHaveBeenCalled();
  });

  it.each([
    ['another site', { origin: 'https://evil.example' }],
    ['no Origin', { origin: '' }],
    ['a bot', { 'user-agent': 'Googlebot/2.1' }],
    ['no user agent', { 'user-agent': '' }],
  ])('ignores a request from %s', async (_name, headers) => {
    expect((await post(beacon(VIEW, headers))).status).toBe(204);
    expect(recordSiteVisit).not.toHaveBeenCalled();
  });

  it('judges a long User-Agent from its head, and passes all of it on for the visitor hash (#705)', async () => {
    const userAgent = `${'Android '.repeat(20_000)}Mobile`;
    // A bot named in the head is dropped however long the rest is
    expect((await post(beacon(VIEW, { 'user-agent': `Googlebot/2.1 ${userAgent}` }))).status).toBe(204);
    expect(recordSiteVisit).not.toHaveBeenCalled();

    expect((await post(beacon(VIEW, { 'user-agent': userAgent }))).status).toBe(204);
    expect(recordSiteVisit).toHaveBeenCalledTimes(1);
    expect(recordSiteVisit.mock.calls[0][1].userAgent).toBe(userAgent);
  });

  it.each([
    ['an admin page', { ...VIEW, path: '/ja/dashboard' }],
    ['no path', { search: '' }],
    ['a broken body', '{not json'],
    ['a body too large', { ...VIEW, referrer: `https://x.example/${'a'.repeat(5000)}` }],
    ['a body too large in bytes', { ...VIEW, referrer: `https://x.example/${'あ'.repeat(1500)}` }],
  ])('ignores %s', async (_name, body) => {
    expect((await post(beacon(body))).status).toBe(204);
    expect(recordSiteVisit).not.toHaveBeenCalled();
  });

  it('refuses a body announced as too large without reading it', async () => {
    const req = beacon(VIEW, { 'content-length': '100000' });
    expect((await post(req)).status).toBe(204);
    expect(req.bodyUsed).toBe(false);
    expect(recordSiteVisit).not.toHaveBeenCalled();
  });

  it('stops reading a body without Content-Length once it passes the limit', async () => {
    // A chunked body that would go on for a megabyte
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        if (pulled > 1024) controller.close();
        else controller.enqueue(new TextEncoder().encode('a'.repeat(1024)));
      },
    });
    const req = new NextRequest('https://app.example/api/collect', {
      method: 'POST',
      body,
      duplex: 'half',
      headers: { origin: 'https://app.example', 'user-agent': CHROME },
    } as RequestInit & { duplex: 'half' });
    expect(req.headers.get('content-length')).toBeNull();
    expect((await post(req)).status).toBe(204);
    expect(pulled).toBeLessThan(16);
    expect(recordSiteVisit).not.toHaveBeenCalled();
  });

  it('records without an address when the platform does not give a trusted one', async () => {
    vi.stubEnv('VERCEL', '');
    await post(beacon(VIEW));
    expect(recordSiteVisit.mock.calls[0][1]).toMatchObject({ ip: '' });
  });

  it('tells the people on call once, when an organization passes its daily cap', async () => {
    recordSiteVisit.mockResolvedValueOnce('daily_cap_reached');
    expect((await post(beacon(VIEW))).status).toBe(204);
    expect(reportServerError).toHaveBeenCalledTimes(1);
    expect(reportServerError).toHaveBeenCalledWith(
      'site-visits/daily-cap',
      expect.objectContaining({ name: 'SiteVisitDailyCapReached' })
    );

    // The views refused after it are not reported again
    for (const result of ['daily_cap', 'rate_limited', 'no_organization', 'recorded']) {
      recordSiteVisit.mockResolvedValueOnce(result);
      expect((await post(beacon(VIEW))).status).toBe(204);
    }
    expect(reportServerError).toHaveBeenCalledTimes(1);
  });

  it('reports a failure after answering 204, and logs only what the error is', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    // A database error's text holds the values of the query (the visitor hash, the utm_*)
    const error = Object.assign(new Error('insert into site_visits values ($1) params: newsletter'), {
      name: 'PostgresError',
      code: '57P01',
    });
    recordSiteVisit.mockRejectedValue(error);

    const res = await POST(beacon(VIEW));
    expect(res.status).toBe(204);
    // The alert waits for the response
    expect(reportServerError).not.toHaveBeenCalled();
    for (const task of afterTasks.splice(0)) await task();
    expect(reportServerError).toHaveBeenCalledWith('site-visits/collect', error);

    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError.mock.calls[0]).toEqual([
      'Site visit collect error:',
      expect.objectContaining({ name: 'PostgresError', code: '57P01' }),
    ]);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('newsletter');
    consoleError.mockRestore();
  });
});
