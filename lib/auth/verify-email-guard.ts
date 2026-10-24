/**
 * Email verification links only count in the browser signed in as the account being verified
 * (PR #518 review). better-auth marks the account in the token as verified whoever opens the link,
 * so someone holding a leaked invitation link could sign up with the invited address, send the
 * verification email to the real owner and wait for them to open it. Requiring the same signed-in
 * account in the browser that opens the link closes that.
 */

/** The error code put on the callback URL when the link was opened elsewhere */
export const VERIFY_IN_SIGNED_IN_BROWSER = 'VERIFY_IN_SIGNED_IN_BROWSER';

/**
 * The address in a verification token, read without checking the signature. Only used to refuse:
 * better-auth still checks the signature before verifying anything.
 */
export function verificationTokenEmail(token: unknown): string | null {
  if (typeof token !== 'string') return null;
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const data: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const email = (data as { email?: unknown } | null)?.email;
    return typeof email === 'string' ? email.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Where to send someone whose link was refused: the callback path with the error code, or null
 * when the callback is not a path on this site (then the request is refused without a redirect)
 */
export function refusedVerificationRedirect(callbackURL: unknown): string | null {
  if (typeof callbackURL !== 'string' || !/^\/(?![/\\])/.test(callbackURL)) return null;
  const separator = callbackURL.includes('?') ? '&' : '?';
  return `${callbackURL}${separator}error=${VERIFY_IN_SIGNED_IN_BROWSER}`;
}
