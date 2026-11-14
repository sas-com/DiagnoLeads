/**
 * The office opens its full-screen view by itself for an address that carries a mark: the start
 * URL of the app, having just signed in (#1153), coming home by the logo (#1169). In that view
 * keys alone reach actions (E and a number pauses an AI employee, 5 and a number ticks off a next
 * action). A page of another site could open such an address in a new tab while it has the
 * visitor typing, and the rest of the typing would land in the office (#1175).
 *
 * So the mark only counts when it comes from this very site or from the visitor: moving within
 * the app says `Sec-Fetch-Site: same-origin`; typing the address, a bookmark and the installed
 * app say `none`. A request that anything else started (`cross-site`, which also holds through
 * redirects, and `same-site`: a sibling host has no reason to open the office) is sent on to
 * the same page without the mark, and the office opens in its normal view. A browser that does
 * not send the header is treated as before.
 */
import { locales } from '@/lib/i18n/config';
import { ARRIVAL_PARAM, HOME_PATH } from '@/lib/routes/home';

const LOCALE_PREFIX = new RegExp(`^/(${locales.join('|')})(?=/|$)`, 'i');

/** Who may open the office with a mark: this site itself, and the visitor */
const TRUSTED_SITES = new Set(['same-origin', 'none']);

/** The path the router will serve, without its language: "/%6Aa//Office/" is "/office" */
function servedPath(pathname: string): string {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // A malformed escape is judged as it is
  }
  // Doubled slashes and backslashes are folded before the page is served; judged too widely,
  // a mark is dropped that would not have opened anything
  const folded = decoded.replace(/[\\/]+/g, '/');
  const rest = folded.replace(LOCALE_PREFIX, '').toLowerCase();
  return rest.replace(/\/+$/, '') || '/';
}

/**
 * Where to send a request for the office that carries the mark and that neither this site nor
 * the visitor started: the same address without it. Null for every other request. Whatever the
 * method: a form of another site posted here goes on to the sign-in (its cookie is not sent),
 * and must not carry the mark there either.
 */
export function withoutForeignOfficeEntry(request: Request): URL | null {
  const site = request.headers.get('sec-fetch-site')?.trim().toLowerCase();
  if (!site || TRUSTED_SITES.has(site)) return null;
  const url = new URL(request.url);
  if (!url.searchParams.has(ARRIVAL_PARAM)) return null;
  if (servedPath(url.pathname) !== HOME_PATH) return null;
  // Whatever the mark says: a new kind of mark is covered without a change here
  url.searchParams.delete(ARRIVAL_PARAM);
  return url;
}
