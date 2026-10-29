import type { RateLimitRule } from '../rate-limit';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * Limits of the public AX diagnosis endpoints, kept in the DB so they hold across server
 * instances. The in-memory limit in the middleware stays in front of them.
 */
export const AX_RATE_LIMITS = {
  /**
   * Diagnosing a few systems in one visit is normal; dozens from one address are not. Loose
   * enough for a company network or an event venue sharing one address (IPv6 counts per /64)
   */
  submitPerIp: { name: 'ax-submit-ip', limit: 30, windowMs: HOUR },
  /** Caps what one address can pile up over a day (the hourly limit alone allows 720) */
  submitPerIpDaily: { name: 'ax-submit-ip-day', limit: 100, windowMs: DAY },
  submitPerEmail: { name: 'ax-submit-email', limit: 6, windowMs: HOUR },
  /**
   * Sales notifications per organization and hour. Past it, submissions are still accepted and
   * saved, but no one is notified about them (members get one notice), so a flood can neither
   * bury the sales inbox nor shut the form for real respondents
   */
  notificationsPerOrganization: { name: 'ax-notify-org', limit: 100, windowMs: HOUR },
  /**
   * Past the limit above, consultation requests are still notified (a flood must not hide a real
   * one, #232), up to this separate cap, since each new submission can carry a request
   */
  consultationNotificationsPerOrganization: {
    name: 'ax-notify-consultation-org',
    limit: 300,
    windowMs: HOUR,
  },
  consultationPerIp: { name: 'ax-consultation-ip', limit: 10, windowMs: HOUR },
  detailsPerIp: { name: 'ax-details-ip', limit: 20, windowMs: HOUR },
  /** Documents and seminars requested from the result (#153) */
  offersPerIp: { name: 'ax-offers-ip', limit: 30, windowMs: HOUR },
  /**
   * The document request form of the landing pages (#899). Each request may mail a link, so
   * tighter than the diagnosis; per address of the requester and per address typed in
   */
  documentRequestPerIp: { name: 'ax-document-request-ip', limit: 10, windowMs: HOUR },
  documentRequestPerIpDaily: { name: 'ax-document-request-ip-day', limit: 30, windowMs: DAY },
  documentRequestPerEmail: { name: 'ax-document-request-email', limit: 3, windowMs: HOUR },
  /** Per mailbox: name+1@ and name+2@ count as name@ (#899 review) */
  documentRequestPerMailboxDaily: {
    name: 'ax-document-request-mailbox-day',
    limit: 3,
    windowMs: DAY,
  },
  /** Opening the mailed link (#899): a few opens are normal, a sweep of tokens is not */
  documentOpenPerIp: { name: 'ax-document-open-ip', limit: 60, windowMs: HOUR },
  // Sales emails share SALES_EMAIL_LIMITS (lib/features/diagnostics/service.ts) with the
  // builder's diagnoses (#481)
  /** The "receive the result by email" button of the result screen (#154) */
  resultEmailRequestPerIp: { name: 'ax-result-email-ip', limit: 10, windowMs: HOUR },
  /** The buttons of the confirm page (receive / decline) */
  resultEmailConfirmPerIp: { name: 'ax-result-email-confirm-ip', limit: 20, windowMs: HOUR },
  /**
   * Confirmation mails to respondents per organization, per hour and per day, counted before
   * each attempt (also for a suppressed address, so attempts cannot pile up rows). Separate from
   * the sign-in and sales mail; past a limit the request answers 503 and nothing is recorded
   */
  respondentEmailPerOrganizationHourly: {
    name: 'ax-respondent-email-org-hour',
    limit: 30,
    windowMs: HOUR,
  },
  respondentEmailPerOrganization: { name: 'ax-respondent-email-org', limit: 100, windowMs: DAY },
} as const satisfies Record<string, RateLimitRule>;
