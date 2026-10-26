/**
 * Single-line text typed into a form and shown to sales (names, company, labels): no control
 * characters (Cc: NUL, line breaks, tabs), no format characters (Cf: bidi overrides, zero width
 * spaces) and no lone surrogates (Cs). PostgreSQL refuses a lone surrogate in jsonb (the webhook
 * deliveries keep the company and the name, the agency contracts their criteria), so one would
 * fail the write instead of being refused here (#747). The line and paragraph separators
 * (U+2028, U+2029) pass: browsers show them as a space on one line and emails replace them. The
 * one definition, read by the forms and the API (#546).
 */
export const PLAIN_TEXT = /^[^\p{Cc}\p{Cf}\p{Cs}]*$/u;
