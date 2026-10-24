/**
 * The CSP nonce of the page, for libraries that add <style> elements in the browser (#317).
 *
 * The proxy (proxy.ts) sends each page with a fresh nonce in its policy (style-src 'nonce-…'),
 * and Next.js puts that nonce on the page's own scripts. A <style> element added later runs only
 * with the same nonce, so it is read from those scripts: a later request of the app router
 * (router.refresh(), moving to another layout) goes through the proxy again and gets a new
 * nonce, which the policy of the page already open does not allow.
 *
 * Undefined on the server and wherever the policy has no nonce (the dev server's policy allows
 * inline styles).
 */
export function documentCspNonce(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const script = document.querySelector<HTMLScriptElement>('script[nonce]');
  // Browsers empty the attribute once the policy applies (nonce hiding); the property keeps it
  return script?.nonce || script?.getAttribute('nonce') || undefined;
}

declare global {
  /** The nonce get-nonce falls back to (react-style-singleton reads it through get-nonce) */
  var __webpack_nonce__: string | undefined;
}

/**
 * Lets Radix's scroll lock add its <style> element under the CSP. Dialog, Sheet, AlertDialog,
 * Select, DropdownMenu and modal Popover lock the page's scroll with react-remove-scroll, whose
 * <style> takes its nonce from get-nonce: the value given to get-nonce's setNonce or, without
 * one, the global __webpack_nonce__. The global is set here: get-nonce is not a direct
 * dependency of the app, the global reaches every copy of it, and Turbopack leaves the name as a
 * plain global in the bundle. test/e2e/csp.spec.ts opens a dialog and a select against the
 * production build, so a bundler that stops reading it shows up there.
 */
export function shareCspNonceWithScrollLock(): void {
  const nonce = documentCspNonce();
  if (nonce) globalThis.__webpack_nonce__ = nonce;
}
