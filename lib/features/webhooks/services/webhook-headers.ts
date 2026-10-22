/**
 * Webhook custom headers: masking for display and merging on update (#314)
 *
 * Header values are sent as-is to the receiver and often hold its credentials
 * (e.g. `Authorization`), so they are never returned to a browser: readers get the names only.
 * On update, a header sent without a value (or with the mask) keeps its stored value, like the
 * signing secret. Pure functions: safe to import from client components.
 */

/** Shown in place of a stored header value; sent back as a value, it means "keep" */
export const WEBHOOK_HEADER_MASK = '••••••••';

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

export type MergeWebhookHeadersResult =
  | { ok: true; headers: Record<string, string> }
  | { ok: false; reason: 'duplicate_name' | 'missing_value'; name: string };

/**
 * The headers to store after an update. `input` is the complete list: a name not in it is
 * removed; a name without a value (or with the mask) keeps its stored value; a value replaces
 * it. Names match exactly. A new name without a value, or a name given twice, is refused.
 */
export function mergeWebhookHeaders(
  stored: Record<string, string> | null | undefined,
  input: WebhookHeaderInput[]
): MergeWebhookHeadersResult {
  const current = stored ?? {};
  const merged: Record<string, string> = {};

  for (const { name, value } of input) {
    if (Object.hasOwn(merged, name)) {
      return { ok: false, reason: 'duplicate_name', name };
    }
    if (value === undefined || value === WEBHOOK_HEADER_MASK) {
      if (!Object.hasOwn(current, name)) {
        return { ok: false, reason: 'missing_value', name };
      }
      merged[name] = current[name];
    } else {
      merged[name] = value;
    }
  }

  return { ok: true, headers: merged };
}
