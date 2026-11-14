/**
 * The office opens its full-screen view by itself for an address that carries a mark: the start
 * URL of the app, having just signed in (#1153), coming home by the logo (#1169). In that view
 * keys alone reach actions (E and a number pauses an AI employee, 5 and a number ticks off a next
 * action). A page of another site could open such an address in a new tab while it has the
 * visitor typing, and the rest of the typing would land in the office (#1175).
 *
 * So the mark only counts when it comes from this site or from the visitor: a navigation that
 * another site started (`Sec-Fetch-Site: cross-site`, which also holds through redirects) is
 * sent on to the same page without the mark, and the office opens in its normal view. Typing the
 * address, a bookmark and the installed app say `none`; moving within the app says
 * `same-origin`. A browser that does not send the header is treated as before.
 */
import { locales } from '@/lib/i18n/config';
import { ARRIVAL_PARAM, HOME_PATH } from '@/lib/routes/home';

const LOCALE_PREFIX = new RegExp(`^/(${locales.join('|')})(?=/|$)`, 'i');

/** The path the router will serve, without its language: "/%6Aa/Office/" is "/office" */
function servedPath(pathname: string): string {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // A malformed escape is judged as it is
  }
  const rest = decoded.replace(LOCALE_PREFIX, '').toLowerCase();
  return rest.replace(/\/+$/, '') || '/';
}

/**
 * Where to send a request for the office that another site started and that carries the mark:
 * the same address without it. Null for every other request.
 */
export function withoutForeignOfficeEntry(request: Request): URL | null {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  if (request.headers.get('sec-fetch-site')?.trim().toLowerCase() !== 'cross-site') return null;
  const url = new URL(request.url);
  if (!url.searchParams.has(ARRIVAL_PARAM)) return null;
  if (servedPath(url.pathname) !== HOME_PATH) return null;
  // Whatever the mark says: a new kind of mark is covered without a change here
  url.searchParams.delete(ARRIVAL_PARAM);
  return url;
}
