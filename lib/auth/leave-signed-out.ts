import { forgetStoredOrganization } from '@/lib/context/organization-context';

/**
 * Opens `to` as a new page once this browser is signed out (#1057). The page holds what the
 * account read (the query cache, in memory) and the organization it chose (localStorage), which
 * the next one to sign in on this browser must not see: the organization chosen is dropped, and a
 * new page starts without the cache. `replace` keeps the page left out of the history.
 */
export function leaveSignedOut(to: string, { replace = false }: { replace?: boolean } = {}): void {
  forgetStoredOrganization();
  if (replace) window.location.replace(to);
  else window.location.assign(to);
}
