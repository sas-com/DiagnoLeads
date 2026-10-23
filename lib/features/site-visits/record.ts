import type { db as defaultDb } from '@/lib/db/client';
import { siteVisits } from '@/lib/db/schema';
import { findPublicDiagnosis } from '@/lib/features/diagnosis-builder/public-diagnosis';
import {
  resolveDefaultOrganizationId,
  resolveDiagnosisOrganizationId,
} from '@/lib/features/diagnostics/organization';
import { consumeRateLimit } from '@/lib/features/diagnostics/rate-limit';
import type { SitePage } from './pages';
import { type SiteVisitParams, deviceOf } from './request';
import { daySalt, visitDayOf, visitorHashOf } from './visitor';

type Database = typeof defaultDb;

/**
 * Views one visitor can record per window; more are dropped, so a script cannot fill the table.
 * Counted by the visitor hash (no IP address in the rate limit table either)
 */
export const SITE_VISIT_RATE_LIMIT = { name: 'site-visit', limit: 120, windowMs: 10 * 60 * 1000 };

/** The organization whose site the page is, decided on the server (never sent by the page) */
export async function organizationOfPage(db: Database, page: SitePage): Promise<string | null> {
  switch (page.owner.kind) {
    case 'ax':
      return resolveDiagnosisOrganizationId();
    case 'default':
      return resolveDefaultOrganizationId();
    case 'diagnosis':
      return (await findPublicDiagnosis(db, page.owner.slug))?.organizationId ?? null;
  }
}

export type RecordResult = 'recorded' | 'no_organization' | 'rate_limited';

/** Record one view of a measured page */
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
  const organizationId = await organizationOfPage(db, input.page);
  if (!organizationId) return 'no_organization';

  const now = input.now ?? new Date();
  const day = visitDayOf(now);
  const salt = await daySalt(db, day);
  const visitorHash = visitorHashOf({
    salt,
    organizationId,
    ip: input.ip,
    userAgent: input.userAgent,
  });

  const limit = await consumeRateLimit(db, SITE_VISIT_RATE_LIMIT, visitorHash, now);
  if (!limit.allowed) return 'rate_limited';

  await db.insert(siteVisits).values({
    organizationId,
    path: input.page.path,
    pageType: input.page.pageType,
    referrerHost: input.referrerHost,
    ...input.params,
    device: deviceOf(input.userAgent),
    visitorHash,
    day,
  });
  return 'recorded';
}
