/**
 * Prints the pages the Lighthouse run measures (#569, decision 2026-10-24-performance-targets),
 * one URL per line: the three AX pages, the column list and the newest column.
 * Used by scripts/lighthouse-run.sh; by hand:
 *   BASE_URL=https://diagnoleads-v2.vercel.app node scripts/lighthouse-pages.ts
 *
 * The newest column is read from the column list that BASE_URL serves, not from the repository,
 * so the run measures an article that is live there. No dependencies: runs on Node 22 (type
 * stripping) and on Bun.
 */
import { pathToFileURL } from 'node:url';

export const FIXED_PATHS = [
  '/ja/ax-migration',
  '/ja/ax-migration/access',
  '/ja/ax-diagnosis',
  '/ja/ax-migration/column',
] as const;

export const COLUMN_LIST_PATH = '/ja/ax-migration/column';

const DATE = /\bdatetime="(\d{4}-\d{2}-\d{2})"/i;
const ARTICLE_LINK = /\bhref="(\/ja\/ax-migration\/column\/[a-z0-9-]+)"/i;

/**
 * Path of the newest article on the column list page: each card is an <article> with the
 * publication date (<time dateTime>) and the link to the article. On a tie, the card listed
 * first wins. Undefined when no card has both.
 */
export function newestColumnPath(listHtml: string): string | undefined {
  let newest: { date: string; path: string } | undefined;
  for (const card of listHtml.split(/<article\b/i).slice(1)) {
    const date = DATE.exec(card)?.[1];
    const path = ARTICLE_LINK.exec(card)?.[1];
    if (!date || !path) continue;
    if (!newest || date > newest.date) newest = { date, path };
  }
  return newest?.path;
}

export function pageUrls(baseUrl: string, newestColumn: string): string[] {
  const base = baseUrl.replace(/\/+$/, '');
  return [...FIXED_PATHS, newestColumn].map((path) => `${base}${path}`);
}

async function main(): Promise<void> {
  const baseUrl = process.env.BASE_URL || 'https://diagnoleads-v2.vercel.app';
  const listUrl = `${baseUrl.replace(/\/+$/, '')}${COLUMN_LIST_PATH}`;
  const response = await fetch(listUrl, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${listUrl}: HTTP ${response.status}`);
  const newest = newestColumnPath(await response.text());
  if (!newest) throw new Error(`${listUrl}: no article with a date and a link was found`);
  console.log(pageUrls(baseUrl, newest).join('\n'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
