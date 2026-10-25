// @vitest-environment node
/**
 * The in-memory rate limit of the root proxy (proxy.ts) on the QR entry of campaigns (/q/<code>,
 * #503): a phone that scanned the code shows the body of the 429 as it is, so it is one line of
 * text, never kept; other paths keep their JSON answer
 */
import { QR_ENTRY_TOO_MANY_REQUESTS_TEXT } from '@/lib/features/distribution/limits';
import { ENDPOINT_RATE_LIMITS } from '@/lib/middleware/rate-limit';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

// next-intl's middleware does not load in the test environment; /q/ skips it anyway
vi.mock('@/lib/i18n/middleware', () => ({
  intlMiddleware: vi.fn(() => undefined),
  shouldSkipI18nMiddleware: vi.fn(() => true),
  stripLocalePrefix: vi.fn((pathname: string) => pathname.replace(/^\/(ja|en)(?=\/|$)/, '') || '/'),
}));

const { proxy } = await import('@/proxy');

/**
 * Sends one more request than the limit allows from one address, checking that each one within
 * the limit (200 a minute on /q/, #663) gets through, and returns the last answer
 */
async function overLimit(path: string, address: string, max: number) {
  const send = () =>
    proxy(new NextRequest(`https://example.com${path}`, { headers: { 'x-forwarded-for': address } }));
  for (let i = 0; i < max; i++) {
    expect((await send()).status).not.toBe(429);
  }
  return send();
}

describe('proxy rate limit on the QR entry (#503)', () => {
  it('answers a phone over the limit with one line of plain text, never kept', async () => {
    const res = await overLimit('/q/AbCd2345', '198.51.100.21', ENDPOINT_RATE_LIMITS['/q/'].max);
    expect(res.status).toBe(429);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(res.headers.get('retry-after')).not.toBeNull();
    expect(await res.text()).toBe(QR_ENTRY_TOO_MANY_REQUESTS_TEXT);
  });

  it('counts each code separately, so another code from the same address still answers (#663)', async () => {
    const address = '198.51.100.23';
    const res = await overLimit('/q/EfGh2345', address, ENDPOINT_RATE_LIMITS['/q/'].max);
    expect(res.status).toBe(429);
    const other = await proxy(
      new NextRequest('https://example.com/q/JkMn2345', { headers: { 'x-forwarded-for': address } })
    );
    expect(other.status).not.toBe(429);
  });

  it('keeps the JSON answer on other paths', async () => {
    const path = '/api/diagnostics/ax-migration';
    const res = await overLimit(path, '198.51.100.22', ENDPOINT_RATE_LIMITS[path].max);
    expect(res.status).toBe(429);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toMatchObject({ error: 'Too Many Requests' });
  });
});
