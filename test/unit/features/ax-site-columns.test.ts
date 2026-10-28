/**
 * Column articles of the AX migration site (#324): the content is typed data, checked here
 * before it is published.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  COLUMNS,
  COLUMN_PATHS,
  COLUMN_THUMBNAIL_SIZE,
  type Column,
  columnLinks,
  columnStrings,
  columnThumbnailPath,
  columnUpdatedAt,
  getColumn,
  isAllowedHref,
  validateColumn,
} from '@/lib/features/ax-site/columns';
import {
  articleJsonLd,
  breadcrumbListJsonLd,
} from '@/lib/features/ax-site/columns/structured-data';
import {
  AX_SHARE_IMAGES,
  type AxSharePage,
  axShareImage,
  axShareImagePath,
  axShareLocale,
} from '@/lib/features/ax-site/share-images';
import en from '@/locales/en/common.json';
import ja from '@/locales/ja/common.json';
import { type AbstractIntlMessages, createTranslator } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

const article = getColumn('access-office-support-end') as Column;

describe('column content', () => {
  it.each(COLUMNS.map((column) => [column.slug, column] as const))(
    '%s has every field, unique heading ids and only site or https links',
    (_, column) => {
      expect(validateColumn(column)).toEqual([]);
    }
  );

  it('has unique slugs', () => {
    const slugs = COLUMNS.map((column) => column.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('keeps the Access article dated, in Japanese and tied to the Access page', () => {
    expect(article).toMatchObject({
      locale: 'ja',
      publishedAt: '2026-10-22',
      updatedAt: '2026-10-22',
      related: 'access',
      cta: 'access-diagnosis',
    });
  });

  it('closes the Access article with the Access diagnosis and the time zone of the dates', () => {
    expect(columnLinks(article)).toContain('/ja/ax-migration/access#diagnosis');
    const texts = columnStrings(article);
    expect(texts).toContain('Microsoft のライフサイクル表は、日付を米国太平洋時間で表記しています。');
    expect(texts).toContain('（2026年10月時点の情報です）');
  });

  it('cites Microsoft pages only, over https', () => {
    const sources = article.blocks.flatMap((block) => (block.type === 'sources' ? block.items : []));
    expect(sources).toHaveLength(11);
    for (const { href } of sources) {
      expect(new URL(href).hostname).toMatch(/^(learn|support)\.microsoft\.com$/);
    }
  });

  it('lists the index and every article for indexing, dated by the newest article', () => {
    expect(COLUMN_PATHS).toEqual([
      '/ax-migration/column',
      '/ax-migration/column/access-file-types',
      '/ax-migration/column/access-office-support-end',
      '/ax-migration/column/access-fix-or-web',
      '/ax-migration/column/access-web-security',
      '/ax-migration/column/access-shared-folder',
      '/ax-migration/column/access-accde-only',
      '/ax-migration/column/access-2gb-limit',
    ]);
    expect(columnUpdatedAt('/ax-migration/column')).toBe('2026-10-28');
    expect(columnUpdatedAt('/ax-migration/access')).toBeUndefined();
  });
});

describe('the Access series', () => {
  const series = COLUMNS.filter((column) => column.slug !== 'access-office-support-end');
  const PUBLISHED_ON: Record<string, string> = {
    'access-file-types': '2026-10-23',
    'access-web-security': '2026-10-24',
  };
  /** Articles changed after they came out */
  const UPDATED_ON: Record<string, string> = {
    // The upkeep we provide after the move (#840)
    'access-web-security': '2026-10-28',
  };
  const MICROSOFT_HOSTS = /^(learn|support)\.microsoft\.com$/;
  /**
   * The facts of an article come from the publisher of the product: Microsoft for Access, and for
   * the PHP vulnerabilities (#465) the PHP project and IPA, the Japanese public body that alerts
   * on them
   */
  const SOURCE_HOSTS: Record<string, RegExp> = {
    'access-web-security': /^www\.(php\.net|ipa\.go\.jp)$/,
  };

  it('is listed in reading order: the file types first (#372), then the support-end article', () => {
    expect(COLUMNS.map((column) => column.slug)).toEqual([
      'access-file-types',
      'access-office-support-end',
      'access-fix-or-web',
      'access-web-security',
      'access-shared-folder',
      'access-accde-only',
      'access-2gb-limit',
    ]);
  });

  it.each(series.map((column) => [column.slug, column] as const))(
    '%s is dated, in Japanese, tied to the Access page and ends with the diagnosis',
    (_, column) => {
      // The file types article (#367) came a day after the others, the web security one (#465)
      // two days after
      const date = PUBLISHED_ON[column.slug] ?? '2026-10-22';
      expect(column).toMatchObject({
        locale: 'ja',
        publishedAt: date,
        updatedAt: UPDATED_ON[column.slug] ?? date,
        related: 'access',
        cta: 'access-diagnosis',
      });
      expect(columnLinks(column)).toContain('/ja/ax-migration/access#diagnosis');
      expect(columnStrings(column)).toContain('（2026年10月時点の情報です）');
    }
  );

  it.each(series.map((column) => [column.slug, column] as const))(
    '%s links only to published articles and the diagnosis inside the site, and cites official pages over https',
    (_, column) => {
      const published = new Set(COLUMNS.map((c) => `/ja/ax-migration/column/${c.slug}`));
      for (const href of columnLinks(column).filter((h) => h.startsWith('/'))) {
        expect(href === '/ja/ax-migration/access#diagnosis' || published.has(href)).toBe(true);
      }
      const sources = column.blocks.flatMap((block) =>
        block.type === 'sources' ? block.items : []
      );
      expect(sources.length).toBeGreaterThan(0);
      for (const { href } of sources) {
        expect(href.startsWith('https://')).toBe(true);
        expect(new URL(href).hostname).toMatch(SOURCE_HOSTS[column.slug] ?? MICROSOFT_HOSTS);
      }
    }
  );

  it('names the products of each article in its own trademark notice', () => {
    expect(article.trademark).toBeUndefined();
    const notice = (slug: string) => getColumn(slug)?.trademark;
    expect(notice('access-fix-or-web')).toMatch(/^Microsoft、Access、SQL Server、Excel は、/);
    expect(notice('access-shared-folder')).toMatch(
      /^Microsoft、Access、SQL Server、OneDrive、SharePoint は、/
    );
    expect(notice('access-accde-only')).toMatch(/^Microsoft、Access、Excel は、/);
    expect(notice('access-2gb-limit')).toMatch(/^Microsoft、Access、SQL Server は、/);
    expect(notice('access-file-types')).toMatch(
      /^Microsoft、Access、Excel、SQL Server、Windows、Microsoft 365 は、/
    );
    // Names no Microsoft product besides Access: the notice of the Access page
    expect(notice('access-web-security')).toBeUndefined();
  });

  it('says so when a source is an old technical document (previous-versions)', () => {
    for (const column of series) {
      const sources = column.blocks.flatMap((block) =>
        block.type === 'sources' ? block.items : []
      );
      if (!sources.some(({ href }) => href.includes('/previous-versions/'))) continue;
      expect(columnStrings(column).some((text) => text.includes('古い技術資料'))).toBe(true);
    }
  });
});

/** Width and height from the IHDR chunk of a PNG */
const pngSize = (png: Buffer) => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) });

/** A 1200x630 PNG under 120 KB in public/ (bun run columns:thumbnails) */
function expectCardPng(publicPath: string) {
  const png = readFileSync(path.join(process.cwd(), 'public', publicPath));
  expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
  expect(pngSize(png)).toEqual(COLUMN_THUMBNAIL_SIZE);
  expect(png.byteLength).toBeLessThan(120 * 1024);
}

describe('column thumbnails (#335)', () => {
  it.each(COLUMNS.map((column) => [column.slug, column] as const))(
    '%s has its 1200x630 PNG under 120 KB in public/ (bun run columns:thumbnails)',
    (slug) => {
      expect(columnThumbnailPath(slug)).toBe(`/images/columns/${slug}.png`);
      expectCardPng(columnThumbnailPath(slug));
    }
  );

  it('shows the risk on the support-end article and the way forward on the fix-or-web one', () => {
    expect(getColumn('access-office-support-end')?.thumbnail.icon).toBe('shield-alert');
    expect(getColumn('access-fix-or-web')?.thumbnail.icon).toBe('signpost');
  });

  it('breaks the titles into at most 3 lines that make up the title', () => {
    const lines = (lines: string[]) => ({ ...article, thumbnail: { icon: 'shield-alert' as const, lines } });
    expect(validateColumn(lines(['Access 2016・2019・2021 の', 'サポート終了'])).at(-1)).toBe(
      'thumbnail lines are not the title'
    );
    expect(validateColumn(lines(['a', 'b', 'c', 'd']))).toContain('thumbnail has 4 lines (1 to 3)');
    expect(validateColumn(lines([' ', article.title]))).toContain('a thumbnail line is empty');
  });

  it('refuses an unknown icon or accent', () => {
    const odd = { ...article, thumbnail: { icon: 'rocket', accent: 'pink' } } as unknown as Column;
    expect(validateColumn(odd)).toEqual([
      'thumbnail icon "rocket" is unknown',
      'thumbnail accent "pink" is unknown',
    ]);
  });
});

describe('share images of the landing pages and the column list (#344)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const images = (Object.keys(AX_SHARE_IMAGES) as AxSharePage[]).flatMap((page) =>
    AX_SHARE_IMAGES[page].locales.map((locale) => [`${page}-${locale}`, page, locale] as const)
  );

  it.each(images)('%s has its 1200x630 PNG under 120 KB in public/', (name, page, locale) => {
    expect(axShareImagePath(page, locale)).toBe(`/images/og/${name}.png`);
    expectCardPng(axShareImagePath(page, locale));
  });

  it.each(images)('%s says only what the page says: no duration, cost or rate', (_, page, locale) => {
    const messages: AbstractIntlMessages = locale === 'en' ? en : ja;
    const t = createTranslator({ locale, messages });
    const { labelKey, titleKey } = AX_SHARE_IMAGES[page];
    for (const key of [labelKey, titleKey]) {
      const text = t(key as never);
      // A missing message comes back as its key
      expect(text).not.toContain(key);
      expect(text).not.toMatch(/\d+\s*(?:%|％|割|円|ヶ月|か月|カ月|週間|日で|minutes?|months?|weeks?|yen)|削減|短縮|reduc|cut|save/i);
    }
  });

  it.each(images)('%s breaks its title by hand only into the title itself', (_, page, locale) => {
    const lines = AX_SHARE_IMAGES[page].lines?.[locale];
    if (!lines) return;
    const messages: AbstractIntlMessages = locale === 'en' ? en : ja;
    const title: string = createTranslator({ locale, messages })(
      AX_SHARE_IMAGES[page].titleKey as never
    );
    expect(lines.join('').replace(/\s/g, '')).toBe(title.replace(/\s/g, ''));
  });

  it('puts the two choices of the Access title on one line (#347)', () => {
    expect(AX_SHARE_IMAGES['ax-access'].lines?.ja).toEqual([
      'その Access、',
      '直して使うか、Web に移すか。',
    ]);
  });

  it('uses the image of the page locale, or the first one the page has', () => {
    expect(axShareLocale('ax-migration', 'en')).toBe('en');
    expect(axShareLocale('ax-column', 'en')).toBe('ja');
    expect(axShareLocale('ax-access', 'fr')).toBe('ja');
  });

  it('gives the metadata an absolute URL, the size and the alt text', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://example.jp');
    expect(axShareImage('ax-access', 'en', 'alt')).toEqual({
      url: 'https://example.jp/images/og/ax-access-en.png',
      width: 1200,
      height: 630,
      alt: 'alt',
    });
  });
});

describe('column validation', () => {
  const broken: Column = {
    ...article,
    slug: 'Bad Slug',
    title: ' ',
    publishedAt: '2026/10/22',
    blocks: [
      { type: 'h2', id: 'same', text: 'A' },
      { type: 'h3', id: 'same', text: 'B' },
      { type: 'h2', id: 'sources', text: 'C' },
      {
        type: 'p',
        content: [
          { type: 'link', text: 'x', href: 'http://example.com/' },
          { type: 'link', text: 'y', href: 'javascript:alert(1)' },
        ],
      },
      { type: 'ul', items: [[{ type: 'link', text: 'z', href: '//evil.example/' }]] },
      { type: 'table', header: ['a', 'b'], rows: [['1']] },
      { type: 'sources', items: [{ title: 't', href: 'relative/path' }], notes: [] },
    ],
  };

  it('refuses an empty trademark notice', () => {
    expect(validateColumn({ ...article, trademark: ' ' })).toEqual(['trademark is empty']);
  });

  it('reports every problem', () => {
    expect(validateColumn(broken)).toEqual([
      'slug "Bad Slug" is not lowercase-hyphenated',
      'title is empty',
      'publishedAt "2026/10/22" is not a YYYY-MM-DD date',
      'heading id "same" is repeated',
      'heading id "sources" is repeated',
      'a table row has the wrong length',
      'link "http://example.com/" is neither a site path nor https',
      'link "javascript:alert(1)" is neither a site path nor https',
      'link "//evil.example/" is neither a site path nor https',
      'link "relative/path" is neither a site path nor https',
      // The empty title no longer matches the lines of the thumbnail
      'thumbnail lines are not the title',
    ]);
  });

  it.each([
    ['/ja/ax-migration/access#diagnosis', true],
    ['https://learn.microsoft.com/', true],
    ['http://learn.microsoft.com/', false],
    ['//evil.example/', false],
    ['/\\evil.example', false],
    ['javascript:alert(1)', false],
    ['data:text/html,x', false],
    ['mailto:a@example.com', false],
    ['ax-migration', false],
  ])('allows %s: %s', (href, allowed) => {
    expect(isAllowedHref(href)).toBe(allowed);
  });
});

describe('column structured data', () => {
  it('describes the article with its dates and the operator', () => {
    const url = 'https://example.jp/ja/ax-migration/column/access-office-support-end';
    expect(
      articleJsonLd(article, {
        url,
        imageUrl: 'https://example.jp/images/columns/access-office-support-end.png',
        operatorName: 'エス・エー・エス株式会社',
        operatorUrl: 'https://sas-com.com/',
      })
    ).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: article.title,
      description: article.description,
      inLanguage: 'ja',
      datePublished: '2026-10-22T00:00:00+09:00',
      dateModified: '2026-10-22T00:00:00+09:00',
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      url,
      image: {
        '@type': 'ImageObject',
        url: 'https://example.jp/images/columns/access-office-support-end.png',
        width: 1200,
        height: 630,
      },
      author: { '@type': 'Organization', name: 'エス・エー・エス株式会社', url: 'https://sas-com.com/' },
      publisher: { '@type': 'Organization', name: 'エス・エー・エス株式会社', url: 'https://sas-com.com/' },
    });
  });

  it('numbers the breadcrumbs from 1', () => {
    expect(
      breadcrumbListJsonLd([
        { name: 'A', url: 'https://example.jp/a' },
        { name: 'B', url: 'https://example.jp/b' },
      ]).itemListElement
    ).toEqual([
      { '@type': 'ListItem', position: 1, name: 'A', item: 'https://example.jp/a' },
      { '@type': 'ListItem', position: 2, name: 'B', item: 'https://example.jp/b' },
    ]);
  });
});
