/**
 * Constants of the AX result by email (#154), without the mail builders, so that the result
 * screen and the confirm page can use them without bundling the mail text.
 */

/** Version of the consent text the respondent agrees to; bump it when the text changes */
export const AX_RESULT_EMAIL_CONSENT_VERSION = '2026-10-22';

/** Locale keys of the consent text shown next to the request button */
export const AX_RESULT_EMAIL_CONSENT_KEYS = {
  label: 'axDiagnosis.resultEmail.consent.label',
  body: 'axDiagnosis.resultEmail.consent.body',
} as const;

/** How long the confirmation button stays valid */
export const AX_RESULT_EMAIL_CONFIRM_TTL_HOURS = 72;

/**
 * Whether the result screen offers the result by email and new requests are accepted
 * (AX_RESULT_EMAIL_ENABLED=true). Off by default: it is turned on only after the legal check
 * and the switch of the sender (#128), with the owner's approval. Confirming a request already
 * mailed works either way.
 */
export function axResultEmailEnabled(value = process.env.AX_RESULT_EMAIL_ENABLED): boolean {
  return value?.trim().toLowerCase() === 'true';
}
