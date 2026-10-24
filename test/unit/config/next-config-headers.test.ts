import nextConfig, { scopePayloadColorHints } from '@/next.config';
import type { NextConfig } from 'next';
import { describe, expect, it } from 'vitest';

// withPayload's colour scheme client hints stay on the Payload admin only (#509): Critical-CH on
// the site's pages makes Chrome send the first request of a visit twice (#497)

const HINT = 'Sec-CH-Prefers-Color-Scheme';
const HINT_KEYS = ['accept-ch', 'critical-ch', 'vary'];

const hintsOf = (rule: { headers: { key: string; value: string }[] }) =>
  rule.headers.filter(({ key, value }) => HINT_KEYS.includes(key.toLowerCase()) && value === HINT);

describe('next.config headers', () => {
  it('sends the colour scheme hints on /admin only', async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const withHints = rules.filter((rule) => hintsOf(rule).length > 0);
    expect(withHints.map((rule) => rule.source)).toEqual(['/admin/:path*']);
    expect(hintsOf(withHints[0]).map(({ key }) => key.toLowerCase()).sort()).toEqual(HINT_KEYS);
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
