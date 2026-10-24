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
    expect(robotsFor('/ax-migration/column')).toEqual(NOINDEX);
    expect(robotsFor('/ax-migration/column/access-office-support-end')).toEqual(NOINDEX);
    expect(sitemap()).toEqual([]);
    expect(robots().sitemap).toBeUndefined();
  });

  it('after launch indexes only the AX landing pages, diagnosis and columns', () => {
    expect(robotsFor('/ax-migration')).toEqual({ index: true, follow: true });
    expect(robotsFor('/ax-migration/access')).toEqual({ index: true, follow: true });
    expect(robotsFor('/ax-diagnosis')).toEqual({ index: true, follow: true });
    expect(robotsFor('/ax-migration/column')).toEqual({ index: true, follow: true });
    expect(robotsFor('/ax-migration/column/access-office-support-end')).toEqual({
      index: true,
      follow: true,
    });
    // A column path is indexable only for a published article
    expect(robotsFor('/ax-migration/column/no-such-article')).toEqual(NOINDEX);
    expect(robotsFor(null)).toEqual(NOINDEX);
    expect(sitemap().map((entry) => new URL(entry.url).pathname)).toEqual([
      '/ja/ax-migration',
      '/ja/ax-migration/access',
      '/ja/ax-diagnosis',
      '/ja/ax-migration/column',
      '/ja/ax-migration/column/access-file-types',
      '/ja/ax-migration/column/access-office-support-end',
      '/ja/ax-migration/column/access-fix-or-web',
      '/ja/ax-migration/column/access-web-security',
      '/ja/ax-migration/column/access-shared-folder',
      '/ja/ax-migration/column/access-accde-only',
      '/ja/ax-migration/column/access-2gb-limit',
    ]);
    // Columns carry the date of their article rather than the build time
    const article = sitemap().find((entry) => entry.url.endsWith('/access-office-support-end'));
    expect(article?.lastModified).toEqual(new Date('2026-10-22T00:00:00+09:00'));
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
        '/*/login',
        '/*/signup',
        '/*/invite/',
      ])
    );
  });
});
