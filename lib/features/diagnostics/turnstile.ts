import { env } from '@/lib/env';
import { TURNSTILE_ACTION } from './turnstile-action';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
/** Cloudflare answers in well under a second; a hung check must not hold the respondent */
const SITEVERIFY_TIMEOUT_MS = 5000;

export type TurnstileOutcome =
  | { ok: true }
  /** missing / invalid: the respondent's check failed; unavailable: Cloudflare could not answer */
  | { ok: false; reason: 'missing' | 'invalid' | 'unavailable' };

interface SiteverifyResponse {
  success?: boolean;
  action?: string;
  hostname?: string;
  metadata?: { result_with_testing_key?: boolean };
}

let reportedHalfConfigured = false;

/**
 * Site key for the widget, or undefined when Turnstile is off.
 * On only when both keys are set, so the form and the server always agree.
 */
export function turnstileSiteKey(): string | undefined {
  const { TURNSTILE_SITE_KEY: siteKey, TURNSTILE_SECRET_KEY: secret } = env;
  if (siteKey && secret) return siteKey;
  if ((siteKey || secret) && !reportedHalfConfigured) {
    reportedHalfConfigured = true;
    console.error('Turnstile is off: set both TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY');
  }
  return undefined;
}

/**
 * Check a Turnstile token with Cloudflare (siteverify). Tokens are single-use and expire after
 * five minutes, which siteverify enforces; the token must also come from this form's widget
 * (action) on the site that was asked (hostname). Passes without a check when Turnstile is off.
 */
export async function verifyTurnstile(
  token: string | undefined,
  remoteIp: string | undefined,
  hostname: string | undefined,
  action: string = TURNSTILE_ACTION
): Promise<TurnstileOutcome> {
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!turnstileSiteKey() || !secret) return { ok: true };
  if (!token) return { ok: false, reason: 'missing' };

  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set('remoteip', remoteIp);
  let data: SiteverifyResponse;
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, reason: 'unavailable' };
    data = (await res.json()) as SiteverifyResponse;
  } catch (error) {
    console.error('Turnstile siteverify failed:', error);
    return { ok: false, reason: 'unavailable' };
  }

  if (data.success !== true) return { ok: false, reason: 'invalid' };
  // Cloudflare's test keys pass any token: fine for local and preview runs, never in production
  if (data.metadata?.result_with_testing_key === true) {
    return process.env.VERCEL_ENV === 'production'
      ? { ok: false, reason: 'invalid' }
      : { ok: true };
  }
  if (data.action !== action) return { ok: false, reason: 'invalid' };
  if (hostname && data.hostname !== hostname) return { ok: false, reason: 'invalid' };
  return { ok: true };
}
