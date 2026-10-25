/**
 * Single-line text typed into a form and shown to sales (names, company, labels): no control
 * characters (Cc: NUL, line breaks, tabs) and no format characters (Cf: bidi overrides, zero
 * width spaces). The line and paragraph separators (U+2028, U+2029) and lone surrogates are not
 * in these classes and pass. The one definition, read by the forms and the API (#546).
 */
export const PLAIN_TEXT = /^[^\p{Cc}\p{Cf}]*$/u;
