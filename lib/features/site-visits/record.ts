import type { db as defaultDb } from '@/lib/db/client';
import { siteVisits } from '@/lib/db/schema';
import { getColumn } from '@/lib/features/ax-site/columns';
import { findPublicDiagnosis } from '@/lib/features/diagnosis-builder/public-diagnosis';
import { resolveDiagnosisOrganizationId } from '@/lib/features/diagnostics/organization';
import {
  type RateLimitRule,
  consumeRateLimit,
  consumeRateLimits,
} from '@/lib/features/diagnostics/rate-limit';
import { ipBlock } from '@/lib/features/diagnostics/request-guard';
import type { SitePage } from './pages';
import { type SiteVisitParams, deviceOf } from './request';
import { daySalt, rateLimitIdentityOf, visitDayOf, visitorHashOf } from './visitor';

type Database = typeof defaultDb;

const WINDOW_MS = 10 * 60 * 1000;

/**
 * Views one address can record per window; more are dropped, so a script cannot fill the table.
 * IPv4 counts by the address, IPv6 by its /64. Counted by a hash of the day's salt and the
 * address block, not the address itself, so the rate limit table holds nothing that can be
 * matched across days either
 */
export const SITE_VISIT_RATE_LIMIT = {
  name: 'site-visit',
  limit: 120,
  windowMs: WINDOW_MS,
} as const satisfies RateLimitRule;

/**
 * IPv6 views per /48 and window, counted before the /64: one /48 holds 65,536 /64s, so the limit
 * per /64 alone can be rotated around, and a view the /48 refuses must not add a row for a new
 * /64 to the rate limit table. Loose enough for a company network handing out /64s
 */
export const SITE_VISIT_RATE_LIMIT_48 = {
  name: 'site-visit-48',
  limit: 600,
  windowMs: WINDOW_MS,
} as const satisfies RateLimitRule;

/**
 * Views one organization can record a day (in Japan). Past it views are not written for the rest
 * of the day and the people on call are told once, so a flood from many addresses cannot fill
 * the table. Far above what the public pages draw today; only the measurement stops at it, never
 * a page or a form
 */
export const SITE_VISIT_DAILY_CAP = {
  name: 'site-visit-org-day',
  limit: 10_000,
  windowMs: 24 * 60 * 60 * 1000,
} as const satisfies RateLimitRule;

/** The /48 of an IPv6 /64 block ('2001:0db8:0001:0002::/64' → '2001:0db8:0001::/48') */
function block48Of(block64: string): string | null {
  if (!block64.endsWith('::/64')) return null;
  return `${block64.split(':').slice(0, 3).join(':')}::/48`;
}

/**
 * The address limits of one view, in the order they are counted. For IPv6 the /48 comes first,
 * so rotating /64s within a refused /48 writes nothing new: the rows of the rate limit table
 * stay bounded by the views each /48 is allowed. The cost is that one /64 sending past its own
 * limit also uses up the /48 for the window; only the measurement stops there
 */
export function addressLimitsOf(salt: string, ip: string) {
  const block = ipBlock(ip);
  const block48 = block48Of(block);
  const perBlock = { rule: SITE_VISIT_RATE_LIMIT, identifier: rateLimitIdentityOf(salt, block) };
  if (!block48) return [perBlock];
  return [
    { rule: SITE_VISIT_RATE_LIMIT_48, identifier: rateLimitIdentityOf(salt, block48) },
    perBlock,
  ];
}

/** The organization whose site the page is, decided on the server (never sent by the page) */
export async function organizationOfPage(db: Database, page: SitePage): Promise<string | null> {
  switch (page.owner.kind) {
    case 'operator':
      return resolveDiagnosisOrganizationId();
    case 'diagnosis':
      return (await findPublicDiagnosis(db, page.owner.slug))?.organizationId ?? null;
  }
}

/**
 * 'daily_cap_reached' is the one view that went past the organization's cap (for the alert);
 * the views after it are 'daily_cap'
 */
export type RecordResult =
  | 'recorded'
  | 'unknown_page'
  | 'no_organization'
  | 'rate_limited'
  | 'daily_cap_reached'
  | 'daily_cap';

/**
 * Record one view of a measured page. The cheap refusals come first: the day's salt is kept by
 * the server, so a view refused by the address limits costs one or two writes of the rate limit
 * table and nothing else (no diagnosis lookup, no view)
 */
export async function recordSiteVisit(
  db: Database,
  input: {
    page: SitePage;
    params: SiteVisitParams;
    referrerHost: string | null;
    /** Empty when the address cannot be trusted (not on Vercel) */
    ip: string;
    userAgent: string;
    now?: Date;
  }
): Promise<RecordResult> {
  // A column that does not exist is not a page: made-up slugs cannot add paths
  if (input.page.columnSlug !== undefined && !getColumn(input.page.columnSlug)) {
    return 'unknown_page';
  }

  const now = input.now ?? new Date();
  const day = visitDayOf(now);
  const salt = await daySalt(db, day);

  // Without a trusted address (not on Vercel) there is nothing to count by: only the cap applies
  if (input.ip) {
    const limit = await consumeRateLimits(db, addressLimitsOf(salt, input.ip), now);
    if (!limit.allowed) return 'rate_limited';
  }

  const organizationId = await organizationOfPage(db, input.page);
  if (!organizationId) return 'no_organization';

  // Counted atomically, so exactly one view sees limit + 1 and the alert goes out once a day
  const cap = await consumeRateLimit(db, SITE_VISIT_DAILY_CAP, `${organizationId}:${day}`, now);
  if (!cap.allowed) {
    if (cap.count !== SITE_VISIT_DAILY_CAP.limit + 1) return 'daily_cap';
    console.warn('Site visits reached the daily cap; no more are recorded today', {
      organizationId,
      day,
    });
    return 'daily_cap_reached';
  }

  await db.insert(siteVisits).values({
    organizationId,
    path: input.page.path,
    pageType: input.page.pageType,
    referrerHost: input.referrerHost,
    ...input.params,
    device: deviceOf(input.userAgent),
    visitorHash: visitorHashOf({ salt, organizationId, ip: input.ip, userAgent: input.userAgent }),
    day,
  });
  return 'recorded';
}
