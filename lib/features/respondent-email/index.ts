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
  IDEMPOTENT_REPLAY,
  sendRespondentEmail,
  type RespondentEmailContent,
  type RespondentEmailDeps,
  type RespondentEmailErrorCode,
  type RespondentEmailKind,
  type SendRespondentEmailInput,
  type SendRespondentEmailResult,
} from './send';
export {
  unsubscribeByToken,
  type UnsubscribeOutcome,
  type UnsubscribeSource,
} from './unsubscribe';
export {
  ONE_CLICK_UNSUBSCRIBE_PATH,
  UNSUBSCRIBE_PAGE_PATH,
  unsubscribeUrls,
  type UnsubscribeLocale,
  type UnsubscribeUrls,
} from './unsubscribe-urls';
