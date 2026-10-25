import type { RateLimitRule } from '../diagnostics/rate-limit';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * Limits of the public endpoints of builder diagnoses (/api/diagnoses/[slug]/...), kept in the
 * DB like the AX ones. Same sizes and rules as the AX diagnosis (#481). There is no limit per
 * diagnosis or organization on submissions: a flood must not shut the form for real respondents
 * (the notifications have their own cap, see notify.ts; sales emails count with the AX diagnosis
 * in SALES_EMAIL_LIMITS).
 */
export const DIAGNOSIS_RATE_LIMITS = {
  submitPerIp: { name: 'dx-submit-ip', limit: 30, windowMs: HOUR },
  submitPerIpDaily: { name: 'dx-submit-ip-day', limit: 100, windowMs: DAY },
  submitPerEmail: { name: 'dx-submit-email', limit: 6, windowMs: HOUR },
  consultationPerIp: { name: 'dx-consultation-ip', limit: 10, windowMs: HOUR },
  /** Sales notifications per organization and hour (in-app, webhooks and email) */
  notificationsPerOrganization: { name: 'dx-notify-org', limit: 100, windowMs: HOUR },
  /** Past the limit above, consultation requests are still notified up to this cap (#232) */
  consultationNotificationsPerOrganization: {
    name: 'dx-notify-consultation-org',
    limit: 300,
    windowMs: HOUR,
  },
} as const satisfies Record<string, RateLimitRule>;
