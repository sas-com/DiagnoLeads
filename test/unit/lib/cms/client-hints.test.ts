// @vitest-environment node
/**
 * withPayload asks for the color-scheme client hint (Critical-CH) on every path, which made
 * Chrome send the first request of every visit twice. It stays on the Payload admin only (#509)
 */
import {
  COLOR_SCHEME_HINT,
  PAYLOAD_ADMIN_SOURCE,
  scopeClientHintsToAdmin,
  withAdminOnlyClientHints,
} from '@/lib/cms/client-hints';
import type { NextConfig } from 'next';
import { buildCustomRoute } from 'next/dist/lib/build-custom-route';
import { describe, expect, it } from 'vitest';

type HeaderRule = Awaited<ReturnType<NonNullable<NextConfig['headers']>>>[number];

const HINTS = [
  { key: 'Accept-CH', value: COLOR_SCHEME_HINT },
  { key: 'Vary', value: COLOR_SCHEME_HINT },
  { key: 'Critical-CH', value: COLOR_SCHEME_HINT },
];

/** The rule @payloadcms/next 3.91 adds (withPayload.js), with poweredByHeader: false */
const PAYLOAD_RULE: HeaderRule = { source: '/:path*', headers: HINTS };

/**
 * The headers a path gets, matched the way Next.js does: the regex it writes to
 * routes-manifest.json (which Vercel serves from), with the last rule winning for a key
 */
function headersFor(rules: HeaderRule[], path: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rule of rules) {
    const { regex } = buildCustomRoute('header', rule);
    if (!new RegExp(regex).test(path)) continue;
    for (const header of rule.headers) result[header.key.toLowerCase()] = header.value;
  }
  return result;
}

const PUBLIC_PATHS = [
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

describe('scopeClientHintsToAdmin', () => {
  it('moves the hints of the catch-all rule to the admin panel', () => {
    expect(scopeClientHintsToAdmin([PAYLOAD_RULE])).toEqual([
      { source: PAYLOAD_ADMIN_SOURCE, headers: HINTS },
    ]);
  });

  it('keeps every other header and rule as it was', () => {
    const own: HeaderRule = { source: '/api/:path*', headers: [{ key: 'X-Own', value: '1' }] };
    const poweredBy = { key: 'X-Powered-By', value: 'Next.js, Payload' };
    const ownVary = { key: 'Vary', value: 'Accept-Language' };
    const rules = scopeClientHintsToAdmin([
      own,
      { source: '/:path*', headers: [...HINTS, poweredBy, ownVary] },
    ]);

    expect(rules).toEqual([
      own,
      { source: '/:path*', headers: [poweredBy, ownVary] },
      { source: PAYLOAD_ADMIN_SOURCE, headers: HINTS },
    ]);
  });

  it('adds each hint to the admin rule once', () => {
    const rules = scopeClientHintsToAdmin([PAYLOAD_RULE, { source: '/(.*)', headers: HINTS }]);
    expect(rules).toEqual([{ source: PAYLOAD_ADMIN_SOURCE, headers: HINTS }]);
  });

  it('changes nothing when there is no hint', () => {
    const rules: HeaderRule[] = [{ source: '/:path*', headers: [{ key: 'X-A', value: 'b' }] }];
    expect(scopeClientHintsToAdmin(rules)).toBe(rules);
  });

  it('sends no hint on public pages and APIs, and all three on the admin panel', () => {
    const rules = scopeClientHintsToAdmin([PAYLOAD_RULE]);

    for (const path of PUBLIC_PATHS) {
      expect(headersFor(rules, path), path).toEqual({});
    }
    for (const path of ADMIN_PATHS) {
      expect(headersFor(rules, path), path).toEqual({
        'accept-ch': COLOR_SCHEME_HINT,
        vary: COLOR_SCHEME_HINT,
        'critical-ch': COLOR_SCHEME_HINT,
      });
    }
  });
});

describe('withAdminOnlyClientHints', () => {
  it('leaves a config without headers() as it was', () => {
    const config: NextConfig = { reactStrictMode: true };
    expect(withAdminOnlyClientHints(config)).toBe(config);
  });

  it('wraps headers() and keeps the rest of the config', async () => {
    const config = withAdminOnlyClientHints({
      poweredByHeader: false,
      headers: async () => [PAYLOAD_RULE],
    });

    expect(config.poweredByHeader).toBe(false);
    expect(await config.headers?.()).toEqual([{ source: PAYLOAD_ADMIN_SOURCE, headers: HINTS }]);
  });
});

describe('next.config.ts headers()', () => {
  it('asks for the color-scheme hint on the Payload admin panel only', async () => {
    // withPayload replaces console.warn to hide sass warnings; keep the test runner's
    const warn = console.warn;
    const { default: config } = await import('@/next.config');
    console.warn = warn;

    const rules = (await config.headers?.()) ?? [];

    for (const path of PUBLIC_PATHS) {
      const headers = headersFor(rules, path);
      expect(headers['critical-ch'], path).toBeUndefined();
      expect(headers['accept-ch'], path).toBeUndefined();
      expect(headers.vary, path).not.toBe(COLOR_SCHEME_HINT);
    }
    for (const path of ADMIN_PATHS) {
      expect(headersFor(rules, path), path).toMatchObject({
        'accept-ch': COLOR_SCHEME_HINT,
        vary: COLOR_SCHEME_HINT,
        'critical-ch': COLOR_SCHEME_HINT,
      });
    }
    // poweredByHeader: false still holds: withPayload adds X-Powered-By only when it is on
    expect(rules.flatMap((rule) => rule.headers.map((header) => header.key))).not.toContain(
      'X-Powered-By'
    );
  });
});
