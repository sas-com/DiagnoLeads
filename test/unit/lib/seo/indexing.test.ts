import robots from '@/app/robots';
import sitemap from '@/app/sitemap';
import { NOINDEX, robotsFor } from '@/lib/seo/indexing';
import { afterEach, describe, expect, it } from 'vitest';

describe('search indexing policy', () => {
  afterEach(() => {
    delete process.env.APP_TEST_MODE;
  });

  it('indexes nothing while test mode is on', () => {
    process.env.APP_TEST_MODE = 'true';

    expect(robotsFor('/ax-migration')).toEqual(NOINDEX);
    expect(robotsFor('/ax-diagnosis')).toEqual(NOINDEX);
    expect(robotsFor('/ax-migration/access')).toEqual(NOINDEX);
    expect(sitemap()).toEqual([]);
    expect(robots().sitemap).toBeUndefined();
  });

  it('after launch indexes only the AX landing pages and diagnosis', () => {
    expect(robotsFor('/ax-migration')).toEqual({ index: true, follow: true });
    expect(robotsFor('/ax-migration/access')).toEqual({ index: true, follow: true });
    expect(robotsFor('/ax-diagnosis')).toEqual({ index: true, follow: true });
    expect(robotsFor(null)).toEqual(NOINDEX);
    expect(sitemap().map((entry) => new URL(entry.url).pathname)).toEqual([
      '/ja/ax-migration',
      '/ja/ax-migration/access',
      '/ja/ax-diagnosis',
    ]);
    expect(robots().sitemap).toMatch(/\/sitemap\.xml$/);
  });

  it('never lets crawlers into the admin app, sign-in, sign-up, invitations or APIs', () => {
    const rules = robots().rules;
    const disallow = (Array.isArray(rules) ? rules[0] : rules).disallow;
    expect(disallow).toEqual(
      expect.arrayContaining([
        '/api/',
        '/*/dashboard',
        '/*/leads',
        '/*/settings',
        '/*/analytics',
        '/*/organizations',
        '/*/content',
        '/*/login',
        '/*/signup',
        '/*/invite/',
      ])
    );
  });
});
