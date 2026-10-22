import type { RateLimitRule } from '@/lib/features/diagnostics/rate-limit';

const HOUR = 60 * 60 * 1000;

/**
 * Limits of the public respondent mail endpoints (#154), kept in the DB like AX_RATE_LIMITS so
 * they hold across server instances. The in-memory limit in the middleware stays in front.
 */
export const RESPONDENT_EMAIL_RATE_LIMITS = {
  /** The button of the unsubscribe page: one person stops a mail or two */
  unsubscribePerIp: { name: 'email-unsubscribe-ip', limit: 60, windowMs: HOUR },
  /**
   * RFC 8058 one-click POSTs come from the servers of mail providers, so one address speaks for
   * many recipients. Loose, so that real unsubscribes are not refused; respondent mail itself is
   * capped per organization far below it
   */
  oneClickPerIp: { name: 'email-unsubscribe-one-click-ip', limit: 300, windowMs: HOUR },
} as const satisfies Record<string, RateLimitRule>;
