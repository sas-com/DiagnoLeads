import { env } from '@/lib/env';
import { TURNSTILE_ACTION } from './turnstile-action';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
/** Cloudflare answers in well under a second; a hung check must not hold the respondent */
const SITEVERIFY_TIMEOUT_MS = 5000;

export type TurnstileOutcome =
  | { ok: true }
  /** missing / invalid: the respondent's check failed; unavailable: Cloudflare could not answer */
  | { ok: false; reason: 'missing' | 'invalid' | 'unavailable' };

/**
 * Site key for the widget, or undefined when Turnstile is off.
 * On only when both keys are set, so the form and the server always agree.
 */
export function turnstileSiteKey(): string | undefined {
  return env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY ? env.TURNSTILE_SITE_KEY : undefined;
}

/**
 * Check a Turnstile token with Cloudflare (siteverify). Tokens are single-use and expire after
 * five minutes, which siteverify enforces. Passes without a check when Turnstile is off.
 */
export async function verifyTurnstile(
  token: string | undefined,
  remoteIp: string | undefined
): Promise<TurnstileOutcome> {
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!turnstileSiteKey() || !secret) return { ok: true };
  if (!token) return { ok: false, reason: 'missing' };

  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set('remoteip', remoteIp);
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, reason: 'unavailable' };
    const data = (await res.json()) as { success?: boolean; action?: string };
    if (data.success !== true) return { ok: false, reason: 'invalid' };
    // A token from another widget of the same site key is not for this form
    if (data.action && data.action !== TURNSTILE_ACTION) return { ok: false, reason: 'invalid' };
    return { ok: true };
  } catch (error) {
    console.error('Turnstile siteverify failed:', error);
    return { ok: false, reason: 'unavailable' };
  }
}
