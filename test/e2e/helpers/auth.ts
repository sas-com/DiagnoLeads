import { randomInt } from 'node:crypto';
import type { Page, Response } from '@playwright/test';

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
 * A client address of its own (sent as X-Forwarded-For) for a test, as each person has in
 * production. The proxy (lib/middleware/rate-limit.ts) and better-auth count sign-ins, sign-ups
 * and session reads per address, and every test runs on the same machine: on one shared address,
 * tests would use up each other's allowance (5 session reads a minute, #519) and fail at random.
 */
export function uniqueClientAddress(): string {
  return `10.${randomInt(256)}.${randomInt(256)}.${randomInt(256)}`;
}

/**
 * Submit the sign-in or sign-up form on the page and return better-auth's answer
 */
export async function submitAuthForm(
  page: Page,
  endpoint: '/sign-in/email' | '/sign-up/email'
): Promise<Response> {
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/api/auth${endpoint}`
    ),
    page.click('form button[type="submit"]'),
  ]);
  return response;
}

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
 * Logout from the application with the user menu in the header (components/header/UserDropdown.tsx)
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
