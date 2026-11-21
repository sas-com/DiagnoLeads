import { ARRIVAL_PATH } from '@/lib/routes/home';

/**
 * The path to open after signing in or signing up. Only paths on this site are followed, so a
 * crafted link cannot send people to another site. The value is resolved the way the browser
 * will resolve it (tabs and line breaks dropped, backslashes read as slashes) before checking.
 *
 * Without a path to go back to, or with one that is refused, people land in the AI office
 * (#1153): a fixed path of this app, never one made from the value.
 */
export function safeCallbackPath(
  value: string | null | undefined,
  fallback: string = ARRIVAL_PATH
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
