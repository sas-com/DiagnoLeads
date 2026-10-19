/**
 * Paths the root proxy (proxy.ts) runs on. The Vercel Web Analytics script and endpoint (#222) must
 * stay out, or the locale routing would redirect them to /ja/_vercel/...
 */
import { describe, expect, it, vi } from 'vitest';

// Only the exported config is read; the locale routing is not needed (and next-intl's
// middleware does not load in the test environment)
vi.mock('@/lib/i18n/middleware', () => ({
  intlMiddleware: vi.fn(),
  shouldSkipI18nMiddleware: vi.fn(),
  stripLocalePrefix: vi.fn(),
}));

const { config } = await import('@/proxy');

// The first matcher is a regular expression over the whole path
const general = new RegExp(`^${config.matcher[0]}$`);

describe('middleware matcher', () => {
  it('leaves out the Vercel Web Analytics paths', () => {
    expect(general.test('/_vercel/insights/script.js')).toBe(false);
    expect(general.test('/_vercel/insights/view')).toBe(false);
  });

  it('still runs on pages and other paths', () => {
    expect(general.test('/ja/leads')).toBe(true);
    expect(general.test('/ax-diagnosis')).toBe(true);
    expect(general.test('/_next/static/chunks/main.js')).toBe(false);
  });
});
