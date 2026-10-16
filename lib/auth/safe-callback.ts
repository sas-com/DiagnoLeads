/**
 * The path to open after signing in or signing up. Only paths on this site are followed, so a
 * crafted link cannot send people to another site. The value is resolved the way the browser
 * will resolve it (tabs and line breaks dropped, backslashes read as slashes) before checking.
 */
export function safeCallbackPath(
  value: string | null | undefined,
  fallback = '/dashboard'
): string {
  if (!value || !value.startsWith('/')) return fallback;
  const base = 'https://callback.invalid';
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    return fallback;
  }
  if (url.origin !== base || url.pathname.startsWith('//')) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
