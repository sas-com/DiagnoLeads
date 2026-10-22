/**
 * Test sends allowed from the settings page (#321), counted from the stored test deliveries:
 * shared by every server instance, unlike the in-memory limit in the middleware. Kept apart from
 * the delivery service so the settings page can show the numbers.
 */
export const WEBHOOK_TEST_SEND_LIMITS = {
  perOrganization: { limit: 10, windowMs: 60 * 60 * 1000 },
  perWebhook: { limit: 3, windowMs: 10 * 60 * 1000 },
} as const;
