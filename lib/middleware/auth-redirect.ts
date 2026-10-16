import { getSessionCookie } from 'better-auth/cookies';

/**
 * Admin pages: opening one without a sign-in cookie goes to the sign-in page. This only spares
 * signed-out visitors an empty admin shell; the data itself stays protected by each API
 * (protectedProcedure / organizationProcedure), which checks the session for real.
 */
export const PROTECTED_PAGE_PREFIXES = [
  '/dashboard',
  '/leads',
  '/analytics',
  '/settings',
  '/organizations',
  '/content',
] as const;

export function isProtectedPage(pathWithoutLocale: string): boolean {
  return PROTECTED_PAGE_PREFIXES.some(
    (prefix) => pathWithoutLocale === prefix || pathWithoutLocale.startsWith(`${prefix}/`)
  );
}

/** Sign-in URL for a signed-out visitor of an admin page; null when nothing should happen */
export function signInRedirect(
  request: Request,
  pathname: string,
  pathWithoutLocale: string,
  search = ''
): URL | null {
  if (!isProtectedPage(pathWithoutLocale) || getSessionCookie(request)) return null;
  const localePrefix = pathname.slice(0, pathname.length - pathWithoutLocale.length) || '/ja';
  const url = new URL(`${localePrefix}/login`, request.url);
  url.searchParams.set('callbackUrl', `${pathname}${search}`);
  return url;
}
