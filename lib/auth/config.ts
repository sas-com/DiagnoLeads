import { db } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import { env } from '@/lib/env';
import { isSignupInvited } from '@/lib/features/members/invitations';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import {
  detectLocaleFromHeaders,
  generatePasswordResetEmail,
  generateVerificationEmail,
  sendAuthEmail,
} from './email-helpers';

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
      const { subject, text } = generatePasswordResetEmail(user, url, locale);
      void sendAuthEmail({ to: user.email, subject, text });
    },
    /**
     * Callback after password reset is complete
     */
    onPasswordReset: async ({ user }) => {
      console.log(`Password reset completed for user: ${user.email}`);
    },
    resetPasswordTokenExpiresIn: 60 * 60, // 1 hour
  },

  /**
   * Email verification configuration
   * Note: requireEmailVerification is false, so this is only triggered manually
   */
  emailVerification: {
    sendVerificationEmail: async ({ user, url }, request) => {
      const locale = detectLocaleFromHeaders(request?.headers);
      const { subject, text } = generateVerificationEmail(user, url, locale);
      void sendAuthEmail({ to: user.email, subject, text });
    },
    sendOnSignUp: false, // Don't auto-send on signup (requireEmailVerification is false)
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day - update session if older than this
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 minutes - cache session in cookie
    },
  },

  /**
   * Sign-up is invitation-only (the admin app is internal for now): the request must carry the
   * token of a pending invitation for the address. Checked before better-auth looks the address
   * up, so uninvited callers cannot probe which addresses are registered, and again when the user
   * row is created, so no other path can add users. Existing users sign in as before.
   */
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/sign-up/email') return;
      const body = (ctx.body ?? {}) as { email?: unknown; invitationToken?: unknown };
      const email = typeof body.email === 'string' ? body.email : '';
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
    useSecureCookies: env.NODE_ENV === 'production',
    cookieDomain: env.NODE_ENV === 'production' ? env.BETTER_AUTH_URL : undefined,
    database: {
      generateId: 'uuid',
    },
  },

  trustedOrigins: [env.NEXT_PUBLIC_APP_URL],
});

/**
 * Export types for type-safe auth usage
 */
export type Session = typeof auth.$Infer.Session.session;
export type User = typeof auth.$Infer.Session.user;
