import { expect, test } from '@playwright/test';
import { TEST_USERS, setupAuthenticatedTest } from './helpers/auth';

/**
 * E2E Test: the old dashboard address (#1164)
 *
 * The dashboard became part of 今日 and of the analytics page (decision
 * 2026-11-14-navigation-one-path). Old links and bookmarks land on 今日, which leads with what
 * the team acts on, and the side menu no longer offers the dashboard.
 */
test.describe('The old dashboard address', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuthenticatedTest(page, TEST_USERS.owner);
  });

  test('opens 今日, with the team’s waiting requests on top @smoke', async ({ page }) => {
    await page.goto('/ja/dashboard');

    await expect(page).toHaveURL(/\/ja\/today$/);
    await expect(page.getByRole('heading', { level: 1, name: '今日' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /連絡待ちの相談申込/ })).toBeVisible();
  });

  test('is no longer in the side menu', async ({ page }) => {
    await page.goto('/ja/today');

    const menu = page.getByRole('complementary');
    await expect(menu.getByRole('link', { name: '今日' })).toBeVisible();
    await expect(menu.getByRole('link', { name: 'ダッシュボード' })).toHaveCount(0);
  });
});
