import type { DiagnosticAnswers } from '../types';

/** The follow-up that asks which kinds of data an Access tool holds (#826) */
export const ACCESS_DATA_KINDS_QUESTION = 'access_data_kinds';

/**
 * Kinds of data whose handling the result says is decided together in the consultation (#844):
 * personal data (including special care, My Number and card or account numbers) and confidential
 * information that is not personal, not "none" or "I don't know". Kept here and not in config.ts,
 * which the public diagnosis must not ship to the browser (arch:check, public-bundle-imports-scoring)
 */
export const ACCESS_DATA_KINDS_TO_DISCUSS: readonly string[] = [
  'customer',
  'employee',
  'sensitive',
  'my_number',
  'payment',
  'confidential',
];

/** Whether the answers name such data; "I don't know" next to a known kind still counts */
export function holdsDataToDiscuss(answers: DiagnosticAnswers): boolean {
  const kinds = answers[ACCESS_DATA_KINDS_QUESTION];
  return Array.isArray(kinds) && kinds.some((kind) => ACCESS_DATA_KINDS_TO_DISCUSS.includes(kind));
}
