/**
 * Respondent email (#154): consent records, one row per send, the suppression list and the
 * one-time tokens. Generic: it knows nothing of a particular diagnosis.
 */
export { normaliseEmail } from './normalize';
export { hashToken, newToken } from './tokens';
export {
  isSuppressed,
  suppress,
  type SuppressionReason,
  type SuppressionSource,
} from './suppression';
export {
  sendRespondentEmail,
  type RespondentEmailContent,
  type RespondentEmailDeps,
  type RespondentEmailErrorCode,
  type RespondentEmailKind,
  type SendRespondentEmailInput,
  type SendRespondentEmailResult,
} from './send';
