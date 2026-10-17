import { expect, test } from '@playwright/test';

/**
 * E2E Test: no Content Security Policy violation on the public AX pages.
 * Meaningful against the production build (CI, E2E_USE_BUILD), which sends the strict CSP; the
 * dev server's policy is loose. A violation means something was blocked: a script, a style or a
 * request the page needs (#207, #211).
 */
test.describe('Content Security Policy', () => {
  for (const path of ['/ja/ax-migration', '/en/ax-migration', '/ja/ax-diagnosis']) {
    test(`${path} runs without a violation @smoke`, async ({ page }) => {
      const violations: string[] = [];
      page.on('console', (message) => {
        if (/Content Security Policy/.test(message.text())) violations.push(message.text());
      });
      await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (event) => {
          console.error(
            `Content Security Policy violation: ${event.violatedDirective} ${event.blockedURI}`
          );
        });
      });

      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      // Let late scripts and styles (fonts, the diagnosis, lazy chunks) settle
      await page.waitForLoadState('networkidle');
      expect(violations).toEqual([]);
    });
  }
});
