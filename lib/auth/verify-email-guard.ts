/**
 * Email verification links only count in the browser signed in as the account being verified
 * (PR #518 review). better-auth marks the account in the token as verified whoever opens the link,
 * so someone holding a leaked invitation link could sign up with the invited address, send the
 * verification email to the real owner and wait for them to open it. Requiring the same signed-in
 * account in the browser that opens the link closes that.
 *
 * The check compares addresses, not user ids. That holds while addresses are unique and cannot be
 * changed; review it if `user.changeEmail` is ever turned on.
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
 * The only page verification links come back to: the invite page (/ja/invite/<token>). Matched
 * whole, because the hook redirects before better-auth checks the callback, and a looser rule
 * lets values such as "/\t/evil.example" through, which browsers read as another site.
 */
const INVITE_PAGE = /^\/(ja|en)\/invite\/[A-Za-z0-9_-]+$/;

/**
 * Where to send someone whose link was refused: the invite page with the error code, or null for
 * any other callback (then the request is refused without a redirect)
 */
export function refusedVerificationRedirect(callbackURL: unknown): string | null {
  if (typeof callbackURL !== 'string' || !INVITE_PAGE.test(callbackURL)) return null;
  return `${callbackURL}?error=${VERIFY_IN_SIGNED_IN_BROWSER}`;
}
