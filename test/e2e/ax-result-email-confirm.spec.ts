import { expect, test } from '@playwright/test';

/**
 * E2E Test: the confirm page of the AX result by email (#154) is public, kept out of search
 * engines, sends no Referer, takes the token off the address bar and changes nothing until one
 * of its buttons is pressed.
 */
test.describe('Result email confirm page', () => {
  const token = 'AbC-_123456789012345678901234567890123456789';

  test('opens without sign-in, noindex, and shows both buttons without posting @smoke', async ({
    page,
  }) => {
    const posts: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/result-email')) {
        posts.push(request.url());
      }
    });

    const response = await page.goto(`/ja/ax-diagnosis/email/confirm#t=${token}`);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/ja\/ax-diagnosis\/email\/confirm/);
    await expect(
      page.getByRole('heading', { level: 1, name: '診断結果の送付の確定' })
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '診断結果を受け取る' })).toBeVisible();
    await expect(page.getByRole('button', { name: '心当たりがない・受け取らない' })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
    // The token leaves the address bar once read
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('');
    await page.waitForLoadState('networkidle');
    expect(posts).toEqual([]);
  });

  test('explains an incomplete link without buttons @smoke', async ({ page }) => {
    await page.goto('/ja/ax-diagnosis/email/confirm');
    await expect(page.getByTestId('ax-result-email-confirm').getByRole('alert')).toContainText(
      'リンクが途中で切れています'
    );
    await expect(page.getByRole('button', { name: '診断結果を受け取る' })).toHaveCount(0);
  });
});
