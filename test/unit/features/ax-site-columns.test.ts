/**
 * Column articles of the AX migration site (#324): the content is typed data, checked here
 * before it is published.
 */
import {
  COLUMNS,
  COLUMN_PATHS,
  type Column,
  columnLinks,
  columnStrings,
  columnUpdatedAt,
  getColumn,
  isAllowedHref,
  validateColumn,
} from '@/lib/features/ax-site/columns';
import {
  articleJsonLd,
  breadcrumbListJsonLd,
} from '@/lib/features/ax-site/columns/structured-data';
import { describe, expect, it } from 'vitest';

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
      '/ax-migration/column/access-office-support-end',
    ]);
    expect(columnUpdatedAt('/ax-migration/column')).toBe('2026-10-22');
    expect(columnUpdatedAt('/ax-migration/access')).toBeUndefined();
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
      articleJsonLd(article, { url, operatorName: 'エス・エー・エス株式会社', operatorUrl: 'https://sas-com.com/' })
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
