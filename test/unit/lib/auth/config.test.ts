/**
 * The options the real auth configuration (lib/auth/config.ts) passes to better-auth. The
 * behaviour behind them is checked elsewhere: on PostgreSQL, the password reset that ends the
 * user's sessions in test/unit/integration/password-reset-sessions.db.test.ts, copied cookies
 * that stop signing in once the session ends in session-revocation.db.test.ts, and sessions that
 * are not extended in session-absolute-expiry.db.test.ts; the auth emails in
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
  vi.restoreAllMocks();
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

  it('logs a completed reset with the user id, not the email address, and does not throw (#594)', async () => {
    const { emailAndPassword } = await loadAuth();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const user = {
      id: 'user-594',
      email: 'reset-594@example.com',
      name: 'Reset Someone',
      emailVerified: true,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // better-auth awaits this before it deletes the user's sessions (#529)
    await expect(emailAndPassword?.onPasswordReset?.({ user })).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledTimes(1);
    const line = log.mock.calls[0].join(' ');
    expect(line).toContain('user-594');
    expect(line).not.toContain('reset-594@example.com');
  });

  it('ends sessions 7 days after sign-in and never extends them (#647)', async () => {
    const { session } = await loadAuth();

    expect(session?.expiresIn).toBe(60 * 60 * 24 * 7);
    // Without this, a session read moves the expiry to "now + 7 days" once a day (updateAge)
    expect(session?.disableSessionRefresh).toBe(true);
  });

  it('never caches sessions in a cookie (#578)', async () => {
    const { session } = await loadAuth();

    // Each session read goes to the database, so an ended session ends on the next request
    expect(session?.cookieCache).toEqual({ enabled: false });
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
