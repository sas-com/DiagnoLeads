/** Sign-in page for a visitor of `path` (pathname and query), coming back there afterwards */
export function signInPath(locale: string, path: string): string {
  return `/${locale}/login?callbackUrl=${encodeURIComponent(path)}`;
}
