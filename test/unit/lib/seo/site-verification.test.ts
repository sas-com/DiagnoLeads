import { googleSiteVerification } from '@/lib/seo/site-verification';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('googleSiteVerification (#51)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is off without the variable', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION', '');
    expect(googleSiteVerification()).toBeUndefined();
  });

  it('returns a verification token', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION', ' abcDEF123_-xyz456 ');
    expect(googleSiteVerification()).toBe('abcDEF123_-xyz456');
  });

  it('ignores anything that is not a token, such as a whole meta tag', () => {
    vi.stubEnv(
      'NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION',
      '<meta name="google-site-verification" content="abc" />'
    );
    expect(googleSiteVerification()).toBeUndefined();
  });
});
