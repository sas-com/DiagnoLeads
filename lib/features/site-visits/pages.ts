import { axPageOf } from '@/lib/features/ax-site/cross-links';

/**
 * The public pages that are measured (#412) and whose organization each belongs to. Anything
 * else (the admin screens, sign-in, the unsubscribe and confirm pages that carry tokens) is not
 * measured. No zod here: the beacon imports it.
 */
export type SitePageType =
  | 'ax-lp'
  | 'ax-access-lp'
  | 'ax-column-index'
  | 'ax-column'
  | 'ax-diagnosis'
  | 'diagnosis'
  | 'legacy-diagnostic'
  | 'home'
  | 'landing'
  | 'faq';

/**
 * Whose site the page is: the AX site's organization (AX_DIAGNOSIS_ORGANIZATION_ID), the
 * default organization, or the organization of a diagnosis made with the builder
 */
export type SitePageOwner =
  | { kind: 'ax' }
  | { kind: 'default' }
  | { kind: 'diagnosis'; slug: string };

export interface SitePage {
  /** Normalised path: no query, fragment or trailing slash */
  path: string;
  pageType: SitePageType;
  owner: SitePageOwner;
}

const MAX_PATH_LENGTH = 300;

const SIMPLE_PAGES: Record<string, SitePageType> = {
  '': 'home',
  landing: 'landing',
  faq: 'faq',
  diagnostic: 'legacy-diagnostic',
};

/** The measured page of a path, or null when the path is not measured */
export function sitePageOf(rawPath: string): SitePage | null {
  if (rawPath.length > MAX_PATH_LENGTH || !rawPath.startsWith('/')) return null;
  const path = rawPath.length > 1 ? rawPath.replace(/\/+$/, '') : rawPath;
  // Only plain path characters: no query, fragment, encoded slashes or dot segments
  if (!/^\/[A-Za-z0-9\-_/.~%]*$/.test(path) || path.includes('..') || path.includes('//')) {
    return null;
  }

  const ax = axPageOf(path);
  if (ax) return { path, pageType: ax.page, owner: { kind: 'ax' } };

  const match = /^\/(?:ja|en)(?:\/([^/]+)(?:\/([^/]+))?)?$/.exec(path);
  if (!match) return null;
  const [, first = '', second] = match;
  if (first === 'd') {
    return second
      ? { path, pageType: 'diagnosis', owner: { kind: 'diagnosis', slug: second } }
      : null;
  }
  const pageType = SIMPLE_PAGES[first];
  if (!pageType) return null;
  if (second !== undefined && pageType !== 'legacy-diagnostic') return null;
  return { path, pageType, owner: { kind: 'default' } };
}
