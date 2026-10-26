import { clipText, toWellFormed } from '@/lib/utils/clip-text';
import { z } from 'zod';
import { isAxFrom } from '../ax-site/cross-links';
import { SHORT_CODE_PATTERN } from '../distribution/types';
import type { InflowSource } from '../leads/types/pipeline';
import { AX_ENTRY_PAGES } from './entry-pages';

/**
 * Tracking parameters captured on the landing page.
 * `ref` is a referral code given to partners / referrers (紹介元).
 * `agency` is the code of a sales agency link (#147); the server looks it up, so a code that is
 * unknown or disabled attributes nothing.
 * `entry` is the page the diagnosis was started from (#296); a value outside the list is dropped.
 * `from` is the link of another AX page that led to it (#332, "ax-lp-targets-access"); likewise
 * only the values the site writes are kept.
 * `qr` is the short code of the QR campaign whose code was scanned: the /q/ entry adds it to the
 * address of the diagnosis (#700). Only what can be a code is kept (SHORT_CODE_PATTERN, as the
 * entry checks it); a submission that creates a lead counts for the campaign of the lead's
 * organization with that code (countQrCompletion, service.ts).
 */
/**
 * Long values are cut instead of rejected so a long UTM never blocks a submission. The cut never
 * splits a character, and a lone surrogate sent on purpose becomes U+FFFD: tracking is stored as
 * jsonb, which rejects lone surrogates and would lose the whole submission (#754).
 */
const clipped = (max: number) =>
  z
    .string()
    .transform((value) => toWellFormed(clipText(value, max)))
    .optional();

export const trackingSchema = z
  .object({
    utmSource: clipped(200),
    utmMedium: clipped(200),
    utmCampaign: clipped(200),
    utmContent: clipped(200),
    utmTerm: clipped(200),
    ref: clipped(100),
    agency: clipped(40),
    referrer: clipped(500),
    landingPath: clipped(500),
    entry: z.enum(AX_ENTRY_PAGES).optional().catch(undefined),
    from: z.string().refine(isAxFrom).optional().catch(undefined),
    qr: z.string().regex(SHORT_CODE_PATTERN).optional().catch(undefined),
  })
  .default({});
export type Tracking = z.infer<typeof trackingSchema>;

const MEDIUM_TO_INFLOW: Record<string, InflowSource> = {
  cpc: 'advertising',
  ppc: 'advertising',
  paid: 'advertising',
  paid_search: 'advertising',
  paid_social: 'advertising',
  display: 'advertising',
  ads: 'advertising',
  retargeting: 'advertising',
  seminar: 'seminar',
  webinar: 'seminar',
  event: 'seminar',
  referral: 'referral_partner',
  partner: 'referral_partner',
  customer: 'existing_customer',
  existing_customer: 'existing_customer',
  executive: 'executive_network',
  organic: 'lp_organic',
  // Outsourced sales (#147): campaigns sent by an agency without an issued agency link
  telemarketing: 'telemarketing_agency',
  teleapo: 'telemarketing_agency',
  outbound_call: 'telemarketing_agency',
  referral_agency: 'referral_agency',
};

const AGENCY_INFLOWS: ReadonlySet<InflowSource> = new Set([
  'telemarketing_agency',
  'referral_agency',
]);

export interface InferredInflow {
  inflowSource: InflowSource | null;
  referrerName: string | null;
  agencyName: string | null;
}

/**
 * Infer the 流入元 of a lead from tracking parameters (an issued agency link is resolved by the
 * caller and takes precedence over this).
 * - utm_medium of a sales agency → that agency channel; a referral code is kept as the agency
 *   name for sales to confirm, never as 紹介元
 * - referral code → 紹介・パートナー（the code is kept as 紹介元 for sales to confirm）
 * - known utm_medium → mapped channel
 * - no campaign parameters at all → LP（自然検索）
 * - unknown utm_medium (email, dm, form, ...) → null, so outbound campaigns are not
 *   mixed into organic traffic; sales sets the right value
 */
export function inferInflowSource(tracking: Tracking): InferredInflow {
  const ref = tracking.ref?.trim() || null;
  const medium = tracking.utmMedium?.trim().toLowerCase();
  const mapped = medium ? (MEDIUM_TO_INFLOW[medium] ?? null) : null;
  if (mapped && AGENCY_INFLOWS.has(mapped)) {
    return { inflowSource: mapped, referrerName: null, agencyName: ref };
  }
  if (ref) {
    return { inflowSource: 'referral_partner', referrerName: ref, agencyName: null };
  }
  if (!medium) {
    return { inflowSource: 'lp_organic', referrerName: null, agencyName: null };
  }
  return { inflowSource: mapped, referrerName: null, agencyName: null };
}

/** Drop empty values so only meaningful tracking is stored */
export function compactTracking(tracking: Tracking): Record<string, string> {
  return Object.fromEntries(
    Object.entries(tracking).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim() !== ''
    )
  );
}
