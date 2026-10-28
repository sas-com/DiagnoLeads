/**
 * Every admin page has a help article or a reason why not (Epic #877, #871): a page added or
 * renamed without its article fails here, so the help cannot silently fall behind the screens.
 */
import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  HELP_ARTICLES,
  HELP_EXCLUDED_ROUTES,
  helpArticleById,
  helpArticleForRoute,
} from '@/lib/features/help/articles';
import { helpArticleLinks, validateHelpArticle } from '@/lib/features/help/types';
import { describe, expect, it } from 'vitest';

const DASHBOARD_DIR = join(process.cwd(), 'app/[locale]/(dashboard)');

/** Routes of the admin pages without the locale: "/leads/[leadId]" for .../leads/[leadId]/page.tsx */
function adminRoutes(dir: string = DASHBOARD_DIR): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) routes.push(...adminRoutes(path));
    else if (entry.name === 'page.tsx') {
      const folder = relative(DASHBOARD_DIR, dir).split(sep).join('/');
      routes.push(`/${folder}`);
    }
  }
  return routes.sort();
}

describe('help articles and admin pages', () => {
  const routes = adminRoutes();

  it('finds the admin pages', () => {
    expect(routes).toContain('/leads');
    expect(routes).toContain('/leads/[leadId]');
    expect(routes).toContain('/settings/members');
  });

  it('explains every admin page or says why not', () => {
    const missing = routes.filter(
      (route) => !helpArticleForRoute(route) && !(route in HELP_EXCLUDED_ROUTES)
    );
    expect(missing, 'add an article for these pages (lib/features/help/articles.ts)').toEqual([]);
  });

  it('lists no page as excluded that has an article', () => {
    const both = Object.keys(HELP_EXCLUDED_ROUTES).filter((route) => helpArticleForRoute(route));
    expect(both, 'remove these pages from HELP_EXCLUDED_ROUTES').toEqual([]);
  });

  it('lists only pages that exist', () => {
    const named = [
      ...Object.keys(HELP_EXCLUDED_ROUTES),
      ...HELP_ARTICLES.flatMap((article) => article.routes),
    ];
    expect(named.filter((route) => !routes.includes(route))).toEqual([]);
  });

  it('redirects only to a page that exists', () => {
    for (const reason of Object.values(HELP_EXCLUDED_ROUTES)) {
      if (reason.kind === 'redirect') expect(routes).toContain(reason.to);
    }
  });

  it('explains each page in one article only', () => {
    const counts = new Map<string, number>();
    for (const route of HELP_ARTICLES.flatMap((article) => article.routes)) {
      counts.set(route, (counts.get(route) ?? 0) + 1);
    }
    expect([...counts].filter(([, count]) => count > 1)).toEqual([]);
  });

  it('gives each article a unique id', () => {
    const ids = HELP_ARTICLES.map((article) => article.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps every article valid', () => {
    const problems = HELP_ARTICLES.flatMap((article) =>
      validateHelpArticle(article).map((problem) => `${article.id}: ${problem}`)
    );
    expect(problems).toEqual([]);
  });

  it('links only to admin pages and articles that exist', () => {
    const broken = HELP_ARTICLES.flatMap((article) =>
      helpArticleLinks(article)
        .filter((href) => {
          const [path] = href.split('#');
          return path.startsWith('/help/')
            ? !helpArticleById(path.slice('/help/'.length))
            : !routes.includes(path);
        })
        .map((href) => `${article.id}: ${href}`)
    );
    expect(broken).toEqual([]);
  });
});
