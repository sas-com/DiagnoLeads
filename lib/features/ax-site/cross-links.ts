/**
 * Links between the pages of the AX migration site (#332): the main landing page, the Access
 * landing page, the columns and the diagnosis page.
 *
 * A link that leads to another of these pages carries `?from=<page>-<placement>` and the utm_*,
 * `ref` and `agency` of the current address (the agency attribution of #147 survives the move), so the inflow of a page can be told apart from the moves inside the
 * site. Both are added when the link is followed; the href itself stays a plain path, so the link
 * works without JavaScript and the canonical address of every page stays as it is.
 *
 * No zod here: client components import it.
 */

/** Pages of the site, as the analytics events and `from` name them */
export const AX_PAGES = [
  'ax-lp',
  'ax-access-lp',
  'ax-column-index',
  'ax-column',
  'ax-diagnosis',
] as const;
export type AxPage = (typeof AX_PAGES)[number];

/** Where on a page a link to another page is */
export const AX_LINK_PLACEMENTS = [
  'header',
  'footer',
  'breadcrumb',
  'targets-access',
  // The Access page's link to the file types column, under the tools it covers (#367)
  'targets',
  'hosts',
  'paths',
  'related',
  'body',
  'end',
  // The column the diagnosis result recommends (#363), on whichever page the diagnosis is shown
  'result',
] as const;
export type AxLinkPlacement = (typeof AX_LINK_PLACEMENTS)[number];

/** Value of `from`: the page and the place of the link that was followed */
export type AxFrom = `${AxPage}-${AxLinkPlacement}`;

const FROM_VALUES: ReadonlySet<string> = new Set(
  AX_PAGES.flatMap((page) => AX_LINK_PLACEMENTS.map((placement) => `${page}-${placement}`))
);

/** Only the values the site itself writes are kept (tracking.from) */
export function isAxFrom(value: unknown): value is AxFrom {
  return typeof value === 'string' && FROM_VALUES.has(value);
}

export function isAxLinkPlacement(value: string): value is AxLinkPlacement {
  return (AX_LINK_PLACEMENTS as readonly string[]).includes(value);
}

export interface AxPageMatch {
  page: AxPage;
  /** The article, on a column page */
  columnSlug?: string;
}

const PAGE_PATH = /^\/(?:ja|en)\/(ax-migration|ax-diagnosis)(?:\/([^/]+)(?:\/([^/]+))?)?\/?$/;

/** The page of a path ("/ja/ax-migration/access"), or null for any other path */
export function axPageOf(pathname: string): AxPageMatch | null {
  const match = PAGE_PATH.exec(pathname);
  if (!match) return null;
  const [, root, first, second] = match;
  if (root === 'ax-diagnosis') return first === undefined ? { page: 'ax-diagnosis' } : null;
  if (first === undefined) return { page: 'ax-lp' };
  if (first === 'access') return second === undefined ? { page: 'ax-access-lp' } : null;
  if (first === 'column') {
    return second === undefined
      ? { page: 'ax-column-index' }
      : { page: 'ax-column', columnSlug: second };
  }
  return null;
}

/** Pages a link in the text of a column counts as a move between pages for (not other columns) */
const LANDING_PAGES: ReadonlySet<AxPage> = new Set(['ax-lp', 'ax-access-lp', 'ax-diagnosis']);

/** A site path to a landing page or the diagnosis ("/ja/ax-migration/access#diagnosis") */
export function isLandingHref(href: string): boolean {
  if (!href.startsWith('/') || href.startsWith('//')) return false;
  const target = axPageOf(href.split(/[?#]/, 1)[0]);
  return target !== null && LANDING_PAGES.has(target.page);
}

/** Parameters of the current address a link to another page carries, besides the utm_* */
const CARRIED_PARAMS: ReadonlySet<string> = new Set(['ref', 'agency']);

/**
 * Address of a link that leads to another page of the site: `from` names where it was followed,
 * and the utm_*, ref and agency of the current address that the link does not set itself are
 * carried over.
 * A `from` outside the list is left out; the link still works.
 */
export function crossLinkHref(href: string, from: string, currentSearch: string): string {
  const url = new URL(href, 'https://ax.invalid');
  const current = new URLSearchParams(currentSearch);
  for (const [key, value] of current) {
    const carried = key.startsWith('utm_') || CARRIED_PARAMS.has(key);
    if (carried && !url.searchParams.has(key)) url.searchParams.set(key, value);
  }
  if (isAxFrom(from)) url.searchParams.set('from', from);
  return `${url.pathname}${url.search}${url.hash}`;
}
