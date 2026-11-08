import { db } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import { isAllowedEmail, testModeEmailMessage } from '@/lib/email/allowed-recipients';
import { env } from '@/lib/env';
import { isSignupInvited } from '@/lib/features/members/invitations';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import {
  detectLocaleFromHeaders,
  generatePasswordResetEmail,
  generateVerificationEmail,
  runAfterResponse,
  sendAuthEmail,
} from './email-helpers';
import { isLocalHttpUrl } from './local-url';
import { refusedVerificationRedirect, verificationTokenEmail } from './verify-email-guard';

function invitationRequired() {
  return new APIError('FORBIDDEN', {
    message: '新規登録は招待されたメールアドレスのみ可能です。招待リンクから登録してください',
    code: 'INVITATION_REQUIRED',
  });
}

/**
 * BetterAuth Configuration
 * Email and password authentication; organizations and invitations are handled by the app
 */
export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verification,
    },
  }),

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false, // Set to true in production
    minPasswordLength: 8,
    maxPasswordLength: 128,
    /**
     * Send password reset email
     * Called when user requests password reset via requestPasswordReset
     */
    sendResetPassword: async ({ user, url }, request) => {
      const locale = detectLocaleFromHeaders(request?.headers);
      const { subject, text, html } = generatePasswordResetEmail(user, url, locale);
      // Returned, not awaited here: better-auth hands it to advanced.backgroundTasks
      return sendAuthEmail({ to: user.email, subject, text, html });
    },
    /**
     * Callback after password reset is complete. Never throw here: better-auth (1.7.14) calls it
     * after the token is used, the user's sessions are deleted and the new password is stored, in
     * that order (utils/password.mjs; not atomic, as the adapter runs without a transaction), so a
     * throw returns 500 for a reset that already happened (#529). The log names the user by id:
     * email addresses stay out of the logs (#594)
     */
    onPasswordReset: async ({ user }) => {
      console.log(`Password reset completed for user ${user.id}`);
    },
    resetPasswordTokenExpiresIn: 60 * 60, // 1 hour
    /**
     * A reset deletes every session of the user, including one in the browser that made the
     * reset (the reset page sends the user to sign in again), so someone who knew the old
     * password, or registered the address first, is signed out (#529) on its next request: the
     * session is not cached in a cookie (session.cookieCache below, #578).
     */
    revokeSessionsOnPasswordReset: true,
  },

  /**
   * Email verification configuration
   * Note: requireEmailVerification is false, so this is only triggered manually
   */
  emailVerification: {
    sendVerificationEmail: async ({ user, url }, request) => {
      const locale = detectLocaleFromHeaders(request?.headers);
      const { subject, text, html } = generateVerificationEmail(user, url, locale);
      // Returned, not awaited here: better-auth hands it to advanced.backgroundTasks
      return sendAuthEmail({ to: user.email, subject, text, html });
    },
    sendOnSignUp: false, // Don't auto-send on signup (requireEmailVerification is false)
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day; not used while disableSessionRefresh is on
    /**
     * A session ends 7 days after sign-in, however often it is used (#647, decision
     * 2026-10-25-session-absolute-expiry). Without this, better-auth (1.7.14) moves the expiry
     * to "now + expiresIn" when a session read finds it last refreshed more than updateAge ago
     * (api/routes/session.mjs), so a copied session cookie used once a day never expires. A
     * session read then does not re-issue the session_token cookie either. Saving the profile
     * (/update-user) still re-issues the cookie for expiresIn, but the session row keeps its
     * expires_at, and a session past it is ended on its next read.
     */
    disableSessionRefresh: true,
    /**
     * No session cache in a cookie: each session read (get-session, the tRPC context) looks the
     * session up in the database, about two SELECTs per signed-in request (admin users only: a
     * request without a session cookie, such as a respondent's, is answered without the database).
     * Signing out, a password reset (#529) and deleting the account then end the session on the
     * next request. With the cache on, a signed session_data cookie was trusted without the
     * database for its maxAge (5 minutes), also when someone had copied the cookies (#578,
     * decision 2026-10-24-session-cookie-cache-off).
     */
    cookieCache: { enabled: false },
  },

  /**
   * Sign-up is invitation-only (the admin app is internal for now): the request must carry the
   * token of a pending invitation for the address. Checked before better-auth looks the address
   * up, so uninvited callers cannot probe which addresses are registered, and again when the user
   * row is created, so no other path can add users. Existing users sign in as before.
   *
   * An email verification link counts only in a browser signed in as the account it verifies
   * (see verify-email-guard.ts); elsewhere it comes back to its page with an error code.
   */
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === '/verify-email') {
        const email = verificationTokenEmail(ctx.query?.token);
        const session = await getSessionFromCtx(ctx, { disableCookieCache: true });
        if (email && session?.user.email.toLowerCase() === email) return;
        const back = refusedVerificationRedirect(ctx.query?.callbackURL);
        if (back) throw ctx.redirect(back);
        throw new APIError('FORBIDDEN', {
          message: 'Open the verification link in the browser signed in to the account',
          code: 'VERIFY_IN_SIGNED_IN_BROWSER',
        });
      }
      if (ctx.path !== '/sign-up/email') return;
      const body = (ctx.body ?? {}) as { email?: unknown; invitationToken?: unknown };
      const email = typeof body.email === 'string' ? body.email : '';
      if (!isAllowedEmail(email)) {
        throw new APIError('BAD_REQUEST', {
          message: testModeEmailMessage(),
          code: 'EMAIL_DOMAIN_NOT_ALLOWED',
        });
      }
      if (!(await isSignupInvited(db, body.invitationToken, email))) throw invitationRequired();
    }),
  },

  databaseHooks: {
    user: {
      create: {
        before: async (user, ctx) => {
          const body = (ctx?.body ?? {}) as { invitationToken?: unknown };
          if (
            ctx?.path !== '/sign-up/email' ||
            !(await isSignupInvited(db, body.invitationToken, user.email))
          ) {
            throw invitationRequired();
          }
          return { data: user };
        },
      },
    },
  },

  advanced: {
    // Secure (__Secure-) cookies in production, except a production build served over
    // http://localhost (the E2E run with `next start`), where the browser never sends them back
    useSecureCookies: env.NODE_ENV === 'production' && !isLocalHttpUrl(env.BETTER_AUTH_URL),
    database: {
      generateId: 'uuid',
    },
    /**
     * Auth emails (password reset, email verification) are sent after the response: the
     * request does not wait for the send, so its timing does not reveal whether the account
     * exists, and `after()` keeps the function alive until the send is done (an un-awaited
     * promise is cut off on Vercel, #65/#66). Without this handler better-auth would await
     * the send in the request.
     */
    backgroundTasks: { handler: runAfterResponse },
  },

  trustedOrigins: [env.NEXT_PUBLIC_APP_URL],
});

/**
 * Export types for type-safe auth usage
 */
export type Session = typeof auth.$Infer.Session.session;
export type User = typeof auth.$Infer.Session.user;
