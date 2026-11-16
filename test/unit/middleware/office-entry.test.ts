// @vitest-environment node
/**
 * Another site cannot open the office in its full-screen view (#1175): the mark in the address
 * that opens it only counts when the request comes from this site or from the visitor
 */
import { withoutForeignOfficeEntry } from '@/lib/middleware/office-entry';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

// next-intl's middleware does not load in the test environment
vi.mock('@/lib/i18n/middleware', () => ({
  intlMiddleware: vi.fn(() => undefined),
  shouldSkipI18nMiddleware: vi.fn(() => true),
  stripLocalePrefix: vi.fn((pathname: string) => pathname.replace(/^\/(ja|en)(?=\/|$)/, '') || '/'),
}));

const { proxy } = await import('@/proxy');

const ORIGIN = 'https://app.example.com';
const ask = (path: string, site?: string, method = 'GET') =>
  new Request(`${ORIGIN}${path}`, {
    method,
    headers: site === undefined ? {} : { 'sec-fetch-site': site },
  });
const sentTo = (path: string, site?: string, method?: string) => {
  const url = withoutForeignOfficeEntry(ask(path, site, method));
  return url ? `${url.pathname}${url.search}${url.hash}` : null;
};

describe('withoutForeignOfficeEntry', () => {
  it('drops every mark from a request that another site started', () => {
    expect(sentTo('/ja/office?source=home', 'cross-site')).toBe('/ja/office');
    expect(sentTo('/ja/office?source=login', 'cross-site')).toBe('/ja/office');
    expect(sentTo('/en/office?source=app', 'cross-site')).toBe('/en/office');
    // A mark that does not exist yet, and a mark given twice
    expect(sentTo('/ja/office?source=next', 'cross-site')).toBe('/ja/office');
    expect(sentTo('/ja/office?source=app&source=home', 'cross-site')).toBe('/ja/office');
    // The rest of the address stays
    expect(sentTo('/ja/office?tab=1&source=home&x=2', 'cross-site')).toBe('/ja/office?tab=1&x=2');
    expect(sentTo('/ja/office?source=home', 'Cross-Site')).toBe('/ja/office');
  });

  it('judges the path the router will serve: without a language, escaped, or with a slash', () => {
    expect(sentTo('/office?source=home', 'cross-site')).toBe('/office');
    expect(sentTo('/ja/%6Fffice?source=home', 'cross-site')).toBe('/ja/%6Fffice');
    expect(sentTo('/%6Aa/office?source=home', 'cross-site')).toBe('/%6Aa/office');
    expect(sentTo('/ja/office/?source=home', 'cross-site')).toBe('/ja/office/');
    expect(sentTo('/JA/OFFICE?source=home', 'cross-site')).toBe('/JA/OFFICE');
    // Doubled slashes and backslashes are folded before the page is served
    expect(sentTo('/ja//office?source=home', 'cross-site')).toBe('/ja//office');
    expect(sentTo('//ja/office//?source=home', 'cross-site')).toBe('//ja/office//');
    expect(sentTo('/ja/%5Coffice?source=home', 'cross-site')).toBe('/ja/%5Coffice');
  });

  it('drops the mark for a sibling host and for a value it does not know: only this site opens it', () => {
    expect(sentTo('/ja/office?source=login', 'same-site')).toBe('/ja/office');
    expect(sentTo('/ja/office?source=home', 'something-new')).toBe('/ja/office');
  });

  it('drops the mark whatever the method: a posted form goes on to the sign-in without it', () => {
    expect(sentTo('/ja/office?source=home', 'cross-site', 'POST')).toBe('/ja/office');
    expect(sentTo('/ja/office?source=home', 'cross-site', 'HEAD')).toBe('/ja/office');
  });

  it('leaves alone what this site and the visitor ask for', () => {
    // Moving within the app; the installed app or a typed address
    expect(sentTo('/ja/office?source=home', 'same-origin')).toBeNull();
    expect(sentTo('/ja/office?source=login', 'Same-Origin')).toBeNull();
    expect(sentTo('/ja/office?source=app', 'none')).toBeNull();
    // A browser that does not say where the request comes from is treated as before
    expect(sentTo('/ja/office?source=home')).toBeNull();
  });

  it('leaves alone every other page, and an office without a mark', () => {
    expect(sentTo('/ja/office', 'cross-site')).toBeNull();
    expect(sentTo('/ja/office?tab=1', 'cross-site')).toBeNull();
    expect(sentTo('/ja/leads?source=home', 'cross-site')).toBeNull();
    expect(sentTo('/ja/officers?source=home', 'cross-site')).toBeNull();
    expect(sentTo('/ja/office/desk?source=home', 'cross-site')).toBeNull();
  });
});

describe('the proxy, for an office address opened by another site (#1175)', () => {
  const open = (path: string, site: string, cookie?: string) =>
    proxy(
      new NextRequest(`${ORIGIN}${path}`, {
        headers: {
          'sec-fetch-site': site,
          'x-forwarded-for': '198.51.100.77',
          ...(cookie ? { cookie } : {}),
        },
      })
    );

  it('sends the visitor to the office without the mark, and the answer is never kept', async () => {
    const res = await open(
      '/ja/office?source=home',
      'cross-site',
      'better-auth.session_token=anything'
    );
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/ja/office`);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    // The security headers are on this answer too
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('drops the mark before the sign-in, so that it does not come back as the page to return to', async () => {
    const res = await open('/ja/office?source=home', 'cross-site');
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/ja/office`);
    // The next request, still started by the other site, carries no mark into the sign-in
    const next = await open('/ja/office', 'cross-site');
    expect(next.headers.get('location')).toBe(
      `${ORIGIN}/ja/login?callbackUrl=${encodeURIComponent('/ja/office')}`
    );
  });

  it('lets the logo and the app through as they are', async () => {
    const cookie = 'better-auth.session_token=anything';
    expect((await open('/ja/office?source=home', 'same-origin', cookie)).status).toBe(200);
    expect((await open('/ja/office?source=app', 'none', cookie)).status).toBe(200);
  });
});
