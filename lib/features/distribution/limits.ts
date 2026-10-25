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
   * Wi-Fi, a mobile carrier's NAT), and they scan in the first minutes. Twice the largest event
   * a QR code is handed out at, 100 people (owner decision in #663); the in-memory limit of
   * proxy.ts ('/q/' in lib/middleware/rate-limit.ts) allows as many a minute. A short code is
   * one of 55^8 values, so the limit is there to bound the lookups one address can make, not to
   * stop guessing
   */
  perIp: { name: 'qr-entry-ip', limit: 200, windowMs: 10 * MINUTE },
} as const satisfies Record<string, { name: string; limit: number; windowMs: number }>;

/**
 * Scans one campaign can record a day (in Japan), counted per campaign and day by the entry
 * before each record (#41). The limit per address does not hold against many addresses reading a
 * code printed on a poster, so past this cap scans are still sent on but no longer written for
 * the rest of the day, and the people on call are told once; the page views have the same kind
 * of cap (decision 2026-10-23-site-visit-measurement). Per campaign, so a flood on one code does
 * not stop the counts of the organization's other campaigns. Twenty times the largest event a QR
 * code is handed out at (100 people, owner decision in #663)
 */
export const QR_SCAN_DAILY_CAP = {
  name: 'qr-scan-campaign-day',
  limit: 2_000,
  windowMs: 24 * 60 * MINUTE,
} as const satisfies { name: string; limit: number; windowMs: number };

/**
 * What a visitor over a limit of the QR entry reads, both the DB limit (app/q/[code]/route.ts)
 * and the in-memory one (proxy.ts): the phone that scanned the code shows the body as it is, so
 * it is one line of plain text, not JSON. In Japanese only, like the page the entry sends to
 * (/ja/…): the entry has no locale of its own
 */
export const QR_ENTRY_TOO_MANY_REQUESTS_TEXT =
  'アクセスが集中しています。しばらくしてから、もう一度 QR コードを読み取ってください。';
