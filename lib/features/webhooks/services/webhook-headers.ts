/**
 * Webhook custom headers: validation, masking for display and merging on update (#314)
 *
 * Header values are sent as-is to the receiver and often hold its credentials
 * (e.g. `Authorization`), so they are never returned to a browser: readers get the names only.
 * On update, a header sent without a value (or with the mask) keeps its stored value, like the
 * signing secret. Names are compared without regard to case, as HTTP does. Pure functions: safe
 * to import from client components.
 */

/**
 * Shown in place of a stored header value; sent back as a value, it means "keep". Not ASCII,
 * so it can never be a real value.
 */
export const WEBHOOK_HEADER_MASK = '••••••••';

/** RFC 7230 token: no spaces, colons or control characters (so no surrounding whitespace) */
export const WEBHOOK_HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
export const WEBHOOK_HEADER_NAME_MAX_LENGTH = 100;
/**
 * Printable ASCII and tab only: no CR, LF or NUL (a value cannot start another header line),
 * and no other characters fetch would refuse at every delivery
 */
export const WEBHOOK_HEADER_VALUE_PATTERN = /^[\t\x20-\x7E]*$/;
export const WEBHOOK_HEADER_VALUE_MAX_LENGTH = 2000;
export const WEBHOOK_HEADERS_MAX_COUNT = 20;

/**
 * Names the delivery sets itself or the HTTP client controls (lower case). Every header the
 * delivery sets is covered: Content-Type, User-Agent and the X-Webhook-* ones (signature, ID,
 * event). `__proto__` is a valid token, but fetch's own conversion of a header object drops it,
 * so it could never be sent. The connection-level ones (Upgrade, Keep-Alive, Expect, TE, Trailer,
 * Proxy-Connection) were refused by fetch; node:http, used since #330, would send them.
 */
const RESERVED_HEADER_NAMES = new Set([
  'content-type',
  'user-agent',
  'host',
  'content-length',
  'transfer-encoding',
  'connection',
  'upgrade',
  'keep-alive',
  'expect',
  'te',
  'trailer',
  'proxy-connection',
  '__proto__',
]);
const RESERVED_HEADER_PREFIX = 'x-webhook-';

export function isReservedWebhookHeaderName(name: string): boolean {
  const lower = name.toLowerCase();
  return RESERVED_HEADER_NAMES.has(lower) || lower.startsWith(RESERVED_HEADER_PREFIX);
}

/** A name the user may set: a token of at most 100 characters, not reserved */
export function isValidWebhookHeaderName(name: string): boolean {
  return (
    name.length <= WEBHOOK_HEADER_NAME_MAX_LENGTH &&
    WEBHOOK_HEADER_NAME_PATTERN.test(name) &&
    !isReservedWebhookHeaderName(name)
  );
}

/** A stored header as returned to a browser: the name only */
export interface MaskedWebhookHeader {
  name: string;
  masked: true;
}

/** A header in an update: without a value (or with the mask), the stored value is kept */
export interface WebhookHeaderInput {
  name: string;
  value?: string;
}

/**
 * Header names of a stored webhook, values withheld. Sorted by name: jsonb does not keep the
 * order the headers were entered in.
 */
export function maskWebhookHeaders(
  headers: Record<string, string> | null | undefined
): MaskedWebhookHeader[] {
  return Object.keys(headers ?? {})
    .sort()
    .map((name) => ({ name, masked: true }));
}

export type WebhookHeadersError = 'duplicate_name' | 'missing_value' | 'headers_reentry_required';

export type MergeWebhookHeadersResult =
  | { ok: true; headers: Record<string, string> }
  | { ok: false; reason: WebhookHeadersError; name: string };

/**
 * The headers to store on creation, from a list in which every value is given. A name given
 * twice (in any case) is refused.
 */
export function buildWebhookHeaders(
  input: { name: string; value: string }[]
): MergeWebhookHeadersResult {
  return mergeWebhookHeaders(null, input);
}

/**
 * The headers to store after an update. `input` is the complete list: a name not in it is
 * removed; a name without a value (or with the mask) keeps its stored value; a value replaces
 * it. Names match without regard to case, so changing only the case keeps the value (stored
 * under the new spelling). A new name without a value, or a name given twice, is refused.
 *
 * With `requireNewValues` (the URL changes), keeping any stored value is refused: the stored
 * credentials must not follow the webhook to another receiver, or to another path of a shared
 * receiver.
 */
export function mergeWebhookHeaders(
  stored: Record<string, string> | null | undefined,
  input: WebhookHeaderInput[],
  { requireNewValues = false }: { requireNewValues?: boolean } = {}
): MergeWebhookHeadersResult {
  const storedByLowerName = new Map<string, string>();
  for (const [name, value] of Object.entries(stored ?? {})) {
    storedByLowerName.set(name.toLowerCase(), value);
  }

  // A Map, then Object.fromEntries: both define keys rather than assign them, so a name such
  // as `__proto__` cannot vanish into the prototype
  const merged = new Map<string, string>();
  const seen = new Set<string>();

  for (const { name, value } of input) {
    const lower = name.toLowerCase();
    if (seen.has(lower)) {
      return { ok: false, reason: 'duplicate_name', name };
    }
    seen.add(lower);

    if (value === undefined || value === WEBHOOK_HEADER_MASK) {
      const kept = storedByLowerName.get(lower);
      if (kept === undefined) {
        return { ok: false, reason: 'missing_value', name };
      }
      if (requireNewValues) {
        return { ok: false, reason: 'headers_reentry_required', name };
      }
      merged.set(name, kept);
    } else {
      merged.set(name, value);
    }
  }

  return { ok: true, headers: Object.fromEntries(merged) };
}

/**
 * Whether two URLs differ once normalised (`new URL().href`: case of the scheme and host, the
 * default port, an empty path). Any other difference counts, the path and query included: a
 * shared receiver (e.g. a hooks service) tells its users apart by path. An unparsable URL
 * counts as different.
 */
export function isUrlChanged(previousUrl: string, nextUrl: string): boolean {
  try {
    return new URL(previousUrl).href !== new URL(nextUrl).href;
  } catch {
    return true;
  }
}
