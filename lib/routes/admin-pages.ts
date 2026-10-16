/**
 * First path segment (after the language) of every admin page: the page folders of
 * app/[locale]/(dashboard) (checked by a unit test). Signed-out visitors are sent to sign-in
 * (lib/middleware/auth-redirect.ts) and crawlers are kept out (app/robots.ts).
 */
export const ADMIN_PAGE_PREFIXES = [
  '/dashboard',
  '/leads',
  '/analytics',
  '/settings',
  '/organizations',
  '/content',
] as const;
