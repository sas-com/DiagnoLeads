import { describe, expect, it } from 'vitest';

/**
 * sonner adds its styles in a <style> tag without the CSP nonce when it is loaded, which the
 * production CSP refuses (#213). patches/sonner@1.7.0.patch turns that off; the styles come from
 * sonner/dist/styles.css in app/globals.css. This fails if an upgrade drops the patch: sonner is
 * pinned in package.json; to upgrade it, make the patch again for the new version.
 */
describe('sonner style patch (#213)', () => {
  it('adds no <style> element when sonner is loaded', async () => {
    const before = document.head.querySelectorAll('style').length;
    await import('sonner');
    expect(document.head.querySelectorAll('style')).toHaveLength(before);
  });
});
