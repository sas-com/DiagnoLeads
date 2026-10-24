import { gaMeasurementId } from '@/lib/analytics/ga';
import { contentSecurityPolicy } from '@/lib/middleware/csp';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllEnvs());

const directive = (policy: string, name: string) =>
  policy
    .split(';')
    .map((part) => part.trim().split(/\s+/))
    .find(([key]) => key === name)
    ?.slice(1);

describe('gaMeasurementId', () => {
  it('is off without a GA4 measurement ID', () => {
    vi.stubEnv('NEXT_PUBLIC_GA_MEASUREMENT_ID', '');
    expect(gaMeasurementId()).toBeUndefined();
  });

  it('accepts a GA4 measurement ID only', () => {
    vi.stubEnv('NEXT_PUBLIC_GA_MEASUREMENT_ID', ' G-AB12CD34EF ');
    expect(gaMeasurementId()).toBe('G-AB12CD34EF');
    for (const value of ['UA-1234-1', "G-ABC1234'; script-src *", 'G-abc12345']) {
      vi.stubEnv('NEXT_PUBLIC_GA_MEASUREMENT_ID', value);
      expect(gaMeasurementId()).toBeUndefined();
    }
  });
});

describe('contentSecurityPolicy with GA4', () => {
  it('adds the hit endpoints to connect-src only when GA4 is on', () => {
    expect(directive(contentSecurityPolicy('n', false), 'connect-src')).toBeUndefined();
    expect(directive(contentSecurityPolicy('n', false, { analytics: true }), 'connect-src')).toEqual([
      "'self'",
      'https://*.google-analytics.com',
      'https://*.analytics.google.com',
      'https://*.googletagmanager.com',
      'https://*.g.doubleclick.net',
      'https://*.google.com',
    ]);
  });

  it('adds the image hosts of Google’s CSP guide, Google signals included', () => {
    expect(directive(contentSecurityPolicy('n', false, { analytics: true }), 'img-src')).toEqual([
      "'self'",
      'blob:',
      'data:',
      'https://*.google-analytics.com',
      'https://*.googletagmanager.com',
      'https://*.g.doubleclick.net',
      'https://*.google.com',
      'https://*.google.co.jp',
    ]);
  });

  it('keeps scripts to the nonce in production (gtag.js comes through strict-dynamic)', () => {
    expect(directive(contentSecurityPolicy('n', false, { analytics: true }), 'script-src')).toEqual([
      "'self'",
      "'nonce-n'",
      "'strict-dynamic'",
    ]);
  });
});
