import nextConfig, { scopePayloadColorHints } from '@/next.config';
import type { NextConfig } from 'next';
// Next.js internals: if an upgrade moves them, swap in the function that builds the same regex
import { buildCustomRoute } from 'next/dist/lib/build-custom-route';
import type { Header } from 'next/dist/lib/load-custom-routes';
import { describe, expect, it } from 'vitest';

// withPayload's colour scheme client hints stay on the Payload admin only (#509): Critical-CH on
// the site's pages makes Chrome send the first request of a visit twice (#497)

const HINT = 'Sec-CH-Prefers-Color-Scheme';
const HINT_KEYS = ['accept-ch', 'critical-ch', 'vary'];

const hintsOf = (rule: { headers: { key: string; value: string }[] }) =>
  rule.headers.filter(({ key, value }) => HINT_KEYS.includes(key.toLowerCase()) && value === HINT);

/**
 * The keys of the colour scheme hints a path gets, matching each rule with the regex Next.js
 * writes to routes-manifest.json (Vercel matches with it too). A header counts when its value
 * names the hint among others (such as a Vary of several headers), and a rule counts whatever
 * its has / missing conditions say
 */
function hintKeysFor(rules: Header[], path: string): string[] {
  return rules
    .filter((rule) => new RegExp(buildCustomRoute('header', rule).regex).test(path))
    .flatMap((rule) => rule.headers)
    .filter(
      ({ key, value }) =>
        HINT_KEYS.includes(key.toLowerCase()) && value.toLowerCase().includes(HINT.toLowerCase())
    )
    .map(({ key }) => key.toLowerCase())
    .sort();
}

const SITE_PATHS = [
  '/',
  '/ja/ax-migration',
  '/ja/ax-migration/access',
  '/en/ax-migration',
  '/ja/dashboard',
  '/api/health',
  '/api/trpc/leads.list',
  '/api/users/me',
  '/favicon.ico',
  '/administrator',
  '/ja/admin',
];
const ADMIN_PATHS = ['/admin', '/admin/', '/admin/login', '/admin/collections/users/1'];

describe('next.config headers', () => {
  it('sends the colour scheme hints on /admin only', async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const withHints = rules.filter((rule) => hintsOf(rule).length > 0);
    expect(withHints.map((rule) => rule.source)).toEqual(['/admin/:path*']);
    expect(hintsOf(withHints[0]).map(({ key }) => key.toLowerCase()).sort()).toEqual(HINT_KEYS);
  });

  it('sends no hint on the site, its APIs and files, and each hint once on the admin', async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    for (const path of SITE_PATHS) {
      expect(hintKeysFor(rules, path), path).toEqual([]);
    }
    for (const path of ADMIN_PATHS) {
      expect(hintKeysFor(rules, path), path).toEqual(HINT_KEYS);
    }
  });

  it('keeps the other headers of a rule where they were', async () => {
    const config: NextConfig = {
      async headers() {
        return [
          {
            source: '/:path*',
            headers: [
              { key: 'Accept-CH', value: HINT },
              { key: 'Vary', value: HINT },
              { key: 'Critical-CH', value: HINT },
              { key: 'X-Powered-By', value: 'Next.js, Payload' },
            ],
          },
          { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
        ];
      },
    };
    expect(await scopePayloadColorHints(config).headers?.()).toEqual([
      { source: '/:path*', headers: [{ key: 'X-Powered-By', value: 'Next.js, Payload' }] },
      {
        source: '/admin/:path*',
        headers: [
          { key: 'Accept-CH', value: HINT },
          { key: 'Vary', value: HINT },
          { key: 'Critical-CH', value: HINT },
        ],
      },
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
    ]);
  });

  it('leaves a config without headers alone', () => {
    const config: NextConfig = { reactStrictMode: true };
    expect(scopePayloadColorHints(config)).toBe(config);
  });
});
