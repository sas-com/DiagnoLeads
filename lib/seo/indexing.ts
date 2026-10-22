import { isTestMode } from '@/lib/email/allowed-recipients';
import { COLUMN_PATHS, type ColumnPath } from '@/lib/features/ax-site/columns';
import type { Metadata } from 'next';

/**
 * Which pages search engines may index (decided 2026-10-16, Issue #51):
 * - While test mode is on (APP_TEST_MODE), no page is indexed.
 * - After public launch, only the AX migration landing pages (the main one and the Access one,
 *   #296), the diagnosis, and the column list and its articles (#324) are indexed.
 * - Everything else (admin, sign-in, sign-up, invitations, the generic SaaS pages) never is.
 * Turning test mode off is the public launch, which needs the publication approval first.
 */
const AX_PAGE_PATHS = ['/ax-migration', '/ax-migration/access', '/ax-diagnosis'] as const;

export type IndexablePath = (typeof AX_PAGE_PATHS)[number] | ColumnPath;

/** Every indexable page; a column path is indexable only for a published article */
export const INDEXABLE_PATHS: readonly IndexablePath[] = [...AX_PAGE_PATHS, ...COLUMN_PATHS];

export function isIndexable(path: IndexablePath | null): boolean {
  return path !== null && INDEXABLE_PATHS.includes(path) && !isTestMode();
}

export const NOINDEX: NonNullable<Metadata['robots']> = { index: false, follow: false };

/** robots metadata for a page; pass null for pages that are never indexed */
export function robotsFor(path: IndexablePath | null): Metadata['robots'] {
  return isIndexable(path) ? { index: true, follow: true } : NOINDEX;
}

/** Address of the site for absolute URLs (sitemap, robots.txt, structured data) */
export function siteBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'https://diagnoleads-v2.vercel.app';
}
