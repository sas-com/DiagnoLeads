/**
 * The page's CSP nonce in the browser, for libraries that add <style> elements (#317).
 */
import { documentCspNonce, shareCspNonceWithScrollLock } from '@/lib/csp/document-nonce';
import { afterEach, describe, expect, it } from 'vitest';

/** A script of the page as Next.js renders it under the production policy */
function addNoncedScript(nonce: string) {
  const script = document.createElement('script');
  script.setAttribute('nonce', nonce);
  document.head.appendChild(script);
}

afterEach(() => {
  for (const script of document.querySelectorAll('script')) script.remove();
  globalThis.__webpack_nonce__ = undefined;
});

describe('documentCspNonce', () => {
  it('reads the nonce of the page’s own scripts', () => {
    addNoncedScript('abc123');
    expect(documentCspNonce()).toBe('abc123');
  });

  it('is undefined where the policy has no nonce (the dev server)', () => {
    document.head.appendChild(document.createElement('script'));
    expect(documentCspNonce()).toBeUndefined();
  });
});

describe('shareCspNonceWithScrollLock', () => {
  it('gives the nonce to get-nonce, which Radix’s scroll lock reads', () => {
    addNoncedScript('abc123');
    shareCspNonceWithScrollLock();
    expect(globalThis.__webpack_nonce__).toBe('abc123');
  });

  it('leaves the global alone without a nonce', () => {
    shareCspNonceWithScrollLock();
    expect(globalThis.__webpack_nonce__).toBeUndefined();
  });
});
