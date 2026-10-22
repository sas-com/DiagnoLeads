import { expect, test } from '@playwright/test';

/**
 * E2E Test: the unsubscribe page of the respondent mail (#154) is public, kept out of search
 * engines, sends no Referer, and changes nothing until its button is pressed.
 */
test.describe('Unsubscribe page', () => {
  const token = 'AbC-_123456789012345678901234567890123456789';

  test('opens without sign-in, noindex, and shows one button @smoke', async ({ page }) => {
    const posts: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/api/email/unsubscribe')) {
        posts.push(request.url());
      }
    });

    const response = await page.goto(`/ja/email/unsubscribe#t=${token}`);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/ja\/email\/unsubscribe/);
    await expect(page.getByRole('heading', { level: 1, name: 'メール配信の停止' })).toBeVisible();
    await expect(page.getByRole('button', { name: '配信を停止する' })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
    // The token leaves the address bar once read
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('');
    await page.waitForLoadState('networkidle');
    expect(posts).toEqual([]);
  });

  test('explains an incomplete link without a button @smoke', async ({ page }) => {
    await page.goto('/ja/email/unsubscribe');
    await expect(page.getByTestId('email-unsubscribe').getByRole('alert')).toContainText('リンクが途中で切れています');
    await expect(page.getByRole('button', { name: '配信を停止する' })).toHaveCount(0);
  });
});
