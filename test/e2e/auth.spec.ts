import { type Page, type Response, expect, test } from '@playwright/test';
import ja from '../../locales/ja/common.json';
import {
  TEST_USERS,
  type TestUser,
  login,
  logout,
  submitAuthForm,
  uniqueClientAddress,
} from './helpers/auth';
import { connectE2EDatabase, localDatabaseUrl } from './helpers/database';

/**
 * E2E Test: authentication (#23)
 *
 * Sign-up is invite-only: an account can be created only from an invitation link, with the link's
 * token and the invited address together (decision 2026-10-16-invite-only-signup). There is no
 * email verification yet. Every test here is @smoke, so CI runs them against the production
 * build; the details of each form (validation, loading state, error messages) are covered by the
 * unit tests in test/unit/components/auth/.
 *
 * The users come from scripts/e2e-seed.ts (test/e2e/helpers/auth.ts); the password reset test
 * makes an account of its own in the database (test/e2e/helpers/database.ts), so the seeded
 * passwords stay as they are. Each test, and each other browser or request in it, comes from a
 * client address of its own (uniqueClientAddress), so the per-address limits on sign-in, sign-up,
 * reset requests and session reads count each flow on its own.
 */

const auth = ja.settings.auth;
const members = ja.settings.members;

async function fillSignIn(page: Page, user: Pick<TestUser, 'email' | 'password'>) {
  await page.getByLabel(auth.login.emailLabel, { exact: true }).fill(user.email);
  await page.getByLabel(auth.login.passwordLabel, { exact: true }).fill(user.password);
}

/** Fill in the sign-up form except the address, which the invitation link fills in */
async function fillSignUp(page: Page, name: string, password: string) {
  await page.getByLabel(auth.signup.nameLabel, { exact: true }).fill(name);
  await page.getByLabel(auth.signup.passwordLabel, { exact: true }).fill(password);
  await page.getByLabel(auth.signup.confirmPasswordLabel, { exact: true }).fill(password);
}

/**
 * Ask for a reset link from the login page, as someone who forgot the password does, and return
 * better-auth's answer. The page reports success whatever the server answered (it must not reveal
 * whether the address is registered), so callers check the answer as well
 */
async function requestPasswordReset(page: Page, email: string): Promise<Response> {
  await page.goto('/ja/login');
  await page.getByRole('link', { name: auth.login.forgotPassword }).click();
  await page.waitForURL(/\/reset-password$/);
  await page.getByLabel(auth.resetPassword.emailLabel, { exact: true }).fill(email);
  const [response] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === '/api/auth/request-password-reset'),
    page.getByRole('button', { name: auth.resetPassword.submitButton }).click(),
  ]);
  await expect(page.getByText(auth.resetPassword.successMessage)).toBeVisible();
  return response;
}

/**
 * What one procedure returned in a response of the app's tRPC client (httpBatchLink with
 * superjson: an array with an entry for each procedure named in the path, in that order)
 */
async function trpcData(response: Response, procedure: string): Promise<unknown> {
  const { pathname } = new URL(response.url());
  const procedures = decodeURIComponent(pathname.replace('/api/trpc/', '')).split(',');
  const entries = (await response.json()) as { result?: { data?: { json?: unknown } } }[];
  return entries[procedures.indexOf(procedure)]?.result?.data?.json;
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

      // The owner invites the address from the members page; the dialog shows the link to pass on.
      // The owner loads three admin pages (the dashboard after sign-in, the members page and its
      // reload at the end), each reading the session once: 3 of the 5 session reads a minute that
      // the proxy allows an address (#519). One more read per page would fail this test with 429
      // at times, so keep that in mind when adding page loads here before #519 is fixed
      await login(page, TEST_USERS.owner);
      await page.goto('/ja/settings/members');
      await page.getByRole('button', { name: members.inviteButton, exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel(members.emailLabel, { exact: true }).fill(invited);
      await dialog.getByRole('button', { name: members.sendInvite }).click();
      const linkField = dialog.getByLabel(members.inviteLinkLabel, { exact: true });
      await expect(linkField).toHaveValue(/\/ja\/invite\//);
      const invitePath = new URL(await linkField.inputValue(), baseURL).pathname;

      // The invited address with a token other than the link's is refused. From a browser of its
      // own, so that the sign-ups below keep their allowance (3 a minute for an address)
      const stranger = await browser.newContext({
        baseURL,
        extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() },
      });
      try {
        const forged = await stranger.newPage();
        const query = new URLSearchParams({ email: invited, invitation: 'x'.repeat(43) });
        await forged.goto(`/ja/signup?${query}`);
        await expect(forged.getByLabel(auth.signup.emailLabel, { exact: true })).toHaveValue(
          invited
        );
        await fillSignUp(forged, 'E2E Stranger', password);
        const refused = await submitAuthForm(forged, '/sign-up/email');
        expect(refused.status()).toBe(403);
        await expect(forged.getByText(auth.signup.invitationRequired)).toBeVisible();
      } finally {
        await stranger.close();
      }

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
        await fillSignUp(invitee, 'E2E Invitee', password);
        await email.fill(`e2e-uninvited-${suffix}@example.com`);
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

      // The owner now finds the new account in the member list, and the invitation is no longer
      // pending. The pending invitations show the address too, so each list is checked on its own:
      // the member list by its "joined" column, the pending ones in what the server sent the page
      const pending = page.waitForResponse((r) =>
        new URL(r.url()).pathname.includes('members.listInvitations')
      );
      await page.reload();
      const memberList = page.getByRole('table').filter({
        has: page.getByRole('columnheader', { name: members.tableHeaderJoinedAt, exact: true }),
      });
      const newMember = memberList.getByRole('row').filter({ hasText: invited });
      await expect(newMember).toContainText('E2E Invitee');
      await expect(newMember).toContainText(members.roleMember);
      const invitations = (await trpcData(await pending, 'members.listInvitations')) as {
        email: string;
      }[];
      expect(invitations.map((invitation) => invitation.email)).not.toContain(invited);
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

    test('should refuse a wrong password alike for a registered and an unknown address @smoke', async ({
      page,
    }) => {
      // The answer must not tell whether the address has an account
      const answers: unknown[] = [];
      for (const email of [TEST_USERS.owner.email, `e2e-unknown-${Date.now()}@example.com`]) {
        await page.goto('/ja/login');
        await fillSignIn(page, { email, password: 'Wrong-password-1' });

        const response = await submitAuthForm(page, '/sign-in/email');

        expect(response.status()).toBe(401);
        answers.push(await response.json());
        await expect(page.getByText(auth.login.invalidCredentials)).toBeVisible();
        await expect(page).toHaveURL(/\/ja\/login/);
      }
      expect(answers[1]).toEqual(answers[0]);
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

    test('should sign out from the user menu and end the session on the server @smoke', async ({
      page,
      request,
    }) => {
      await login(page, TEST_USERS.member);
      const cookies = await page.context().cookies();
      if (!cookies.some((cookie) => cookie.name.endsWith('.session_token'))) {
        throw new Error('No session cookie after sign-in');
      }

      // Every cookie the browser holds, sent from outside the browser as someone who copied them
      // would. The proxy only looks for a session cookie, so the pages alone would not show
      // whether sign-out ended the session; the server must look it up in the database on each
      // read (no session cache in a cookie, #578)
      const copied = {
        cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; '),
        'x-forwarded-for': uniqueClientAddress(),
      };
      const signedInAs = async () => {
        const response = await request.get('/api/auth/get-session', { headers: copied });
        expect(response.status()).toBe(200);
        const session = (await response.json()) as { user: { email: string } } | null;
        return session?.user.email ?? null;
      };
      // A protected tRPC procedure (signed in, no organization) that only reads
      const trpcStatus = async () => {
        const response = await request.get('/api/trpc/account.soleOwnedOrganizations', {
          headers: copied,
        });
        return response.status();
      };
      expect(await signedInAs()).toBe(TEST_USERS.member.email);
      expect(await trpcStatus()).toBe(200);

      await logout(page);

      // The admin pages send the visitor to sign-in again
      await page.goto('/ja/dashboard');
      await page.waitForURL(/\/ja\/login/);
      // and the session itself has ended: the cookies kept from before sign no one in
      expect(await signedInAs()).toBeNull();
      expect(await trpcStatus()).toBe(401);
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
      const response = await requestPasswordReset(page, TEST_USERS.owner.email);

      expect(response.status()).toBe(200);
    });

    test('should set a new password from the emailed link and sign in with it only @smoke', async ({
      page,
      request,
    }) => {
      // The link reaches the person only by email, so the test reads its token from the database
      const databaseUrl = localDatabaseUrl();
      test.skip(
        !databaseUrl && !process.env.CI,
        'Needs DATABASE_URL of a database on this machine'
      );
      if (!databaseUrl) throw new Error('DATABASE_URL must name the E2E database on this machine');

      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const email = `e2e-reset-${suffix}@example.com`;
      const oldPassword = 'Old-passw0rd-2026';
      const newPassword = 'New-passw0rd-2026';
      // An account of its own: changing a seeded user's password would sign the other tests out
      const database = connectE2EDatabase(databaseUrl);
      let userId: string | undefined;
      try {
        userId = await database.createUser({ email, name: 'E2E Reset', password: oldPassword });

        // The old password signs in before the reset (asked from another address, outside the
        // browser, so the browser stays signed out and keeps its sign-in allowance)
        const before = await request.post('/api/auth/sign-in/email', {
          data: { email, password: oldPassword },
          headers: { 'x-forwarded-for': uniqueClientAddress() },
        });
        expect(before.status()).toBe(200);

        const requested = await requestPasswordReset(page, email);
        expect(requested.status()).toBe(200);

        // The link in the email, as better-auth builds it (the url given to sendResetPassword in
        // lib/auth/config.ts): its token and the page the form asked to come back to.
        // The test rebuilds the link from better-auth's own shape (1.7.14: the verification
        // identifier `reset-password:<token>`, the route `/reset-password/:token?callbackURL=`)
        // rather than reading the email, which CI does not send: a wrong url in the email would
        // not fail it (the database test of #592 checks that the email carries the token).
        // If better-auth changes that shape, e.g. stores the token hashed, this test fails even
        // though resets work, and needs to follow it
        const token = await database.passwordResetToken(userId);
        const { redirectTo } = requested.request().postDataJSON() as { redirectTo: string };
        const link = `/api/auth/reset-password/${token}?callbackURL=${encodeURIComponent(redirectTo)}`;

        // Opening it checks the token and leads to the form for the new password
        await page.goto(link);
        await page.waitForURL((url) => url.pathname === '/ja/reset-password/confirm');
        expect(new URL(page.url()).searchParams.get('token')).toBe(token);
        await expect(
          page.getByRole('heading', { name: auth.resetPasswordConfirm.title })
        ).toBeVisible();
        await page
          .getByLabel(auth.resetPasswordConfirm.newPasswordLabel, { exact: true })
          .fill(newPassword);
        await page
          .getByLabel(auth.resetPasswordConfirm.confirmPasswordLabel, { exact: true })
          .fill(newPassword);
        const [reset] = await Promise.all([
          page.waitForResponse(
            (r) =>
              r.request().method() === 'POST' &&
              new URL(r.url()).pathname === '/api/auth/reset-password'
          ),
          page.getByRole('button', { name: auth.resetPasswordConfirm.submitButton }).click(),
        ]);
        expect(reset.status()).toBe(200);
        await expect(page.getByText(auth.resetPasswordConfirm.successMessage)).toBeVisible();
        // and the page sends the person to sign in
        await page.waitForURL((url) => url.pathname === '/ja/login');

        // The link works once
        await page.goto(link);
        await expect(page.getByText(auth.resetPasswordConfirm.invalidToken)).toBeVisible();

        // The old password no longer signs in; the new one does
        await page.goto('/ja/login');
        await fillSignIn(page, { email, password: oldPassword });
        expect((await submitAuthForm(page, '/sign-in/email')).status()).toBe(401);
        await expect(page.getByText(auth.login.invalidCredentials)).toBeVisible();

        await fillSignIn(page, { email, password: newPassword });
        expect((await submitAuthForm(page, '/sign-in/email')).status()).toBe(200);
        await page.waitForURL(/\/ja\/dashboard/);
        await expect(page.getByTestId('user-menu')).toContainText(email);
      } finally {
        // Close the connection even when the clean-up fails
        try {
          if (userId) await database.deleteUser(userId);
        } finally {
          await database.close();
        }
      }
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
