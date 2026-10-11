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
  submitPerEmail: { name: 'ax-submit-email', limit: 6, windowMs: HOUR },
  /**
   * Sales notifications per organization and hour. Past it, submissions are still accepted and
   * saved, but no one is notified about them (members get one notice), so a flood can neither
   * bury the sales inbox nor shut the form for real respondents
   */
  notificationsPerOrganization: { name: 'ax-notify-org', limit: 100, windowMs: HOUR },
  consultationPerIp: { name: 'ax-consultation-ip', limit: 10, windowMs: HOUR },
  detailsPerIp: { name: 'ax-details-ip', limit: 20, windowMs: HOUR },
  /**
   * Sales emails per organization and day. The sending quota is shared with the sign-in emails
   * (password reset), so requests must not be able to use it up; past the limit sales still
   * get the in-app notification
   */
  salesEmailPerOrganization: { name: 'ax-sales-email-org', limit: 30, windowMs: DAY },
} as const satisfies Record<string, RateLimitRule>;
