import type { Page } from '@playwright/test';

/**
 * E2E test authentication helper
 *
 * The users and organization below are created by scripts/e2e-seed.ts (bun run test:e2e:seed).
 * Each user belongs to that one organization, so the app selects it after sign-in.
 */

export interface TestUser {
  email: string;
  password: string;
  name: string;
  organizationId?: string;
}

const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD || 'e2e-test-pw';

export const E2E_ORGANIZATION = {
  id: '00000000-0000-4000-8000-0000000000e2',
  name: 'E2E Organization',
  slug: 'e2e-org',
} as const;

export const TEST_USERS = {
  owner: {
    email: 'test-owner@example.com',
    password: TEST_PASSWORD,
    name: 'Test Owner',
    organizationId: E2E_ORGANIZATION.id,
  },
  admin: {
    email: 'test-admin@example.com',
    password: TEST_PASSWORD,
    name: 'Test Admin',
    organizationId: E2E_ORGANIZATION.id,
  },
  member: {
    email: 'test-member@example.com',
    password: TEST_PASSWORD,
    name: 'Test Member',
    organizationId: E2E_ORGANIZATION.id,
  },
} as const;

/**
 * Navigate to login page and authenticate
 */
export async function login(page: Page, user: TestUser): Promise<void> {
  await page.goto('/login');

  // Fill in login form
  await page.fill('input[name="email"]', user.email);
  await page.fill('input[name="password"]', user.password);

  // Submit form
  await page.click('button[type="submit"]');

  // Wait for navigation to dashboard
  await page.waitForURL(/\/dashboard/);
}

/**
 * Logout from the application
 */
export async function logout(page: Page): Promise<void> {
  // Click user menu
  await page.click('[data-testid="user-menu"]');

  // Click logout button
  await page.click('[data-testid="logout-button"]');

  // Wait for navigation to sign-in page
  await page.waitForURL(/\/login/);
}

/**
 * Navigate to a specific organization's dashboard
 */
export async function switchOrganization(page: Page, organizationSlug: string): Promise<void> {
  // Click organization switcher
  await page.click('[data-testid="organization-switcher"]');

  // Select organization
  await page.click(`[data-testid="org-${organizationSlug}"]`);

  // Wait for navigation
  await page.waitForURL(`/dashboard/${organizationSlug}`);
}

/**
 * Setup authenticated test context
 * This should be called in beforeEach hooks
 */
export async function setupAuthenticatedTest(
  page: Page,
  user: TestUser = TEST_USERS.owner
): Promise<void> {
  // login() already waits for the dashboard of the user's only organization
  await login(page, user);
}
