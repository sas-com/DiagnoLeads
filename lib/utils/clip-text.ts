/**
 * Text that ends up in jsonb (#754). PostgreSQL rejects a lone UTF-16 surrogate in jsonb
 * ("Unicode low surrogate must follow a high surrogate"), so the whole write fails; a text column
 * takes it but stores U+FFFD. Lone surrogates come from cutting a string inside an emoji with
 * `slice`, or from a caller sending "\ud800" on purpose.
 */

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const LONE_SURROGATES = new RegExp(LONE_SURROGATE.source, 'g');

/** At most `max` UTF-16 units, never cutting a character in half */
export function clipText(value: string, max: number): string {
  const clipped = value.slice(0, max);
  const last = clipped.charCodeAt(clipped.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? clipped.slice(0, -1) : clipped;
}

/** Whether the string holds a surrogate without its pair */
export function hasLoneSurrogate(value: string): boolean {
  return LONE_SURROGATE.test(value);
}

/** The string with each lone surrogate replaced by U+FFFD (String.prototype.toWellFormed) */
export function toWellFormed(value: string): string {
  return value.replace(LONE_SURROGATES, '�');
}
