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

/**
 * The mailbox a normalised address reaches: the "+tag" of the local part dropped, since most
 * mail servers deliver name+1@ and name+2@ to name@ (#899 review). Used only to count and to
 * limit mail per person; the mail itself goes to the address as typed.
 */
export function mailboxKey(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const plus = local.indexOf('+');
  return plus > 0 ? `${local.slice(0, plus)}${email.slice(at)}` : email;
}
