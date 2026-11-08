/**
 * The checks of a help article (Epic #877, #871): an article is typed data, so mistakes are
 * caught here before it reaches the screen.
 */
import {
  type HelpArticle,
  helpArticleLinks,
  helpInlineText,
  isAllowedHelpHref,
  validateHelpArticle,
} from '@/lib/features/help/types';
import { describe, expect, it } from 'vitest';

const article = (overrides: Partial<HelpArticle> = {}): HelpArticle => ({
  id: 'leads',
  locale: 'ja',
  title: 'リード管理',
  summary: '見込み客を一覧で探し、次の行動を決める画面です。',
  routes: ['/leads', '/leads/[leadId]'],
  reviewedAt: '2026-10-28',
  blocks: [
    { type: 'h2', id: 'steps', text: '使い方' },
    {
      type: 'steps',
      items: [
        '絞り込む',
        [
          { type: 'ui', text: '新規作成' },
          { type: 'text', text: ' を押す' },
        ],
      ],
    },
    { type: 'roles', roles: ['parent_viewer'], content: '閲覧だけです。' },
    {
      type: 'faq',
      items: [
        {
          question: '商談はどこで見ますか',
          answer: [
            { type: 'link', text: '商談', href: '/deals' },
            { type: 'text', text: ' の画面です。' },
          ],
        },
      ],
    },
  ],
  ...overrides,
});

describe('validateHelpArticle', () => {
  it('accepts a complete article', () => {
    expect(validateHelpArticle(article())).toEqual([]);
  });

  it('refuses empty texts, a bad id and a bad date', () => {
    expect(
      validateHelpArticle(article({ id: 'Leads Page', title: ' ', summary: '', reviewedAt: '10/28' }))
    ).toEqual([
      'id "Leads Page" is not lowercase-hyphenated',
      'title is empty',
      'summary is empty',
      'reviewedAt "10/28" is not a YYYY-MM-DD date',
    ]);
  });

  it('refuses a route with the locale or a trailing slash', () => {
    expect(validateHelpArticle(article({ routes: ['/ja/leads', '/leads/'] }))).toEqual([
      'route "/ja/leads" is not a route without the locale',
      'route "/leads/" is not a route without the locale',
    ]);
  });

  it('refuses repeated heading ids, uneven tables and empty lists', () => {
    expect(
      validateHelpArticle(
        article({
          blocks: [
            { type: 'h2', id: 'a', text: 'A' },
            { type: 'h3', id: 'a', text: 'B' },
            { type: 'table', header: ['項目', '意味'], rows: [['状態']] },
            { type: 'steps', items: [] },
            { type: 'roles', roles: [], content: '…' },
          ],
        })
      )
    ).toEqual([
      'heading id "a" is repeated',
      'a table row has the wrong length',
      'a steps block has no items',
      'a roles note names no role',
    ]);
  });

  it('refuses an article without blocks', () => {
    expect(validateHelpArticle(article({ blocks: [] }))).toEqual(['the article has no blocks']);
  });

  it('refuses links outside the admin app', () => {
    const outside = article({
      blocks: [
        {
          type: 'p',
          content: [
            { type: 'link', text: '外', href: 'https://example.com' },
            { type: 'link', text: '言語つき', href: '/ja/leads' },
          ],
        },
      ],
    });
    expect(validateHelpArticle(outside)).toEqual([
      'link "https://example.com" is not a path of the admin app',
      'link "/ja/leads" is not a path of the admin app',
    ]);
  });
});

describe('isAllowedHelpHref', () => {
  it.each([
    ['/leads', true],
    ['/settings/members', true],
    ['/help/leads#steps', true],
    ['/ja/leads', false],
    ['/en', false],
    ['/javascript', true],
    ['https://example.com', false],
    ['//example.com', false],
    ['javascript:alert(1)', false],
    ['/leads/', false],
    ['leads', false],
  ])('%s -> %s', (href, allowed) => {
    expect(isAllowedHelpHref(href)).toBe(allowed);
  });
});

describe('helpers', () => {
  it('collects the links of every kind of block', () => {
    expect(helpArticleLinks(article())).toEqual(['/deals']);
  });

  it('reads an inline as plain text', () => {
    expect(
      helpInlineText([
        { type: 'ui', text: '保存' },
        { type: 'text', text: ' を押します' },
      ])
    ).toBe('保存 を押します');
  });
});
