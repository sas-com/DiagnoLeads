import { type Page, expect, test } from '@playwright/test';
import ja from '../../locales/ja/common.json';
import {
  TEST_USERS,
  type TestUser,
  login,
  logout,
  submitAuthForm,
  uniqueClientAddress,
} from './helpers/auth';

/**
 * E2E Test: authentication (#23)
 *
 * Sign-up is invite-only: an account can be created only from an invitation link, with the link's
 * token and the invited address together (decision 2026-10-16-invite-only-signup). There is no
 * email verification yet. Every test here is @smoke, so CI runs them against the production
 * build; the details of each form (validation, loading state, error messages) are covered by the
 * unit tests in test/unit/components/auth/.
 *
 * The users come from scripts/e2e-seed.ts (test/e2e/helpers/auth.ts). Each test, and the
 * invited person's browser, comes from a client address of its own (uniqueClientAddress), so the
 * per-address limits on sign-in and session reads count each flow on its own.
 */

const auth = ja.settings.auth;
const members = ja.settings.members;

async function fillSignIn(page: Page, user: Pick<TestUser, 'email' | 'password'>) {
  await page.getByLabel(auth.login.emailLabel, { exact: true }).fill(user.email);
  await page.getByLabel(auth.login.passwordLabel, { exact: true }).fill(user.password);
}

test.describe('Authentication', () => {
  test.beforeEach(async ({ context }) => {
    await context.setExtraHTTPHeaders({ 'x-forwarded-for': uniqueClientAddress() });
  });

  test.describe('Sign-up by invitation', () => {
    test('should explain that sign-up is by invitation when opened without one @smoke', async ({
      page,
    }) => {
      await page.goto('/ja/signup');

      await expect(page.getByRole('heading', { name: '新規登録', exact: true })).toBeVisible();
      await expect(page.getByText(auth.signup.inviteOnlyTitle)).toBeVisible();
      // No form to fill in without an invitation
      await expect(page.locator('input[type="password"]')).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'ログイン', exact: true })).toBeVisible();
    });

    test('should register an invited person only with the invited address, then join @smoke', async ({
      page,
      browser,
      baseURL,
    }) => {
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const invited = `e2e-invitee-${suffix}@example.com`;
      const password = 'Invitee-pw-2026';

      // The owner invites the address from the members page; the dialog shows the link to pass on
      await login(page, TEST_USERS.owner);
      await page.goto('/ja/settings/members');
      await page.getByRole('button', { name: members.inviteButton, exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel(members.emailLabel, { exact: true }).fill(invited);
      await dialog.getByRole('button', { name: members.sendInvite }).click();
      const linkField = dialog.getByLabel(members.inviteLinkLabel, { exact: true });
      await expect(linkField).toHaveValue(/\/ja\/invite\//);
      const invitePath = new URL(await linkField.inputValue(), baseURL).pathname;

      // The invited person opens the link in a browser of their own, signed out
      const context = await browser.newContext({
        baseURL,
        extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() },
      });
      const invitee = await context.newPage();
      try {
        await invitee.goto(invitePath);
        await expect(invitee.getByRole('heading', { name: auth.invite.title })).toBeVisible();
        await expect(invitee.getByText(invited)).toBeVisible();
        await invitee.getByRole('link', { name: auth.invite.signUpToJoin }).click();
        await invitee.waitForURL(/\/ja\/signup\?/);

        // The invited address is filled in. Another address is refused, even with the link's token
        const email = invitee.getByLabel(auth.signup.emailLabel, { exact: true });
        await expect(email).toHaveValue(invited);
        await invitee.getByLabel(auth.signup.nameLabel, { exact: true }).fill('E2E Invitee');
        await email.fill(`e2e-uninvited-${suffix}@example.com`);
        await invitee.getByLabel(auth.signup.passwordLabel, { exact: true }).fill(password);
        await invitee.getByLabel(auth.signup.confirmPasswordLabel, { exact: true }).fill(password);
        const refused = await submitAuthForm(invitee, '/sign-up/email');
        expect(refused.status()).toBe(403);
        await expect(invitee.getByText(auth.signup.invitationRequired)).toBeVisible();

        // With the invited address the account is created and the invite page comes back
        await email.fill(invited);
        const created = await submitAuthForm(invitee, '/sign-up/email');
        expect(created.status()).toBe(200);
        await invitee.waitForURL((url) => url.pathname === invitePath);

        // Joining opens the dashboard, signed in as the new account
        await invitee.getByRole('button', { name: auth.invite.join, exact: true }).click();
        await invitee.waitForURL(/\/ja\/dashboard/);
        await expect(invitee.getByTestId('user-menu')).toContainText(invited);
      } finally {
        await context.close();
      }

      // The owner now finds the new account among the members
      await page.reload();
      await expect(page.getByText(invited)).toBeVisible();
    });

    test('should not accept an invitation link that is not valid @smoke', async ({ page }) => {
      await page.goto(`/ja/invite/${'x'.repeat(43)}`);

      await expect(page.getByRole('heading', { name: auth.invite.invalidTitle })).toBeVisible();
      await expect(page.getByRole('link', { name: auth.invite.signUpToJoin })).toHaveCount(0);
    });
  });

  test.describe('Sign-in', () => {
    test('should display login page correctly @smoke', async ({ page }) => {
      await page.goto('/ja/login');

      await expect(
        page.getByRole('heading', { name: auth.login.title, exact: true })
      ).toBeVisible();
      await expect(page.locator('input[name="email"]')).toBeVisible();
      await expect(page.locator('input[name="password"]')).toBeVisible();
      await expect(
        page.getByRole('button', { name: auth.login.submitButton, exact: true })
      ).toBeVisible();
      // Sign-up is by invitation, so the page says so instead of linking to it
      await expect(page.getByText(auth.login.inviteOnlyNote)).toBeVisible();
    });

    test('should refuse a wrong password @smoke', async ({ page }) => {
      await page.goto('/ja/login');
      await fillSignIn(page, { email: TEST_USERS.owner.email, password: 'Wrong-password-1' });

      const response = await submitAuthForm(page, '/sign-in/email');

      expect(response.status()).toBe(401);
      await expect(page.getByText(auth.login.invalidCredentials)).toBeVisible();
      await expect(page).toHaveURL(/\/ja\/login/);
    });
  });

  test.describe('Session', () => {
    test('should return to the requested page and keep the session across a reload @smoke', async ({
      page,
    }) => {
      // A signed-out visitor of an admin page signs in and lands on that page
      await page.goto('/ja/leads');
      await page.waitForURL(/\/ja\/login\?/);
      await fillSignIn(page, TEST_USERS.admin);
      await submitAuthForm(page, '/sign-in/email');
      await page.waitForURL((url) => url.pathname === '/ja/leads');

      await page.reload();

      await expect(page).toHaveURL(/\/ja\/leads$/);
      await expect(page.getByTestId('user-menu')).toContainText(TEST_USERS.admin.email);
    });

    test('should sign out from the user menu @smoke', async ({ page }) => {
      await login(page, TEST_USERS.member);

      await logout(page);

      // The admin pages send the visitor to sign-in again
      await page.goto('/ja/dashboard');
      await page.waitForURL(/\/ja\/login/);
    });
  });

  test.describe('Protected Routes', () => {
    // Smoke: checks that the root proxy (proxy.ts) still sends signed-out visitors to sign-in,
    // including an encoded path that once slipped past the check (#166)
    test('should redirect unauthenticated users to login @smoke', async ({ page }) => {
      // Clear any existing session
      await page.context().clearCookies();

      // Try to access protected route
      await page.goto('/dashboard');

      // Should redirect to login
      await page.waitForURL(/\/(sign-in|login)/);

      // The server answers the redirect itself (AdminSessionGuard on the page would redirect too,
      // which would hide a proxy that no longer runs)
      for (const path of ['/ja/dashboard', '/ja/dash%62oard']) {
        const response = await page.request.get(path, { maxRedirects: 0 });
        expect(response.status()).toBe(307);
        expect(response.headers().location).toContain('/ja/login');
      }
    });
  });

  test.describe('Password reset', () => {
    test('should accept a reset request from the login page @smoke', async ({ page }) => {
      await page.goto('/ja/login');
      await page.getByRole('link', { name: auth.login.forgotPassword }).click();
      await page.waitForURL(/\/reset-password$/);
      await page
        .getByLabel(auth.resetPassword.emailLabel, { exact: true })
        .fill(TEST_USERS.owner.email);

      // The page reports success whatever the server answered (it must not reveal whether the
      // address is registered), so the answer is checked as well
      const [response] = await Promise.all([
        page.waitForResponse(
          (r) => new URL(r.url()).pathname === '/api/auth/request-password-reset'
        ),
        page.getByRole('button', { name: auth.resetPassword.submitButton }).click(),
      ]);

      expect(response.status()).toBe(200);
      await expect(page.getByText(auth.resetPassword.successMessage)).toBeVisible();
    });

    test('should refuse a reset link that is not valid @smoke', async ({ page }) => {
      const newPassword = 'New-passw0rd';
      await page.goto('/ja/reset-password/confirm?token=not-a-valid-token');
      await page
        .getByLabel(auth.resetPasswordConfirm.newPasswordLabel, { exact: true })
        .fill(newPassword);
      await page
        .getByLabel(auth.resetPasswordConfirm.confirmPasswordLabel, { exact: true })
        .fill(newPassword);

      await page.getByRole('button', { name: auth.resetPasswordConfirm.submitButton }).click();

      await expect(page.getByText(auth.resetPasswordConfirm.invalidToken)).toBeVisible();
      await expect(
        page.getByRole('link', { name: auth.resetPasswordConfirm.requestNewLink })
      ).toBeVisible();
    });
  });
});
