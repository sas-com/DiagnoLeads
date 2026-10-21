/**
 * Auth emails are sent after the response (#69): better-auth hands the callback's promise to
 * advanced.backgroundTasks, whose handler schedules it with Next.js after(), so the request
 * neither waits for the send (timing does not reveal whether the account exists) nor loses it
 * when the function is stopped after the response. Also: no cookieDomain option (#237).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { after, sendEmail } = vi.hoisted(() => ({
  after: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after,
}));
vi.mock('@/lib/features/email', () => ({ sendEmail }));
vi.mock('@/lib/db/client', () => ({ db: {} }));
vi.mock('@/lib/env', () => ({
  env: {
    NODE_ENV: 'production',
    BETTER_AUTH_URL: 'https://app.example.com',
    BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-32',
    NEXT_PUBLIC_APP_URL: 'https://app.example.com',
  },
}));

const { auth } = await import('@/lib/auth/config');
const { runAfterResponse } = await import('@/lib/auth/email-helpers');

const user = {
  id: 'user-1',
  email: 'someone@example.com',
  name: 'Someone',
  emailVerified: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const request = new Request('https://app.example.com/api/auth/request-password-reset', {
  headers: { 'accept-language': 'en' },
});

/** A send that only finishes when the test says so */
function pendingSend() {
  let finish: () => void = () => {};
  sendEmail.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    })
  );
  return () => finish();
}

describe('auth emails after the response', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    after.mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('registers the after() handler as better-auth background tasks', () => {
    expect(auth.options.advanced?.backgroundTasks?.handler).toBe(runAfterResponse);
  });

  it.each([
    [
      'password reset',
      () =>
        auth.options.emailAndPassword?.sendResetPassword?.(
          { user, url: 'https://app.example.com/reset/t', token: 't' },
          request
        ),
    ],
    [
      'email verification',
      () =>
        auth.options.emailVerification?.sendVerificationEmail?.(
          { user, url: 'https://app.example.com/verify/t', token: 't' },
          request
        ),
    ],
  ])('%s: the request does not wait for the send, after() does', async (_name, callback) => {
    const finishSend = pendingSend();
    const ctx = await auth.$context;

    // What better-auth does with the callback's result in the endpoint
    await ctx.runInBackgroundOrAwait(callback());

    // The endpoint has finished while the send is still running
    expect(after).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'someone@example.com' }))
    );

    // after() keeps the function alive until the send has settled
    const task = after.mock.calls[0][0] as () => Promise<unknown>;
    let settled = false;
    const kept = task().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    finishSend();
    await kept;
    expect(settled).toBe(true);
  });

  it('the callbacks return the send instead of dropping it', async () => {
    const finishSend = pendingSend();
    const result = auth.options.emailAndPassword?.sendResetPassword?.(
      { user, url: 'https://app.example.com/reset/t', token: 't' },
      request
    );
    expect(result).toBeInstanceOf(Promise);
    finishSend();
    await result;
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('has no cookieDomain option (#237)', () => {
    expect(auth.options.advanced).not.toHaveProperty('cookieDomain');
    expect(auth.options.advanced).not.toHaveProperty('crossSubDomainCookies');
  });
});

describe('runAfterResponse', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hands the task to after()', async () => {
    runAfterResponse(Promise.resolve('done'));
    expect(after).toHaveBeenCalledTimes(1);
    const task = after.mock.calls[0][0] as () => Promise<unknown>;
    await expect(task()).resolves.toBe('done');
  });

  it('outside a request scope it lets the task run on and logs its error', async () => {
    after.mockImplementation(() => {
      throw new Error('`after` was called outside a request scope.');
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const failure = Promise.reject(new Error('smtp down'));

    expect(() => runAfterResponse(failure)).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('after() unavailable'), expect.any(Error));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(log).toHaveBeenCalledWith('Background task failed:', expect.any(Error));
  });

  it('a failing task never rejects the after() callback', async () => {
    after.mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    runAfterResponse(Promise.reject(new Error('smtp down')));
    const task = after.mock.calls[0][0] as () => Promise<unknown>;
    await expect(task()).resolves.toBeUndefined();
  });
});
