import { randomInt } from 'node:crypto';
import { type Page, type Response, expect } from '@playwright/test';

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
 * tests would use up each other's allowance (5 sign-ins and 3 sign-ups a minute in the proxy, 3 of
 * each per 10 seconds in better-auth) and fail at random.
 */
export function uniqueClientAddress(): string {
  return `10.${randomInt(256)}.${randomInt(256)}.${randomInt(256)}`;
}

/**
 * Submit the sign-in or sign-up form on the page and return better-auth's answer
 *
 * The forms report a refusal inside the form (role="alert"), not with a toast, so the form can
 * be sent right after the page loads: the toaster is loaded later and a toast raised before it
 * mounts is lost (#597)
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

  // Signing in leads to the AI office (#1153). The office drops the mark of having just come in
  // from the address once it read it, which is also when it opens its full-screen view
  await page.waitForURL(
    (url) => url.pathname.endsWith('/office') && !url.searchParams.has('source')
  );
}

/**
 * Leave the full-screen office that opens after signing in on a wide screen (#1153). It covers
 * the admin shell (the header, the user menu), so a test that uses the shell right after signing
 * in leaves it first, with Esc from its title, as a person would. A test that opens another page
 * with `page.goto` does not need this.
 */
export async function leaveFullScreenOffice(page: Page): Promise<void> {
  // Below 768px (OFFICE_MIN_WIDTH) the office does not open full screen: nothing to leave. CI
  // runs the desktop project only; the phone projects run on a developer's machine
  const width = page.viewportSize()?.width;
  if (width !== undefined && width < 768) return;
  const office = page.getByRole('dialog');
  await office.waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await office.waitFor({ state: 'hidden' });
}

/**
 * Logout from the application with the user menu in the header (components/header/UserDropdown.tsx)
 */
export async function logout(page: Page): Promise<void> {
  // Click user menu
  await page.click('[data-testid="user-menu"]');

  // Click logout button
  await page.click('[data-testid="logout-button"]');

  // Sign-out asks for the sign-in page, and the session guard of the admin pages
  // (components/auth/AdminSessionGuard.tsx) asks for it again, with the page to come back to,
  // when it hears of the ended session before the first request has answered: the first request
  // is then given up. waitForURL fails on a request given up while it waits, so the address is
  // read until it is the sign-in page, whichever request brought it (#1156)
  await expect(page).toHaveURL(/\/login/);
  await page.waitForLoadState('load');
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
  // login() already waits for the AI office of the user's only organization
  await login(page, user);
}
