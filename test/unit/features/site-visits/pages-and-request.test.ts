import { sitePageOf } from '@/lib/features/site-visits/pages';
import {
  deviceOf,
  isBot,
  referrerHostOf,
  visitParamsOf,
} from '@/lib/features/site-visits/request';
import { visitDayOf, visitorHashOf } from '@/lib/features/site-visits/visitor';
import { describe, expect, it } from 'vitest';

// What the site's own visit measurement counts and records (#412)

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD =
  'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID_TABLET =
  'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

describe('sitePageOf', () => {
  it.each([
    ['/ja/ax-migration', 'ax-lp', 'operator'],
    ['/ja/ax-migration/', 'ax-lp', 'operator'],
    ['/en/ax-migration/access', 'ax-access-lp', 'operator'],
    ['/ja/ax-migration/column', 'ax-column-index', 'operator'],
    ['/ja/ax-migration/column/access-file-types', 'ax-column', 'operator'],
    ['/ja/ax-diagnosis', 'ax-diagnosis', 'operator'],
    ['/ja', 'home', 'operator'],
    ['/ja/landing', 'landing', 'operator'],
    ['/ja/diagnostic', 'legacy-diagnostic', 'operator'],
  ])('measures %s as %s', (path, pageType, owner) => {
    expect(sitePageOf(path)).toMatchObject({ pageType, owner: { kind: owner } });
  });

  it('measures a builder diagnosis as its own organization, by slug', () => {
    expect(sitePageOf('/ja/d/dx-check')).toEqual({
      path: '/ja/d/dx-check',
      pageType: 'diagnosis',
      owner: { kind: 'diagnosis', slug: 'dx-check' },
    });
  });

  it('names the column of a column page, for the server to check', () => {
    expect(sitePageOf('/ja/ax-migration/column/access-file-types')).toMatchObject({
      columnSlug: 'access-file-types',
    });
    expect(sitePageOf('/ja/ax-migration/column')).not.toHaveProperty('columnSlug');
  });

  it.each([
    '/ja/ax-migration/column/a%2Fb',
    '/ja/dashboard',
    '/ja/leads/123',
    '/ja/settings/embed',
    '/ja/login',
    '/ja/signup',
    '/ja/invite/token-value',
    '/ja/ax-diagnosis/email/confirm',
    '/ja/email/unsubscribe',
    '/ja/blog',
    '/ja/blog/post',
    '/ja/faq',
    // Template pages of the legacy form redirect to the AX diagnosis (#413)
    '/ja/diagnostic/made-up-1',
    '/ja/d',
    '/ja/faq/extra',
    '/fr/ax-migration',
    '/api/collect',
    'ja/ax-migration',
    '/ja/ax-migration?utm_source=x',
    '/ja/ax-migration#diagnosis',
    '/ja/d/../dashboard',
    '//evil.example/ja',
    `/ja/d/${'x'.repeat(400)}`,
  ])('does not measure %s', (path) => {
    expect(sitePageOf(path)).toBeNull();
  });
});

describe('request details', () => {
  it('drops bots and empty user agents', () => {
    expect(isBot('Googlebot/2.1 (+http://www.google.com/bot.html)')).toBe(true);
    expect(isBot('facebookexternalhit/1.1')).toBe(true);
    expect(isBot('Mozilla/5.0 HeadlessChrome/129.0')).toBe(true);
    expect(isBot('curl/8.5.0')).toBe(true);
    expect(isBot('')).toBe(true);
    expect(isBot(null)).toBe(true);
    expect(isBot(CHROME)).toBe(false);
    expect(isBot(IPHONE)).toBe(false);
  });

  it('keeps only the kind of device', () => {
    expect(deviceOf(CHROME)).toBe('desktop');
    expect(deviceOf(IPHONE)).toBe('mobile');
    expect(deviceOf(IPAD)).toBe('tablet');
    expect(deviceOf(ANDROID_TABLET)).toBe('tablet');
  });

  it('keeps only the host of the referrer', () => {
    expect(referrerHostOf('https://www.Google.com/search?q=secret')).toBe('www.google.com');
    expect(referrerHostOf('http://localhost:3000/ja/ax-migration')).toBe('localhost');
    expect(referrerHostOf('android-app://com.slack/')).toBeNull();
    expect(referrerHostOf('not a url')).toBeNull();
    expect(referrerHostOf('')).toBeNull();
  });

  it('keeps the utm_* and only an allowed from', () => {
    expect(
      visitParamsOf('?utm_source=x&utm_medium=email&utm_campaign=c&utm_content=a&utm_term=t&from=ax-lp-header&email=a@b.c')
    ).toEqual({
      utmSource: 'x',
      utmMedium: 'email',
      utmCampaign: 'c',
      utmContent: 'a',
      utmTerm: 't',
      fromRef: 'ax-lp-header',
    });
    expect(visitParamsOf('?from=evil')).toMatchObject({ fromRef: null, utmSource: null });
    // A mailing tool may put the subscriber's address in utm_*
    expect(visitParamsOf('?utm_content=taro%40example.com&utm_term=a@b').utmContent).toBeNull();
    expect(visitParamsOf('?utm_term=a@b').utmTerm).toBeNull();
    expect(visitParamsOf(`?utm_source=${'y'.repeat(500)}`).utmSource).toHaveLength(200);
    expect(visitParamsOf(undefined)).toMatchObject({ utmSource: null, fromRef: null });
  });
});

describe('visitor hash', () => {
  const base = { salt: 'salt-1', organizationId: 'org-1', ip: '203.0.113.5', userAgent: CHROME };

  it('is the same within a day and changes with the salt, the organization or the visitor', () => {
    const hash = visitorHashOf(base);
    expect(visitorHashOf(base)).toBe(hash);
    expect(visitorHashOf({ ...base, salt: 'salt-2' })).not.toBe(hash);
    expect(visitorHashOf({ ...base, organizationId: 'org-2' })).not.toBe(hash);
    expect(visitorHashOf({ ...base, ip: '203.0.113.6' })).not.toBe(hash);
    expect(visitorHashOf({ ...base, userAgent: IPHONE })).not.toBe(hash);
  });

  it('contains neither the address nor the browser', () => {
    const hash = visitorHashOf(base);
    expect(hash).not.toContain('203.0.113.5');
    expect(hash).not.toContain('Chrome');
    expect(hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('counts a view for the day in Japan', () => {
    expect(visitDayOf(new Date('2026-10-23T14:59:59Z'))).toBe('2026-10-23');
    expect(visitDayOf(new Date('2026-10-23T15:00:00Z'))).toBe('2026-10-24');
  });
});
