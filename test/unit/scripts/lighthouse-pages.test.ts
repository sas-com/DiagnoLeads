// @vitest-environment node
/**
 * Pages of the daily Lighthouse run (scripts/lighthouse-pages.ts, #569): the four fixed pages and
 * the newest article of the column list, read from the list's markup (each card is an <article>
 * with a <time dateTime> and the link to the article, as production served it on 2026-10-24).
 */
import { describe, expect, it } from 'vitest';
import { newestColumnPath, pageUrls } from '../../../scripts/lighthouse-pages';

function card(date: string, slug: string): string {
  return `<li><article class="relative grid"><img alt="" src="/columns/${slug}.png"/><div><p class="text-sm">公開日 <time dateTime="${date}">${date}</time></p><h2><a href="/ja/ax-migration/column/${slug}" class="outline-none">${slug}</a></h2></div></article></li>`;
}

const header =
  '<header><a href="/ja/ax-migration">AX</a><a href="/ja/ax-migration/column">コラム</a></header>';

describe('newestColumnPath', () => {
  it('picks the article with the latest publication date, wherever it is in the list', () => {
    const html = `${header}<ul>${card('2026-10-23', 'access-file-types')}${card('2026-10-22', 'access-office-support-end')}${card('2026-10-24', 'access-web-security')}${card('2026-10-22', 'access-2gb-limit')}</ul>`;

    expect(newestColumnPath(html)).toBe('/ja/ax-migration/column/access-web-security');
  });

  it('takes the one listed first when two share the latest date', () => {
    const html = `<ul>${card('2026-10-22', 'access-fix-or-web')}${card('2026-10-22', 'access-2gb-limit')}</ul>`;

    expect(newestColumnPath(html)).toBe('/ja/ax-migration/column/access-fix-or-web');
  });

  it('reads the lower-case attribute too', () => {
    const html = card('2026-10-24', 'access-web-security').replace('dateTime', 'datetime');

    expect(newestColumnPath(html)).toBe('/ja/ax-migration/column/access-web-security');
  });

  it('ignores links outside the cards and cards without a date or a link', () => {
    const noDate = '<article><a href="/ja/ax-migration/column/no-date">x</a></article>';
    const noLink = '<article><time dateTime="2026-12-31">2026-12-31</time></article>';

    expect(newestColumnPath(`${header}${noDate}${noLink}`)).toBeUndefined();
    expect(newestColumnPath(`${noDate}${card('2026-10-01', 'dated')}`)).toBe(
      '/ja/ax-migration/column/dated'
    );
  });
});

describe('pageUrls', () => {
  it('lists the three AX pages, the column list and the newest column on the base URL', () => {
    expect(
      pageUrls('https://diagnoleads-v2.vercel.app/', '/ja/ax-migration/column/access-web-security')
    ).toEqual([
      'https://diagnoleads-v2.vercel.app/ja/ax-migration',
      'https://diagnoleads-v2.vercel.app/ja/ax-migration/access',
      'https://diagnoleads-v2.vercel.app/ja/ax-diagnosis',
      'https://diagnoleads-v2.vercel.app/ja/ax-migration/column',
      'https://diagnoleads-v2.vercel.app/ja/ax-migration/column/access-web-security',
    ]);
  });
});
