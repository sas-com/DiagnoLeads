/**
 * NUL (U+0000) in tRPC input (#621). PostgreSQL's text and jsonb cannot store it, so a write fails
 * in the database and comes back as INTERNAL_SERVER_ERROR, which alerts whoever is on call. The
 * input is refused before any procedure runs instead. Other control characters (line breaks,
 * tabs) are left alone: saved values may contain them and must stay editable.
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

export const NUL_INPUT_MESSAGE = '入力に使えない文字（NUL）が含まれています';
