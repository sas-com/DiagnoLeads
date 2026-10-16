import { isTestMode } from '@/lib/email/allowed-recipients';
import type { Metadata } from 'next';

/**
 * Which pages search engines may index (decided 2026-10-16, Issue #51):
 * - While test mode is on (APP_TEST_MODE), no page is indexed.
 * - After public launch, only the AX migration landing page and the diagnosis are indexed.
 * - Everything else (admin, sign-in, sign-up, invitations, the generic SaaS pages) never is.
 * Turning test mode off is the public launch, which needs the publication approval first.
 */
export const INDEXABLE_PATHS = ['/ax-migration', '/ax-diagnosis'] as const;

export function isIndexable(path: (typeof INDEXABLE_PATHS)[number] | null): boolean {
  return path !== null && !isTestMode();
}

export const NOINDEX: NonNullable<Metadata['robots']> = { index: false, follow: false };

/** robots metadata for a page; pass null for pages that are never indexed */
export function robotsFor(path: (typeof INDEXABLE_PATHS)[number] | null): Metadata['robots'] {
  return isIndexable(path) ? { index: true, follow: true } : NOINDEX;
}
