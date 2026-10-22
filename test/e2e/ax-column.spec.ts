import { expect, test } from '@playwright/test';

/**
 * E2E Test: column pages of the AX migration site (#324)
 */
test.describe('AX migration columns', () => {
  const path = '/ja/ax-migration/column/access-office-support-end';

  test('shows the article, its structured data and the way to the diagnosis @smoke', async ({
    page,
  }) => {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Access 2016・2019・2021 のサポート終了：使い続けるとどうなり、何をすればよいか'
    );
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      new RegExp(`${path}$`)
    );
    const types = await page
      .locator('script[type="application/ld+json"]')
      .evaluateAll((scripts) => scripts.map((s) => JSON.parse(s.textContent ?? '')['@type']));
    expect(types).toEqual(['Article', 'BreadcrumbList']);

    // The contents lead to the headings
    await page.getByRole('navigation', { name: '目次' }).getByRole('link', { name: '出典' }).click();
    await expect(page).toHaveURL(/#sources$/);

    await page.getByRole('link', { name: '無料Web診断（Access版）をはじめる' }).click();
    await expect(page).toHaveURL(/\/ja\/ax-migration\/access#diagnosis$/);
  });

  test('lists the article and answers 404 for an unknown one', async ({ page }) => {
    await page.goto('/ja/ax-migration/column');
    await page
      .getByRole('link', { name: /Access 2016・2019・2021 のサポート終了/ })
      .click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));

    const missing = await page.goto('/ja/ax-migration/column/no-such-article');
    expect(missing?.status()).toBe(404);
  });
});
