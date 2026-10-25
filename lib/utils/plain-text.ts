/**
 * Single-line text typed into a form and shown to sales (names, company, labels): no control or
 * format characters, so a line break or a bidi override cannot change how it reads in a list,
 * an email or a notification. The one definition, read by the forms and the API (#546).
 */
export const PLAIN_TEXT = /^[^\p{Cc}\p{Cf}]*$/u;
