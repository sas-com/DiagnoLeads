import { expect, test } from '@playwright/test';
import { answerAs400, canSubmit, fillContact, submit } from './helpers/ax-diagnosis';

/**
 * E2E Test: AX migration landing page (/ax-migration) with the diagnosis embedded
 */
test.describe('AX migration landing page', () => {
  test('shows the sections and is hidden from search engines @smoke', async ({ page }) => {
    await page.goto('/ja/ax-migration');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      '今の基幹システムのまま、AI時代の経営判断はできますか？'
    );
    for (const name of [
      'こんなお悩みありませんか？',
      'ヒト・モノ・カネ・情報。すべてが、レガシーな基幹システムに縛られています',
      'システム移行はゴールではなく、AX化の出発点',
      '対象となるシステム',
      'まずは「無料Web診断」から',
      '選ばれる理由',
      'よくある質問',
    ]) {
      await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
    }
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page).toHaveTitle(/AXマイグレーション/);
  });

  test('takes the hero button to the embedded diagnosis', async ({ page }) => {
    await page.goto('/ja/ax-migration');
    await page.getByRole('link', { name: /無料Web診断をはじめる/ }).first().click();
    await expect(page).toHaveURL(/#diagnosis$/);
    await expect(page.locator('#diagnosis').getByTestId('platform-as400')).toBeInViewport();
  });

  test('completes the diagnosis inside the landing page @smoke', async ({ page }) => {
    test.skip(!canSubmit, 'AX_DIAGNOSIS_ORGANIZATION_ID is not set');
    await page.goto('/ja/ax-migration?utm_source=lp&utm_medium=email');
    // Through the hero button: the browser adds a #diagnosis entry the router does not know
    await page.getByRole('link', { name: /無料Web診断をはじめる/ }).first().click();
    await answerAs400(page);
    await fillContact(page, `e2e-ax-lp-${Date.now()}@example.com`);
    await submit(page);
    await expect(page.locator('#diagnosis').getByRole('heading', { name: '診断結果' })).toBeVisible();
    // Still the result (no reload) once the step entries have been rewound
    await page.waitForTimeout(500);
    await expect(page.locator('#diagnosis').getByRole('heading', { name: '診断結果' })).toBeVisible();

    // The result replaces the page (#280): one h1, from the top, without the other sections
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('診断結果');
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
    await expect(page.locator('#ax-hero-heading')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '選ばれる理由' })).toHaveCount(0);
    await expect(page.locator('#faq')).toHaveCount(0);
    await expect(page.locator('#ax-diagnosis-heading')).toHaveCount(0);
    await expect(page.getByTestId('ax-floating-cta')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

    // Printed, only the result
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('#diagnosis').getByRole('heading', { name: '診断結果' })).toBeVisible();
    await page.emulateMedia({ media: 'screen' });

    // Diagnosing another system brings the page back, at the diagnosis
    await page.getByRole('button', { name: '別のシステムも診断する' }).click();
    await expect(page.locator('#ax-hero-heading')).toHaveCount(1);
    await expect(page.locator('#diagnosis').getByTestId('platform-as400')).toBeInViewport();
  });

  test('brings the page back for a header link while the result is shown', async ({ page }) => {
    test.skip(!canSubmit, 'AX_DIAGNOSIS_ORGANIZATION_ID is not set');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/ja/ax-migration#diagnosis');
    await answerAs400(page);
    await fillContact(page, `e2e-ax-lp-nav-${Date.now()}@example.com`);
    await submit(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('診断結果');

    await page.getByRole('navigation', { name: 'ページ内のメニュー' }).getByRole('link', { name: 'よくある質問' }).click();
    await expect(page.locator('#faq')).toBeInViewport();
    await expect(page).toHaveURL(/#faq$/);
    // The result stays in the diagnosis section, below the page title
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.locator('#diagnosis').getByRole('heading', { level: 3, name: '診断結果' })).toBeAttached();
  });

  test('keeps the diagnosis one tap away on phones', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto('/ja/ax-migration');
    const bar = page.getByTestId('ax-floating-cta');
    await expect(bar).toHaveAttribute('aria-hidden', 'true');
    await page.getByRole('heading', { name: 'システム移行はゴールではなく、AX化の出発点' }).scrollIntoViewIfNeeded();
    await expect(bar).toHaveAttribute('aria-hidden', 'false');
    await page.locator('#diagnosis').scrollIntoViewIfNeeded();
    await expect(bar).toHaveAttribute('aria-hidden', 'true');
    await context.close();
  });
});
