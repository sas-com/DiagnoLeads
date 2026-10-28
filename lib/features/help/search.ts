import { type HelpArticle, type HelpBlock, helpInlineText } from './types';

/** Text of a block, as a reader sees it */
function blockText(block: HelpBlock): string {
  switch (block.type) {
    case 'h2':
    case 'h3':
      return block.text;
    case 'p':
    case 'note':
    case 'roles':
      return helpInlineText(block.content);
    case 'ul':
    case 'steps':
      return block.items.map(helpInlineText).join('\n');
    case 'table':
      return [block.header, ...block.rows].map((row) => row.join(' ')).join('\n');
    case 'faq':
      return block.items
        .map((item) => `${item.question}\n${helpInlineText(item.answer)}`)
        .join('\n');
  }
}

/** Width and case differences a reader does not mean (ＭＱＬ = mql, ﾋｱﾘﾝｸﾞ = ヒアリング) */
function normalize(text: string): string {
  return text.normalize('NFKC').toLowerCase();
}

/** Everything the search looks at: the title, the summary and the body */
export function helpArticleText(article: HelpArticle): string {
  return [article.title, article.summary, ...article.blocks.map(blockText)].join('\n');
}

/**
 * Articles that contain every word of the query (words split by spaces): those whose title has a
 * word first, then those whose summary has one, then the rest, each in the order given. An empty
 * query finds nothing: the table of contents is shown instead.
 */
export function searchHelpArticles(query: string, articles: readonly HelpArticle[]): HelpArticle[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const has = (text: string) => {
    const normalized = normalize(text);
    return words.some((word) => normalized.includes(word));
  };
  const rank = (article: HelpArticle) => (has(article.title) ? 0 : has(article.summary) ? 1 : 2);
  return articles
    .filter((article) => {
      const text = normalize(helpArticleText(article));
      return words.every((word) => text.includes(word));
    })
    .map((article, index) => ({ article, index, rank: rank(article) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ article }) => article);
}
