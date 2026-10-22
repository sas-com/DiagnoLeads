/**
 * Respondent addresses are stored and compared in one form (#154): trimmed and lowercase, so
 * the suppression list matches however the address was typed.
 *
 * A mail with a one-click unsubscribe link must have exactly one validated recipient (the link
 * carries that recipient's token), so anything that could name several addresses is refused.
 */

/** Longest address accepted (RFC 5321 path limit) */
const MAX_LENGTH = 254;

/**
 * One plain address: a local part, one '@' and a domain with a dot. No whitespace, line breaks,
 * separators (',' ';'), angle brackets, quotes or parentheses, which would allow a display name
 * or several recipients.
 */
const ADDRESS = /^[^\s@,;<>"()[\]\\]+@[^\s@,;<>"()[\]\\]+\.[^\s@,;<>"()[\]\\]+$/;

/** The normalised address, or null when the value is not exactly one plain address */
export function normaliseEmail(value: string): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length === 0 || email.length > MAX_LENGTH) return null;
  if (!ADDRESS.test(email)) return null;
  return email;
}
