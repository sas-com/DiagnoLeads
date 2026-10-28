import { HELP_ARTICLES } from './articles';
import type { HelpArticle } from './types';

const LOCALES = new Set(['ja', 'en']);

/** Segments of a path without the locale and empty parts ("/ja/leads/1" -> ["leads", "1"]) */
function segmentsOf(pathname: string): string[] {
  const segments = pathname.split(/[?#]/)[0].split('/').filter(Boolean);
  return LOCALES.has(segments[0] ?? '') ? segments.slice(1) : segments;
}

/** Whether a page path fits a route ("/leads/[leadId]" fits "/ja/leads/1234") */
export function pathMatchesRoute(pathname: string, route: string): boolean {
  const path = segmentsOf(pathname);
  const pattern = route.split('/').filter(Boolean);
  if (path.length !== pattern.length) return false;
  return pattern.every(
    (part, index) => (part.startsWith('[') && part.endsWith(']')) || part === path[index]
  );
}

/**
 * The article that explains the page at `pathname` (with or without the locale), or undefined.
 * A route with fixed segments wins over one with a parameter at the same place, so a fixed page
 * next to a dynamic one ("/leads/new" beside "/leads/[leadId]") finds its own article.
 */
export function helpArticleForPath(
  pathname: string,
  articles: readonly HelpArticle[] = HELP_ARTICLES
): HelpArticle | undefined {
  let best: { article: HelpArticle; fixed: number } | undefined;
  for (const article of articles) {
    for (const route of article.routes) {
      if (!pathMatchesRoute(pathname, route)) continue;
      const fixed = route.split('/').filter((part) => part && !part.startsWith('[')).length;
      if (!best || fixed > best.fixed) best = { article, fixed };
    }
  }
  return best?.article;
}
