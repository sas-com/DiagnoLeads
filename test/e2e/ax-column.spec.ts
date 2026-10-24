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

    // The title card (#335): decorative, loaded through the image optimizer under the CSP,
    // and shared with an absolute URL
    const thumbnail = page.locator('article header img');
    await expect(thumbnail).toHaveAttribute('alt', '');
    await expect
      .poll(() => thumbnail.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
      .toBeGreaterThan(0);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      'content',
      /^https?:\/\/.+\/images\/columns\/access-office-support-end\.png$/
    );
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
      'content',
      'summary_large_image'
    );

    // The contents lead to the headings
    await page.getByRole('navigation', { name: '目次' }).getByRole('link', { name: '出典' }).click();
    await expect(page).toHaveURL(/#sources$/);

    await page.getByRole('link', { name: '無料Web診断（Access版）をはじめる' }).click();
    // The move from the article is named on the address (#332)
    await expect(page).toHaveURL(/\/ja\/ax-migration\/access\?from=ax-column-end#diagnosis$/);
  });

  test('lists the article and answers 404 for an unknown one', async ({ page }) => {
    await page.goto('/ja/ax-migration/column');
    await page
      .getByRole('link', { name: /Access 2016・2019・2021 のサポート終了/ })
      .click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));

    // The whole card leads to the article (#344): its image and "read the article" too
    await page.goto('/ja/ax-migration/column');
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      'content',
      /^https?:\/\/.+\/images\/og\/ax-column-ja\.png$/
    );
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
      'content',
      'summary_large_image'
    );
    // The card of this article, wherever the list puts it (#372, #458): found by its link, not
    // by its place, so a new or reordered article leaves the test as it is
    const card = page.locator('li > article').filter({ has: page.locator(`a[href="${path}"]`) });
    await expect(card).toHaveCount(1);
    await expect(card.getByRole('link')).toHaveCount(1);
    // A click where the image or the text is shown lands on the stretched link above them
    for (const target of [card.locator('img'), card.getByText('記事を読む')]) {
      // The card may sit below the fold: the mouse clicks inside the viewport only
      await target.scrollIntoViewIfNeeded();
      const box = await target.boundingBox();
      if (!box) throw new Error('the card part is not shown');
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await page.goBack();
    }

    const missing = await page.goto('/ja/ax-migration/column/no-such-article');
    expect(missing?.status()).toBe(404);
  });
});
