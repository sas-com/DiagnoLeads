/**
 * The help center's search (#874): every word of the query in the title, summary or body,
 * title matches first.
 */
import { HELP_ARTICLES } from '@/lib/features/help/articles';
import { helpArticleText, searchHelpArticles } from '@/lib/features/help/search';
import type { HelpArticle } from '@/lib/features/help/types';
import { describe, expect, it } from 'vitest';

const article = (id: string, title: string, body: string): HelpArticle => ({
  id,
  locale: 'ja',
  title,
  summary: `${title}の要約`,
  routes: [],
  reviewedAt: '2026-10-28',
  blocks: [
    { type: 'h2', id: 'h', text: '見出し' },
    { type: 'p', content: [{ type: 'text', text: body }] },
    { type: 'table', header: ['欄'], rows: [['表の中の言葉']] },
    { type: 'faq', items: [{ question: '質問', answer: 'よくある答え' }] },
  ],
});

const articles = [
  article('deals', '商談', 'ステージを動かすと確度が変わります'),
  article('glossary', '用語集', 'SQL判定は見極めの出口です'),
  article('forecast', '売上予測', '商談の確度から見込みを出します'),
];

describe('helpArticleText', () => {
  it('reads the title, summary and every kind of block', () => {
    const text = helpArticleText(articles[0]);
    for (const part of ['商談', '商談の要約', '見出し', 'ステージ', '表の中の言葉', '質問', 'よくある答え']) {
      expect(text).toContain(part);
    }
  });
});

describe('searchHelpArticles', () => {
  it('finds nothing for an empty query', () => {
    expect(searchHelpArticles('  ', articles)).toEqual([]);
  });

  it('puts title matches first', () => {
    expect(searchHelpArticles('商談', articles).map((each) => each.id)).toEqual([
      'deals',
      'forecast',
    ]);
  });

  it('puts summary matches before body matches', () => {
    const inBody = article('a', '見出しの記事', '招待の手順');
    const inSummary = { ...article('b', '別の記事', '本文'), summary: 'メンバーを招待する' };
    expect(searchHelpArticles('招待', [inBody, inSummary]).map((each) => each.id)).toEqual([
      'b',
      'a',
    ]);
  });

  it('needs every word', () => {
    expect(searchHelpArticles('確度 見込み', articles).map((each) => each.id)).toEqual([
      'forecast',
    ]);
  });

  it('ignores width and case', () => {
    expect(searchHelpArticles('ｓｑｌ', articles).map((each) => each.id)).toEqual(['glossary']);
  });

  it('finds the real articles by the words people use', () => {
    expect(searchHelpArticles('SQL判定', HELP_ARTICLES).map((each) => each.id)).toContain(
      'glossary'
    );
    expect(searchHelpArticles('招待', HELP_ARTICLES)[0]?.id).toBe('settings-members');
  });
});
