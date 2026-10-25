import { GET, maxDuration } from '@/app/q/[code]/route';
import {
  QR_ENTRY_RATE_LIMITS,
  QR_ENTRY_TOO_MANY_REQUESTS_TEXT,
} from '@/lib/features/distribution/limits';
import type { QrEntryCampaign } from '@/lib/features/distribution/short-code-entry';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// GET /q/<code> sends the visitor of a QR campaign to its diagnosis (#503). The lookup itself is
// checked against PostgreSQL in test/unit/integration/qr-short-code-entry.db.test.ts

const mocks = vi.hoisted(() => ({
  findOpenQrCampaign: vi.fn(),
  findPublicDiagnosis: vi.fn(),
  consumeRateLimit: vi.fn(),
  axOrganizationId: 'org-ax' as string | null,
  reportRejectedRequest: vi.fn(),
  reportServerError: vi.fn(),
  afterTasks: [] as (() => unknown)[],
}));
vi.mock('@/lib/features/distribution/short-code-entry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/features/distribution/short-code-entry')>()),
  findOpenQrCampaign: mocks.findOpenQrCampaign,
}));
vi.mock('@/lib/features/diagnosis-builder/public-diagnosis', () => ({
  findPublicDiagnosis: mocks.findPublicDiagnosis,
}));
vi.mock('@/lib/features/diagnostics/organization', () => ({
  resolveDiagnosisOrganizationId: () => mocks.axOrganizationId,
}));
vi.mock('@/lib/features/diagnostics/rate-limit', () => ({
  consumeRateLimit: mocks.consumeRateLimit,
}));
vi.mock('@/lib/ops/alert', () => ({
  reportRejectedRequest: mocks.reportRejectedRequest,
  reportServerError: mocks.reportServerError,
}));
vi.mock('@/lib/db/client', () => ({ db: { name: 'app-db' } }));
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => unknown) => {
    mocks.afterTasks.push(task);
  },
}));

/** GET, then run the after() work it left, as Next.js does once the response has been sent */
async function scan(
  code: string,
  init: { url?: string; headers?: Record<string, string> } = {},
  get: typeof GET = GET
) {
  const req = new NextRequest(init.url ?? `https://app.example/q/${code}`, {
    headers: init.headers,
  });
  const res = await get(req, { params: Promise.resolve({ code }) });
  for (const task of mocks.afterTasks.splice(0)) await task();
  return res;
}

/** A campaign of the AX organization that names no diagnosis */
const CAMPAIGN: QrEntryCampaign = {
  campaignId: 'c1',
  organizationId: 'org-ax',
  diagnosisId: null,
  diagnosis: null,
  utm: { source: 'qrcode', medium: 'offline', campaign: 'fair-2026', content: null },
};
const AX = '/ja/ax-diagnosis?utm_source=qrcode&utm_medium=offline&utm_campaign=fair-2026';
/** A campaign that names a builder diagnosis of its organization */
const WITH_DIAGNOSIS: QrEntryCampaign = {
  ...CAMPAIGN,
  organizationId: 'org-a',
  diagnosisId: 'd1',
  diagnosis: { id: 'd1', slug: 'cloud-readiness' },
};

async function expectNotFound(res: Response) {
  expect(res.status).toBe(404);
  expect(res.headers.get('location')).toBeNull();
  expect(res.headers.get('cache-control')).toBe('no-store');
  expect(await res.text()).toBe('Not Found');
}

describe('GET /q/[code]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.afterTasks.length = 0;
    mocks.axOrganizationId = 'org-ax';
    mocks.findOpenQrCampaign.mockResolvedValue(CAMPAIGN);
    mocks.findPublicDiagnosis.mockResolvedValue(null);
    mocks.consumeRateLimit.mockResolvedValue({ allowed: true, count: 1, retryAfterSeconds: 600 });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("redirects the AX organization's campaign to the AX diagnosis with the campaign's UTM parameters, not the request's", async () => {
    const res = await scan('AbCd2345', {
      url: 'https://evil.example/q/AbCd2345?utm_source=other&next=https://evil.example',
      headers: { host: 'evil.example', 'x-forwarded-host': 'evil.example' },
    });
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(AX);
    expect(mocks.findOpenQrCampaign).toHaveBeenCalledWith({ name: 'app-db' }, 'AbCd2345');
  });

  it('is never cached or indexed', async () => {
    for (const res of [await scan('AbCd2345'), await scan('bad-code')]) {
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    }
  });

  describe("a campaign that names no diagnosis, of another organization than the AX diagnosis's (#663)", () => {
    it('answers 404, so its visitors never become leads of the AX organization', async () => {
      mocks.findOpenQrCampaign.mockResolvedValue({ ...CAMPAIGN, organizationId: 'org-b' });
      await expectNotFound(await scan('AbCd2345'));
      expect(mocks.findPublicDiagnosis).not.toHaveBeenCalled();
    });

    it('answers 404 for every campaign while no organization receives the AX diagnosis, and logs it once an instance', async () => {
      mocks.axOrganizationId = null;
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
      // A fresh instance of the route, which has not logged yet
      vi.resetModules();
      const { GET: freshGet } = await import('@/app/q/[code]/route');
      await expectNotFound(await scan('AbCd2345', {}, freshGet));
      await expectNotFound(await scan('AbCd2345', {}, freshGet));
      expect(errorLog).toHaveBeenCalledTimes(1);
      expect(errorLog.mock.calls[0][0]).toContain('AX_DIAGNOSIS_ORGANIZATION_ID');
      errorLog.mockRestore();
    });
  });

  it('knows the AX organization whatever the case of its id in the environment', async () => {
    const id = '0f8e2c1a-3b4d-4e5f-8a9b-0c1d2e3f4a5b';
    mocks.axOrganizationId = id.toUpperCase();
    // PostgreSQL returns a uuid in lower case
    mocks.findOpenQrCampaign.mockResolvedValue({ ...CAMPAIGN, organizationId: id });
    const res = await scan('AbCd2345');
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(AX);
  });

  it("redirects to the campaign's builder diagnosis while /d/<slug> serves it", async () => {
    mocks.findOpenQrCampaign.mockResolvedValue(WITH_DIAGNOSIS);
    mocks.findPublicDiagnosis.mockResolvedValue({ id: 'd1', slug: 'cloud-readiness' });
    const res = await scan('AbCd2345');
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      '/ja/d/cloud-readiness?utm_source=qrcode&utm_medium=offline&utm_campaign=fair-2026'
    );
    expect(mocks.findPublicDiagnosis).toHaveBeenCalledWith({ name: 'app-db' }, 'cloud-readiness');
  });

  describe('a campaign whose diagnosis /d/<slug> does not serve (#663)', () => {
    it('answers 404 while the diagnosis is not published (paused, archived), not the AX diagnosis', async () => {
      mocks.findOpenQrCampaign.mockResolvedValue(WITH_DIAGNOSIS);
      await expectNotFound(await scan('AbCd2345'));
    });

    it('answers 404 also for a campaign of the AX organization', async () => {
      mocks.findOpenQrCampaign.mockResolvedValue({ ...WITH_DIAGNOSIS, organizationId: 'org-ax' });
      await expectNotFound(await scan('AbCd2345'));
    });

    it('never sends to a /d/<slug> that serves another diagnosis', async () => {
      mocks.findOpenQrCampaign.mockResolvedValue(WITH_DIAGNOSIS);
      // The same slug, published by another organization
      mocks.findPublicDiagnosis.mockResolvedValue({ id: 'd-other', slug: 'cloud-readiness' });
      await expectNotFound(await scan('AbCd2345'));
    });

    it('answers 404 when the diagnosis it names is not of its organization', async () => {
      // findOpenQrCampaign leaves out a diagnosis of another organization
      mocks.findOpenQrCampaign.mockResolvedValue({
        ...WITH_DIAGNOSIS,
        organizationId: 'org-ax',
        diagnosis: null,
      });
      await expectNotFound(await scan('AbCd2345'));
      expect(mocks.findPublicDiagnosis).not.toHaveBeenCalled();
    });
  });

  it('answers 404 for a paused, expired or unknown code', async () => {
    mocks.findOpenQrCampaign.mockResolvedValue(null);
    await expectNotFound(await scan('AbCd2345'));
    expect(mocks.findPublicDiagnosis).not.toHaveBeenCalled();
  });

  it('answers 404 for what cannot be a code, before counting or looking it up', async () => {
    vi.stubEnv('VERCEL', '1');
    for (const code of ['bad-code', '..', 'a'.repeat(65)]) {
      const res = await scan(code, { headers: { 'x-real-ip': '203.0.113.5' } });
      expect(res.status).toBe(404);
    }
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
    expect(mocks.findOpenQrCampaign).not.toHaveBeenCalled();
  });

  it('counts each scan per address on Vercel and refuses past the limit', async () => {
    vi.stubEnv('VERCEL', '1');
    expect((await scan('AbCd2345', { headers: { 'x-real-ip': '203.0.113.5' } })).status).toBe(307);
    expect(mocks.consumeRateLimit).toHaveBeenCalledWith(
      { name: 'app-db' },
      QR_ENTRY_RATE_LIMITS.perIp,
      '203.0.113.5'
    );

    mocks.consumeRateLimit.mockResolvedValue({ allowed: false, count: 201, retryAfterSeconds: 42 });
    const res = await scan('AbCd2345', { headers: { 'x-real-ip': '203.0.113.5' } });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('42');
    expect(res.headers.get('location')).toBeNull();
    // The phone that scanned the code shows the body as it is: one line of text, not JSON
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toBe(QR_ENTRY_TOO_MANY_REQUESTS_TEXT);
    expect(mocks.findOpenQrCampaign).toHaveBeenCalledTimes(1);
    expect(mocks.reportRejectedRequest).toHaveBeenCalledWith('qr-entry', 'rate_limited');
  });

  it('lets 200 scans from one address in 10 minutes through: an event of 100 people, twice (#663)', () => {
    expect(QR_ENTRY_RATE_LIMITS.perIp).toMatchObject({ limit: 200, windowMs: 10 * 60 * 1000 });
  });

  it('counts an IPv6 address by its /64', async () => {
    vi.stubEnv('VERCEL', '1');
    await scan('AbCd2345', { headers: { 'x-real-ip': '2001:db8:1:2:3:4:5:6' } });
    expect(mocks.consumeRateLimit.mock.calls[0][2]).toBe('2001:0db8:0001:0002::/64');
  });

  it('does not count by address off Vercel, where the address cannot be trusted', async () => {
    vi.stubEnv('VERCEL', '');
    expect((await scan('AbCd2345', { headers: { 'x-real-ip': '203.0.113.5' } })).status).toBe(307);
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
  });

  it('runs for a bounded time, which vercel.json (app/api/** only) does not give it', () => {
    expect(maxDuration).toBeGreaterThan(10);
    expect(maxDuration).toBeLessThanOrEqual(30);
  });

  it('answers 500 and tells the people on call when the database fails', async () => {
    mocks.findOpenQrCampaign.mockRejectedValue(new Error('connection refused'));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await scan('AbCd2345');
    expect(res.status).toBe(500);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(mocks.reportServerError).toHaveBeenCalledWith('qr-entry', expect.any(Error));
    expect(errorLog).toHaveBeenCalledWith('QR entry error:', 'Error');
    errorLog.mockRestore();
  });
});
