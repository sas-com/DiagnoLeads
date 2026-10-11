/**
 * Server-side Turnstile check (siteverify), with Cloudflare's answer mocked
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env: { TURNSTILE_SITE_KEY?: string; TURNSTILE_SECRET_KEY?: string } = {};
vi.mock('@/lib/env', () => ({ env }));

const { turnstileSiteKey, verifyTurnstile } = await import('@/lib/features/diagnostics/turnstile');

const fetchMock = vi.fn();
const answer = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
const passed = { success: true, action: 'ax-diagnosis', hostname: 'diagnoleads-v2.vercel.app' };

describe('verifyTurnstile', () => {
  beforeEach(() => {
    env.TURNSTILE_SITE_KEY = 'site-key';
    env.TURNSTILE_SECRET_KEY = 'secret-key';
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('passes a token Cloudflare accepts for this form and site, sending the address', async () => {
    fetchMock.mockResolvedValue(answer(passed));
    await expect(
      verifyTurnstile('token', '203.0.113.7', 'diagnoleads-v2.vercel.app')
    ).resolves.toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    const body = init.body as URLSearchParams;
    expect(body.get('secret')).toBe('secret-key');
    expect(body.get('response')).toBe('token');
    expect(body.get('remoteip')).toBe('203.0.113.7');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('refuses a missing token without asking Cloudflare', async () => {
    await expect(verifyTurnstile(undefined, undefined, 'x')).resolves.toEqual({
      ok: false,
      reason: 'missing',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['not successful', { success: false, 'error-codes': ['invalid-input-response'] }],
    ['without success', { action: 'ax-diagnosis' }],
    ['from another widget', { ...passed, action: 'login' }],
    ['without an action', { success: true, hostname: 'diagnoleads-v2.vercel.app' }],
    ['solved on another site', { ...passed, hostname: 'evil.example' }],
  ])('refuses a token %s', async (_name, body) => {
    fetchMock.mockResolvedValue(answer(body));
    await expect(
      verifyTurnstile('token', undefined, 'diagnoleads-v2.vercel.app')
    ).resolves.toEqual({ ok: false, reason: 'invalid' });
  });

  it('accepts the test keys outside production only', async () => {
    const testing = { success: true, hostname: 'example.com', metadata: { result_with_testing_key: true } };
    fetchMock.mockResolvedValue(answer(testing));
    await expect(verifyTurnstile('XXXX.DUMMY.TOKEN.XXXX', undefined, 'localhost')).resolves.toEqual({
      ok: true,
    });
    vi.stubEnv('VERCEL_ENV', 'production');
    await expect(
      verifyTurnstile('XXXX.DUMMY.TOKEN.XXXX', undefined, 'diagnoleads-v2.vercel.app')
    ).resolves.toEqual({ ok: false, reason: 'invalid' });
  });

  it('refuses when Cloudflare cannot answer (no pass on errors)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(answer({}, 500));
    await expect(verifyTurnstile('token', undefined, 'x')).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
    fetchMock.mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'));
    await expect(verifyTurnstile('token', undefined, 'x')).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('not JSON');
      },
    } as unknown as Response);
    await expect(verifyTurnstile('token', undefined, 'x')).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
    errorSpy.mockRestore();
  });

  it('checks nothing when Turnstile is off (one key alone does not turn it on)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    env.TURNSTILE_SITE_KEY = undefined;
    await expect(verifyTurnstile(undefined, undefined, 'x')).resolves.toEqual({ ok: true });
    expect(turnstileSiteKey()).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    // The half-done setting is reported (once)
    expect(errorSpy).toHaveBeenCalledWith(
      'Turnstile is off: set both TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY'
    );
    errorSpy.mockRestore();
  });

  it('gives the site key to the form only when both keys are set', () => {
    expect(turnstileSiteKey()).toBe('site-key');
    env.TURNSTILE_SITE_KEY = undefined;
    env.TURNSTILE_SECRET_KEY = undefined;
    expect(turnstileSiteKey()).toBeUndefined();
  });
});
