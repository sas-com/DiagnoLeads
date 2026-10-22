import type { RateLimitRule } from '../../diagnostics/rate-limit';

/**
 * Test sends allowed from the settings page (#321). Kept apart from the delivery service so the
 * settings page can show the numbers.
 *
 * - perWebhook: counted from the stored test deliveries of the webhook (they go with it when it
 *   is deleted, which only resets this webhook's own count)
 * - perOrganization, perUser: counted in `public_rate_limits` (fixed windows that start with the
 *   first send), so deleting and recreating webhooks, or creating more organizations, does not
 *   reset them. perUser counts across every organization of the user.
 */
export const WEBHOOK_TEST_SEND_LIMITS = {
  perWebhook: { limit: 3, windowMs: 10 * 60 * 1000 },
  perOrganization: {
    name: 'webhook-test-org',
    limit: 10,
    windowMs: 60 * 60 * 1000,
  } satisfies RateLimitRule,
  perUser: {
    name: 'webhook-test-user',
    limit: 20,
    windowMs: 60 * 60 * 1000,
  } satisfies RateLimitRule,
} as const;

export type WebhookTestSendLimit = keyof typeof WEBHOOK_TEST_SEND_LIMITS;
