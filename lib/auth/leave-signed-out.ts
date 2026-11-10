import { forgetStoredOrganization } from '@/lib/context/organization-context';

const ACCOUNT_DELETED_KEY = 'diagnoleads:account-deleted';

/** `to` as a URL of this site: the pages left signed out go to sign-in or stay on this one */
function urlOnThisSite(to: string): URL {
  const url = new URL(to, window.location.href);
  if (url.origin !== window.location.origin) throw new Error('Not a page of this site');
  return url;
}

/** Opens the URL as a new page, this one hidden and loaded again if the browser keeps it */
function leaveFor(url: URL, replace: boolean): void {
  // Shown again from the back-forward cache, the page left would show what it read: it is hidden
  // meanwhile, and loaded again instead, which sends a visitor without a session to sign-in
  document.documentElement.hidden = true;
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) window.location.reload();
  });
  if (replace) window.location.replace(url.href);
  else window.location.assign(url.href);
}

/**
 * Leaves this page for `to`, a page of this site, as a new page, once this browser has no session
 * (#1057): a new page starts without what this one read (the query cache, in memory), which the
 * next one to sign in here must not see. `replace` keeps this page out of the history.
 */
export function leaveWithoutSession(to: string, { replace = false }: { replace?: boolean } = {}) {
  leaveFor(urlOnThisSite(to), replace);
}

/**
 * Signed out on this browser: leaves as `leaveWithoutSession` does, and without the organization
 * chosen either, which the next one to sign in here must not start in (#1057)
 */
export function leaveSignedOut(to: string, { replace = false }: { replace?: boolean } = {}) {
  const url = urlOnThisSite(to);
  forgetStoredOrganization();
  leaveFor(url, replace);
}

/**
 * For the sign-in page to say, once, that the account was deleted: kept in this tab, so that a
 * link anyone can send does not say it (#1057)
 */
export function noteAccountDeleted(): void {
  try {
    sessionStorage.setItem(ACCOUNT_DELETED_KEY, '1');
  } catch {
    // Storage blocked: the sign-in page does not say it
  }
}

/** Whether this tab just deleted its account; true once */
export function takeAccountDeleted(): boolean {
  try {
    const noted = sessionStorage.getItem(ACCOUNT_DELETED_KEY) === '1';
    sessionStorage.removeItem(ACCOUNT_DELETED_KEY);
    return noted;
  } catch {
    return false;
  }
}
