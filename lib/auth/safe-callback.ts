/**
 * The path to open after signing in or signing up. Only paths on this site are followed, so a
 * crafted link cannot send people to another site.
 */
export function safeCallbackPath(
  value: string | null | undefined,
  fallback = '/dashboard'
): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return fallback;
  }
  return value;
}
