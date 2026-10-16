import { defaultLocale, locales } from '@/lib/i18n/config';
import { ADMIN_PAGE_PREFIXES } from '@/lib/routes/admin-pages';
import { getSessionCookie } from 'better-auth/cookies';

const LOCALE_PREFIX = new RegExp(`^/(${locales.join('|')})(?=/|$)`, 'i');

export function isProtectedPage(pathWithoutLocale: string): boolean {
  const path = pathWithoutLocale.toLowerCase();
  return ADMIN_PAGE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    // Judge a malformed escape as it is: "/ja/dashboard/%E0" is still under the dashboard
    return path;
  }
}

/**
 * Admin pages: opening one without a sign-in cookie goes to the sign-in page. This only spares
 * signed-out visitors an empty admin shell; the data itself stays protected by each API
 * (protectedProcedure / organizationProcedure), which checks the session for real, and the
 * admin layout sends visitors whose session is no longer valid to sign-in (AdminSessionGuard).
 *
 * Returns the sign-in URL for a signed-out visitor of an admin page; null otherwise.
 */
export function signInRedirect(request: Request): URL | null {
  const { pathname, search } = new URL(request.url);
  // Judge the path the router will serve, as a whole: "/%6Aa/dash%62oard" is "/ja/dashboard"
  const decoded = decodePath(pathname);
  const locale = LOCALE_PREFIX.exec(decoded)?.[1]?.toLowerCase();
  const rest = locale ? decoded.slice(locale.length + 1) : decoded;
  if (!isProtectedPage(rest) || getSessionCookie(request)) return null;

  const url = new URL(`/${locale ?? defaultLocale}/login`, request.url);
  url.searchParams.set('callbackUrl', `${pathname}${search}`);
  return url;
}
