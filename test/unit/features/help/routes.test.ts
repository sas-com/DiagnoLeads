/**
 * Which help article the header button opens for a page path (Epic #877, #872).
 */
import { HELP_ARTICLES } from '@/lib/features/help/articles';
import { helpArticleForPath, pathMatchesRoute } from '@/lib/features/help/routes';
import type { HelpArticle } from '@/lib/features/help/types';
import { describe, expect, it } from 'vitest';

const article = (id: string, routes: string[]): HelpArticle => ({
  id,
  locale: 'ja',
  title: id,
  summary: id,
  routes,
  reviewedAt: '2026-10-28',
  blocks: [],
});

describe('pathMatchesRoute', () => {
  it.each([
    ['/ja/leads', '/leads'],
    ['/en/leads', '/leads'],
    ['/leads', '/leads'],
    ['/ja/leads/', '/leads'],
    ['/ja/leads?status=new', '/leads'],
    ['/ja/leads/1234#memo', '/leads/[leadId]'],
    ['/ja/leads/1234/hearings/5678', '/leads/[leadId]/hearings/[hearingId]'],
  ])('%s fits %s', (pathname, route) => {
    expect(pathMatchesRoute(pathname, route)).toBe(true);
  });

  it.each([
    ['/ja/leads/1234', '/leads'],
    ['/ja/leads', '/leads/[leadId]'],
    ['/ja/deals', '/leads'],
    ['/ja/leads/1234/handoff', '/leads/[leadId]/hearings/[hearingId]'],
    ['/ja', '/leads'],
  ])('%s does not fit %s', (pathname, route) => {
    expect(pathMatchesRoute(pathname, route)).toBe(false);
  });
});

describe('helpArticleForPath', () => {
  it('finds the article of a page with or without the locale', () => {
    expect(helpArticleForPath('/ja/leads')?.id).toBe('leads');
    expect(helpArticleForPath('/leads')?.id).toBe('leads');
    expect(helpArticleForPath('/en/leads/0b0e/handoff')?.id).toBe('lead-handoff');
  });

  it('has no article for a page without one', () => {
    expect(helpArticleForPath('/ja/no-such-page')).toBeUndefined();
    expect(helpArticleForPath('')).toBeUndefined();
  });

  it('prefers a fixed segment to a parameter at the same place', () => {
    const articles = [article('detail', ['/leads/[leadId]']), article('new', ['/leads/new'])];
    expect(helpArticleForPath('/ja/leads/new', articles)?.id).toBe('new');
    expect(helpArticleForPath('/ja/leads/1234', articles)?.id).toBe('detail');
  });

  it('opens an article for every route it names', () => {
    for (const each of HELP_ARTICLES) {
      for (const route of each.routes) {
        const pathname = `/ja${route.replace(/\[[a-zA-Z]+\]/g, '0b0e')}`;
        expect(helpArticleForPath(pathname)?.id, pathname).toBe(each.id);
      }
    }
  });
});
