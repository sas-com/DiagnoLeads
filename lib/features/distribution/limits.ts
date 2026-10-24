const MINUTE = 60 * 1000;

/**
 * Limits of the public QR entry (/q/<code>, #503), counted in the DB like the other public
 * endpoints so they hold across server instances (decision 2026-10-11-public-form-protection).
 * The in-memory limit in the middleware stays in front, but it counts each code separately.
 *
 * Each rule has the shape of RateLimitRule (lib/features/diagnostics/rate-limit.ts), written out
 * rather than imported: this feature reads no other feature, which keeps it out of their import
 * cycles. The entry passes the rules to consumeRateLimit, which checks the shape.
 */
export const QR_ENTRY_RATE_LIMITS = {
  /**
   * Codes one address can open. Loose: people at one event can share an address (the venue's
   * Wi-Fi, a mobile carrier's NAT). A short code is one of 55^8 values, so the limit is there
   * to bound the lookups one address can make, not to stop guessing
   */
  perIp: { name: 'qr-entry-ip', limit: 120, windowMs: 10 * MINUTE },
} as const satisfies Record<string, { name: string; limit: number; windowMs: number }>;
