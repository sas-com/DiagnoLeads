import type { RateLimitRule } from '../rate-limit';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * Limits of the public AX diagnosis endpoints, kept in the DB so they hold across server
 * instances. The in-memory limit in the middleware stays in front of them.
 */
export const AX_RATE_LIMITS = {
  /** Diagnosing a few systems in one visit is normal; dozens from one address are not */
  submitPerIp: { name: 'ax-submit-ip', limit: 10, windowMs: HOUR },
  submitPerEmail: { name: 'ax-submit-email', limit: 6, windowMs: HOUR },
  /**
   * Circuit breaker for the receiving organization: caps the leads and sales notifications a
   * flood of addresses could create in an hour
   */
  submitPerOrganization: { name: 'ax-submit-org', limit: 100, windowMs: HOUR },
  consultationPerIp: { name: 'ax-consultation-ip', limit: 10, windowMs: HOUR },
  detailsPerIp: { name: 'ax-details-ip', limit: 20, windowMs: HOUR },
  /**
   * Sales emails per organization and day. The sending quota is shared with the sign-in emails
   * (password reset), so requests must not be able to use it up; past the limit sales still
   * get the in-app notification
   */
  salesEmailPerOrganization: { name: 'ax-sales-email-org', limit: 30, windowMs: DAY },
} as const satisfies Record<string, RateLimitRule>;
