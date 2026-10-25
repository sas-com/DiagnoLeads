/**
 * NUL (U+0000) anywhere in a value. PostgreSQL's text and jsonb cannot store it, so input
 * containing it is refused before it reaches the database: tRPC input (lib/trpc/reject-nul.ts,
 * #621) and the public API bodies (readJsonBody, #648).
 */

const NUL = '\u0000';

/** Whether a string anywhere in the value (object keys included) contains NUL */
export function containsNul(value: unknown): boolean {
  const pending: unknown[] = [value];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const item = pending.pop();
    if (typeof item === 'string') {
      if (item.includes(NUL)) return true;
    } else if (item !== null && typeof item === 'object') {
      if (seen.has(item)) continue;
      seen.add(item);
      if (item instanceof Map) {
        for (const [key, entry] of item) pending.push(key, entry);
      } else if (item instanceof Set || Array.isArray(item)) {
        for (const entry of item) pending.push(entry);
      } else if (!(item instanceof Date)) {
        for (const [key, entry] of Object.entries(item)) {
          if (key.includes(NUL)) return true;
          pending.push(entry);
        }
      }
    }
  }
  return false;
}
