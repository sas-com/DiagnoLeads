import { type Page, type Response, expect, test } from '@playwright/test';
import { TEST_USERS, setupAuthenticatedTest } from './helpers/auth';

/**
 * E2E Test: no Content Security Policy violation on the public AX pages, on the login page,
 * which loads sonner (its runtime <style> is patched out, #213), and on admin screens whose
 * libraries add <style> elements while they run (ApexCharts, Radix's scroll lock and Select, #317),
 * and on the 3D floor of the AI office (three.js, #1150).
 * Meaningful against the production build (CI, E2E_USE_BUILD), which sends the strict CSP; the
 * dev server's policy is loose. A violation means something was blocked: a script, a style or a
 * request the page needs (#207, #211).
 */

/** Collects the CSP violations of the page from now on */
async function watchViolations(page: Page): Promise<string[]> {
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
  return violations;
}

/** No header means no violation either, so check that the proxy sent the strict policy */
function expectStrictPolicy(response: Response | null): void {
  if (!process.env.E2E_USE_BUILD) return;
  const policy = response?.headers()['content-security-policy'] ?? '';
  expect(policy).toContain("'nonce-");
  expect(policy).toContain("'strict-dynamic'");
}

// The 3D floor of the office needs WebGL, which a headless Chromium without a GPU gives only when
// told to draw in software (learning "ヘッドレスの Chromium で WebGL の画面と…"). The other pages
// of this file do not care
test.use({
  launchOptions: {
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  },
});

test.describe('Content Security Policy', () => {
  for (const path of [
    '/ja/ax-migration',
    '/en/ax-migration',
    '/ja/ax-migration/access',
    // Column pages carry JSON-LD: a data block, which the policy does not block (#324)
    '/ja/ax-migration/column',
    '/ja/ax-migration/column/access-office-support-end',
    '/ja/ax-migration/column/access-shared-folder',
    '/ja/ax-diagnosis',
    // Unsubscribe page of the respondent mail (#154)
    '/ja/email/unsubscribe',
    // Confirm page of the result by email (#154)
    '/ja/ax-diagnosis/email/confirm',
    '/ja/login',
  ]) {
    test(`${path} runs without a violation @smoke`, async ({ page }) => {
      const violations = await watchViolations(page);

      expectStrictPolicy(await page.goto(path));
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      // Let late scripts and styles (fonts, the diagnosis, lazy chunks) settle
      await page.waitForLoadState('networkidle');
      expect(violations).toEqual([]);
    });
  }
});

test.describe('Content Security Policy on the admin screens', () => {
  // One test signs in once: sign-in allows 5 attempts a minute from one address (rate-limit.ts),
  // which the smoke run shares with the other signed-in tests
  test('the 3D office, charts, a select and a dialog run without a violation @smoke', async ({ page }) => {
    await setupAuthenticatedTest(page, TEST_USERS.owner);
    const violations = await watchViolations(page);

    // Signing in opens the full-screen office, which starts on its 3D floor (#1150): three.js
    // and React Three Fiber are loaded then, and must run under the strict policy (no WASM, no
    // worker, no blob) and against the React that Next.js carries. Drawing in software is slow,
    // so the office may fall back to 2D some seconds later: only the first frames are checked
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    // Opened again, as someone who just came in: the page is loaded under watch this time, with
    // the strict policy, and no second sign-in is spent
    expectStrictPolicy(await page.goto('/ja/office?source=login'));
    const office = page.getByRole('dialog');
    await office.getByRole('button', { name: /^出社する/ }).click();
    await expect(office.locator('canvas')).toBeVisible({ timeout: 30 * 1000 });
    expect(errors).toEqual([]);
    expect(violations).toEqual([]);

    expectStrictPolicy(await page.goto('/ja/analytics'));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // ApexCharts adds its stylesheet when it draws the first chart
    await expect(page.locator('.apexcharts-canvas').first()).toBeVisible();
    // Radix Select adds two <style> elements while it is open: its viewport's and the scroll lock's
    // (the period select; the header's lead search is a combobox too)
    await page.getByRole('main').getByRole('combobox').first().click();
    await expect(page.getByRole('listbox')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toBeHidden();

    expectStrictPolicy(await page.goto('/ja/leads'));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // A modal dialog locks the page's scroll with a <style> element (react-remove-scroll)
    await page.getByRole('button', { name: '新規リード追加' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    await page.waitForLoadState('networkidle');
    expect(violations).toEqual([]);
  });
});
