import { expect, test } from '@playwright/test';

test.describe('Homepage', () => {
  test('should display the homepage correctly @smoke', async ({ page }) => {
    await page.goto('/');

    // The landing page renders its hero heading and a sign-in link (copy changes, so no text match)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: /ログイン|Sign In|Log In/i }).first()).toBeVisible();
  });

  test('should have proper meta tags', async ({ page }) => {
    await page.goto('/');

    // Check title
    await expect(page).toHaveTitle(/DiagnoLeads v2/i);
  });
});
