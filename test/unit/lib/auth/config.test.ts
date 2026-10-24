/**
 * The options the real auth configuration (lib/auth/config.ts) passes to better-auth. The
 * behaviour behind them is checked elsewhere: the password reset that ends the user's sessions
 * on PostgreSQL in test/unit/integration/password-reset-sessions.db.test.ts, the auth emails in
 * auth-email-background.test.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({ db: {} }));

const productionEnv = {
  NODE_ENV: 'production',
  BETTER_AUTH_URL: 'https://app.example.com',
  BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-32',
  NEXT_PUBLIC_APP_URL: 'https://app.example.com',
};

/** The configuration as it is built with the given environment */
async function loadAuth(env: Record<string, string> = productionEnv) {
  vi.resetModules();
  vi.doMock('@/lib/env', () => ({ env }));
  const { auth } = await import('@/lib/auth/config');
  return auth.options;
}

afterEach(() => {
  vi.doUnmock('@/lib/env');
});

describe('auth configuration', () => {
  it('ends every session of the user when their password is reset (#529)', async () => {
    const options = await loadAuth();

    expect(options.emailAndPassword?.revokeSessionsOnPasswordReset).toBe(true);
  });

  it('keeps reset links for one hour and passwords between 8 and 128 characters', async () => {
    const { emailAndPassword } = await loadAuth();

    expect(emailAndPassword).toMatchObject({
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 60 * 60,
    });
    expect(emailAndPassword?.sendResetPassword).toEqual(expect.any(Function));
  });

  it('keeps sessions 7 days, refreshes them daily and caches them in a cookie for 5 minutes', async () => {
    const { session } = await loadAuth();

    expect(session).toMatchObject({
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    });
  });

  it('generates UUIDs and passes only the app URL as trustedOrigins', async () => {
    const options = await loadAuth();

    expect(options.advanced?.database?.generateId).toBe('uuid');
    expect(options.trustedOrigins).toEqual(['https://app.example.com']);
  });

  it.each([
    ['production over https', productionEnv, true],
    [
      'a production build served over http://localhost (E2E)',
      {
        ...productionEnv,
        BETTER_AUTH_URL: 'http://localhost:3000',
        NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
      },
      false,
    ],
    ['development', { ...productionEnv, NODE_ENV: 'development' }, false],
  ])('secure cookies: %s -> %s', async (_name, env, expected) => {
    const options = await loadAuth(env);

    expect(options.advanced?.useSecureCookies).toBe(expected);
  });
});
