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
  | 'landing';

/**
 * Whose site the page is: the operating organization (the company's own pages: the AX site, the
 * top page, landing and the legacy form; AX_DIAGNOSIS_ORGANIZATION_ID, else
 * DEFAULT_ORGANIZATION_ID, as for the content editors) or the organization of a diagnosis made
 * with the builder
 */
export type SitePageOwner = { kind: 'operator' } | { kind: 'diagnosis'; slug: string };

export interface SitePage {
  /** Normalised path: no query, fragment or trailing slash */
  path: string;
  pageType: SitePageType;
  owner: SitePageOwner;
  /** On a column page: the article, which the server checks exists before counting */
  columnSlug?: string;
}

const MAX_PATH_LENGTH = 300;

const SIMPLE_PAGES: Record<string, SitePageType> = {
  '': 'home',
  landing: 'landing',
  // Shown only while the legacy form is on; its template pages redirect to the AX diagnosis
  diagnostic: 'legacy-diagnostic',
};

/** The measured page of a path, or null when the path is not measured */
export function sitePageOf(rawPath: string): SitePage | null {
  if (rawPath.length > MAX_PATH_LENGTH || !rawPath.startsWith('/')) return null;
  const path = rawPath.length > 1 ? rawPath.replace(/\/+$/, '') : rawPath;
  // Only plain path characters: no query, fragment, percent-encoding or dot segments
  if (!/^\/[A-Za-z0-9\-_/.~]*$/.test(path) || path.includes('..') || path.includes('//')) {
    return null;
  }

  const ax = axPageOf(path);
  if (ax) {
    return ax.columnSlug
      ? { path, pageType: ax.page, owner: { kind: 'operator' }, columnSlug: ax.columnSlug }
      : { path, pageType: ax.page, owner: { kind: 'operator' } };
  }

  const match = /^\/(?:ja|en)(?:\/([^/]+)(?:\/([^/]+))?)?$/.exec(path);
  if (!match) return null;
  const [, first = '', second] = match;
  if (first === 'd') {
    return second
      ? { path, pageType: 'diagnosis', owner: { kind: 'diagnosis', slug: second } }
      : null;
  }
  const pageType = SIMPLE_PAGES[first];
  if (!pageType || second !== undefined) return null;
  return { path, pageType, owner: { kind: 'operator' } };
}
