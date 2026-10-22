/**
 * Links between the pages of the AX migration site (#332): page names, the `from` allow-list,
 * the address a cross link opens and the tracking parameters the diagnosis reads
 */
import { readTrackingParams } from '@/components/features/diagnosis-runner/tracking-params';
import {
  axPageOf,
  crossLinkHref,
  isAxFrom,
  isLandingHref,
} from '@/lib/features/ax-site/cross-links';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('axPageOf', () => {
  it('names the pages of the AX site', () => {
    expect(axPageOf('/ja/ax-migration')).toEqual({ page: 'ax-lp' });
    expect(axPageOf('/en/ax-migration/')).toEqual({ page: 'ax-lp' });
    expect(axPageOf('/ja/ax-migration/access')).toEqual({ page: 'ax-access-lp' });
    expect(axPageOf('/ja/ax-migration/column')).toEqual({ page: 'ax-column-index' });
    expect(axPageOf('/ja/ax-migration/column/access-fix-or-web')).toEqual({
      page: 'ax-column',
      columnSlug: 'access-fix-or-web',
    });
    expect(axPageOf('/ja/ax-diagnosis')).toEqual({ page: 'ax-diagnosis' });
  });

  it('knows no other path', () => {
    for (const path of ['/', '/ja', '/ja/dashboard', '/fr/ax-migration', '/ja/ax-migration/x', '/ja/ax-migration/access/x']) {
      expect(axPageOf(path), path).toBeNull();
    }
  });
});

describe('isAxFrom', () => {
  it('accepts a page and a link placement of the site only', () => {
    expect(isAxFrom('ax-lp-targets-access')).toBe(true);
    expect(isAxFrom('ax-access-lp-footer')).toBe(true);
    expect(isAxFrom('ax-column-body')).toBe(true);
    for (const value of ['ax-lp', 'ax-lp-hero', 'lp-footer', 'ax-lp-footer ', '', null, 1]) {
      expect(isAxFrom(value), String(value)).toBe(false);
    }
  });
});

describe('isLandingHref', () => {
  it('is true for site paths to a landing page or the diagnosis', () => {
    expect(isLandingHref('/ja/ax-migration/access#diagnosis')).toBe(true);
    expect(isLandingHref('/ja/ax-migration#targets')).toBe(true);
    expect(isLandingHref('/ja/ax-diagnosis?x=1')).toBe(true);
    expect(isLandingHref('/ja/ax-migration/column/access-2gb-limit')).toBe(false);
    expect(isLandingHref('https://example.com/ja/ax-migration')).toBe(false);
    expect(isLandingHref('//example.com/ja/ax-migration')).toBe(false);
  });
});

describe('crossLinkHref', () => {
  it('adds from and carries the utm_* of the current address, keeping the anchor', () => {
    expect(
      crossLinkHref(
        '/ja/ax-migration/access#diagnosis',
        'ax-lp-targets-access',
        '?utm_source=google&utm_medium=cpc&ref=partner&agency=abc'
      )
    ).toBe(
      '/ja/ax-migration/access?utm_source=google&utm_medium=cpc&from=ax-lp-targets-access#diagnosis'
    );
  });

  it('keeps utm_* the link sets itself and leaves out a from outside the list', () => {
    expect(crossLinkHref('/ja/ax-migration?utm_source=mail', 'ax-lp-hero', '?utm_source=google')).toBe(
      '/ja/ax-migration?utm_source=mail'
    );
    expect(crossLinkHref('/ja/ax-migration', 'ax-access-lp-footer', '')).toBe(
      '/ja/ax-migration?from=ax-access-lp-footer'
    );
  });
});

describe('readTrackingParams', () => {
  it('reads a from of the site with the utm_*', () => {
    window.history.replaceState(null, '', '/ja/ax-migration/access?from=ax-lp-targets-access&utm_source=google');
    expect(readTrackingParams()).toMatchObject({
      from: 'ax-lp-targets-access',
      utmSource: 'google',
      landingPath: '/ja/ax-migration/access',
    });
  });

  it('drops any other from', () => {
    window.history.replaceState(null, '', '/ja/ax-migration?from=somewhere-else');
    expect(readTrackingParams()).not.toHaveProperty('from');
  });
});
