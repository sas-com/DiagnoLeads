// @vitest-environment node
/**
 * Security headers besides the CSP: what the root proxy (proxy.ts) sends on pages, and what
 * vercel.json sends on every path, static files included (the proxy does not run on those).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SECURITY_HEADERS } from '@/lib/middleware/security-headers';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

// next-intl's middleware does not load in the test environment; pages pass through it unchanged
vi.mock('@/lib/i18n/middleware', () => ({
  intlMiddleware: vi.fn(() => undefined),
  shouldSkipI18nMiddleware: vi.fn(() => true),
  stripLocalePrefix: vi.fn((pathname: string) => pathname.replace(/^\/(ja|en)(?=\/|$)/, '') || '/'),
}));

const { proxy } = await import('@/proxy');

interface VercelConfig {
  headers: { source: string; headers: { key: string; value: string }[] }[];
}

const vercel = JSON.parse(
  readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8')
) as VercelConfig;

describe('security headers', () => {
  it('keep the browsers’ XSS filter off (OWASP), leaving script injection to the CSP', () => {
    expect(SECURITY_HEADERS['X-XSS-Protection']).toBe('0');
  });

  it('are what the proxy sends on a page, with the CSP', async () => {
    const response = await proxy(new NextRequest('https://example.com/ja/ax-migration'));
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
      expect(response.headers.get(key)).toBe(value);
    }
    expect(response.headers.get('Content-Security-Policy')).toContain("'nonce-");
  });

  it('are the same in vercel.json, which also covers the static files', () => {
    const everyPath = vercel.headers.find((rule) => rule.source === '/(.*)');
    expect(everyPath).toBeDefined();
    const sent = new Map(everyPath?.headers.map(({ key, value }) => [key, value]));
    expect(sent.get('X-XSS-Protection')).toBe('0');
    for (const [key, value] of sent) {
      expect(SECURITY_HEADERS[key as keyof typeof SECURITY_HEADERS]).toBe(value);
    }
  });
});
