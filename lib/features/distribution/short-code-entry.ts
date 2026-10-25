/**
 * The public entry of a QR campaign: /q/<short code> (app/q/[code]/route.ts, #503)
 *
 * The QR code of a campaign holds /q/<code>. The entry finds the campaign by its code and sends
 * the visitor to the campaign's diagnosis with the campaign's UTM parameters. Where it sends is
 * built from the campaign row and the app's own routes only, never from the request, and the
 * organization is the campaign's. A paused, expired or unknown code is not found, and so is a
 * campaign with nowhere of its own to send to (#663: see app/q/[code]/route.ts).
 *
 * Before #503 the codes were put under /d/, the public page of builder diagnoses, which looks
 * up slugs: a code never opened its campaign, and a code that read like a slug could open
 * another organization's diagnosis.
 */
import type { db as defaultDb } from '@/lib/db/client';
import { diagnoses, qrCampaigns } from '@/lib/db/schema';
import { type Locale, defaultLocale } from '@/lib/i18n/config';
import { and, eq } from 'drizzle-orm';
import { SHORT_CODE_PATTERN } from './types';

type Database = typeof defaultDb;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Transaction;

/** The UTM parameters stored on a campaign, passed on to the diagnosis */
export interface CampaignUtm {
  source: string;
  medium: string;
  campaign: string | null;
  content: string | null;
}

/** An open campaign as the entry needs it */
export interface QrEntryCampaign {
  campaignId: string;
  organizationId: string;
  /**
   * qr_campaigns.diagnosis_id as stored: set when the campaign names a builder diagnosis, also
   * one that `diagnosis` leaves out. A campaign that names one is sent there or nowhere (#663)
   */
  diagnosisId: string | null;
  /**
   * The builder diagnosis the campaign names, when it belongs to the campaign's organization;
   * whether it is published is up to the caller (findPublicDiagnosis)
   */
  diagnosis: { id: string; slug: string } | null;
  utm: CampaignUtm;
}

/** A campaign answers scans while it is active and has not expired */
export function isCampaignOpen(
  campaign: { isActive: boolean; expiresAt: Date | null },
  now: Date
): boolean {
  return (
    campaign.isActive &&
    (campaign.expiresAt === null || campaign.expiresAt.getTime() > now.getTime())
  );
}

/**
 * The open campaign with this short code, or null. Codes are compared case-sensitively (text
 * equality in PostgreSQL), so "AbCd2345" never finds "abcd2345".
 */
export async function findOpenQrCampaign(
  db: Executor,
  code: string,
  now: Date = new Date()
): Promise<QrEntryCampaign | null> {
  if (!SHORT_CODE_PATTERN.test(code)) return null;
  const [row] = await db
    .select({
      id: qrCampaigns.id,
      organizationId: qrCampaigns.organizationId,
      isActive: qrCampaigns.isActive,
      expiresAt: qrCampaigns.expiresAt,
      utmSource: qrCampaigns.utmSource,
      utmMedium: qrCampaigns.utmMedium,
      utmCampaign: qrCampaigns.utmCampaign,
      utmContent: qrCampaigns.utmContent,
      namedDiagnosisId: qrCampaigns.diagnosisId,
      diagnosisId: diagnoses.id,
      diagnosisSlug: diagnoses.slug,
    })
    .from(qrCampaigns)
    // Only a diagnosis of the campaign's own organization
    .leftJoin(
      diagnoses,
      and(
        eq(diagnoses.id, qrCampaigns.diagnosisId),
        eq(diagnoses.organizationId, qrCampaigns.organizationId)
      )
    )
    .where(eq(qrCampaigns.shortCode, code))
    .limit(1);
  if (!row || !isCampaignOpen(row, now)) return null;

  return {
    campaignId: row.id,
    organizationId: row.organizationId,
    diagnosisId: row.namedDiagnosisId,
    diagnosis:
      row.diagnosisId && row.diagnosisSlug
        ? { id: row.diagnosisId, slug: row.diagnosisSlug }
        : null,
    utm: {
      source: row.utmSource,
      medium: row.utmMedium,
      campaign: row.utmCampaign,
      content: row.utmContent,
    },
  };
}

/**
 * Where the entry sends the visitor, as a path of this app: the public page of the campaign's
 * builder diagnosis when `publishedSlug` is given (the caller has checked that /d/<slug> serves
 * that diagnosis), otherwise the AX diagnosis, where /diagnostic/[slug] sends too (the caller
 * sends there only a campaign of the AX organization that names no diagnosis, #663). With the
 * campaign's UTM parameters; empty ones are left out.
 */
export function qrEntryRedirectPath(
  utm: CampaignUtm,
  publishedSlug: string | null,
  locale: Locale = defaultLocale
): string {
  const page = publishedSlug ? `d/${encodeURIComponent(publishedSlug)}` : 'ax-diagnosis';
  const query = new URLSearchParams();
  const params: [string, string | null][] = [
    ['utm_source', utm.source],
    ['utm_medium', utm.medium],
    ['utm_campaign', utm.campaign],
    ['utm_content', utm.content],
  ];
  for (const [key, value] of params) {
    if (value) query.set(key, value);
  }
  const search = query.toString();
  return `/${locale}/${page}${search ? `?${search}` : ''}`;
}
