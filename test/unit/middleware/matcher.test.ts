/**
 * Paths the root proxy (proxy.ts) runs on, judged by Next.js itself from the exported matcher.
 * The Vercel Web Analytics script and endpoint (#222) must stay out, or the locale routing would
 * redirect them to /ja/_vercel/...; every page must be in, so that it gets the security headers
 * (#68).
 */
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { describe, expect, it, vi } from 'vitest';

// Only the exported config is read; the locale routing is not needed (and next-intl's
// middleware does not load in the test environment)
vi.mock('@/lib/i18n/middleware', () => ({
  intlMiddleware: vi.fn(),
  shouldSkipI18nMiddleware: vi.fn(),
  stripLocalePrefix: vi.fn(),
}));

const { config } = await import('@/proxy');

const runsOn = (path: string) =>
  unstable_doesMiddlewareMatch({ config, url: `https://example.com${path}` });

describe('middleware matcher', () => {
  it('leaves out the Vercel Web Analytics paths', () => {
    expect(runsOn('/_vercel/insights/script.js')).toBe(false);
    expect(runsOn('/_vercel/insights/view')).toBe(false);
  });

  it('still runs on pages and other paths', () => {
    expect(runsOn('/ja/leads')).toBe(true);
    expect(runsOn('/ax-diagnosis')).toBe(true);
    expect(runsOn('/')).toBe(true);
    expect(runsOn('/robots.txt')).toBe(true);
    // The QR entry of campaigns (#503): rate limit and security headers
    expect(runsOn('/q/AbCd2345')).toBe(true);
    expect(runsOn('/_next/static/chunks/main.js')).toBe(false);
  });

  it('leaves out the files of public/ by their folders, not by their extension', () => {
    expect(runsOn('/images/og/ax-migration.png')).toBe(false);
    expect(runsOn('/images/columns/access-shared-folder.webp')).toBe(false);
    expect(runsOn('/fonts/NotoSansJP-Regular-subset.ttf')).toBe(false);
    expect(runsOn('/favicon.ico')).toBe(false);
    expect(runsOn('/_next/image')).toBe(false);
    // Served by the app (app/icon.svg) or not found: both get the headers
    expect(runsOn('/icon.svg')).toBe(true);
    expect(runsOn('/x/y.png')).toBe(true);
  });

  it('runs on pages of each language and on the API even when they end like a file', () => {
    expect(runsOn('/ja/leads/x/hearings/y.png')).toBe(true);
    expect(runsOn('/en/images/a.svg')).toBe(true);
    expect(runsOn('/api/media/file/a.png')).toBe(true);
  });

  it('leaves out only the Payload admin itself, not paths that start with the same letters', () => {
    expect(runsOn('/admin')).toBe(false);
    expect(runsOn('/admin/collections/users')).toBe(false);
    expect(runsOn('/administrator')).toBe(true);
    expect(runsOn('/admin.php')).toBe(true);
  });
});
