/**
 * The public entry of a QR campaign: /q/<short code> (app/q/[code]/route.ts, #503)
 *
 * The QR code of a campaign holds /q/<code>. The entry finds the campaign by its code and sends
 * the visitor to the campaign's diagnosis with the campaign's UTM parameters and its own short
 * code (QR_CODE_PARAM in types.ts, #700: the diagnosis keeps it with the answer, and a new lead
 * counts for the campaign). Where it sends is built from the campaign row and the app's own
 * routes only, never from the request, and the organization is the campaign's. A paused,
 * expired or unknown code is not found, and so is a campaign with nowhere of its own to send to
 * (#663: openCampaignDestination).
 *
 * The settings page shows where a scan of each campaign goes with the same functions
 * (campaignDestination, #692, #695), so the page and the entry cannot disagree.
 *
 * Before #503 the codes were put under /d/, the public page of builder diagnoses, which looks
 * up slugs: a code never opened its campaign, and a code that read like a slug could open
 * another organization's diagnosis.
 */
import type { db as defaultDb } from '@/lib/db/client';
import { diagnoses, diagnosisVersions, qrCampaigns } from '@/lib/db/schema';
import { type Locale, defaultLocale } from '@/lib/i18n/config';
import { isDiagnosisOrganization } from '@/lib/multi-tenant/helpers/diagnosis-organization';
import { and, eq, inArray, isNotNull, ne, notExists, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  QR_CODE_PARAM,
  type QrCampaignClosedReason,
  type QrCampaignDestination,
  SHORT_CODE_PATTERN,
} from './types';

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
  /** The campaign's short code as stored, which the entry passes on to the diagnosis (#700) */
  shortCode: string;
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

/** A campaign has expired from its end on (expires_at); one without an end never does */
export function isCampaignExpired(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && expiresAt.getTime() <= now.getTime();
}

/** A campaign answers scans while it is active and has not expired */
export function isCampaignOpen(
  campaign: { isActive: boolean; expiresAt: Date | null },
  now: Date
): boolean {
  return campaign.isActive && !isCampaignExpired(campaign.expiresAt, now);
}

/** A builder diagnosis as /d/<slug> serves it */
export interface ServedDiagnosis {
  id: string;
  slug: string;
}

/** What decides where a scan of a campaign goes, besides the campaign row */
export interface DestinationFacts {
  /**
   * resolveDiagnosisOrganizationId(): the organization the AX diagnosis makes its leads in, or
   * null when none is configured
   */
  diagnosisOrganizationId: string | null;
  /**
   * What /d/<slug> serves for the slug of the diagnosis the campaign names: findPublicDiagnosis
   * at the entry, servedCampaignDiagnoses on the settings page. null when it serves none or the
   * campaign names no diagnosis of its organization
   */
  servedDiagnosis: ServedDiagnosis | null;
}

/**
 * Where the entry sends a scan of an open campaign (owner decisions in #663):
 * - a campaign that names a builder diagnosis (diagnosis_id): to /d/<slug> while that page
 *   serves this very diagnosis; nowhere while it does not (paused, archived, a draft, a slug two
 *   organizations publish, a diagnosis of another organization), never to another diagnosis
 * - a campaign that names none: to the AX diagnosis, only when the campaign is the AX
 *   organization's (isDiagnosisOrganization), whose leads the AX diagnosis makes; nowhere for
 *   another organization's, and for every campaign while no organization is configured
 */
export function openCampaignDestination(
  campaign: { organizationId: string; diagnosisId: string | null },
  facts: DestinationFacts
): QrCampaignDestination {
  if (campaign.diagnosisId) {
    // /d/<slug> serves a slug only while exactly one organization publishes it, so send there
    // only when it serves the diagnosis the campaign names
    const served = facts.servedDiagnosis;
    return served !== null && served.id === campaign.diagnosisId
      ? { kind: 'diagnosis', slug: served.slug }
      : { kind: 'none', reasons: ['diagnosis_not_published'] };
  }
  return isDiagnosisOrganization(campaign.organizationId, facts.diagnosisOrganizationId)
    ? { kind: 'ax_diagnosis' }
    : { kind: 'none', reasons: ['not_ax_organization'] };
}

/**
 * Where a scan of a campaign goes, for the settings page (#692, #695): the entry's own rule, a
 * campaign that is open (isCampaignOpen) sent where openCampaignDestination sends it. When it
 * goes nowhere, every reason that applies is listed, so the page can say all that has to change
 * (an expired campaign is expired also while its switch is on)
 */
export function campaignDestination(
  campaign: {
    isActive: boolean;
    expiresAt: Date | null;
    organizationId: string;
    diagnosisId: string | null;
  },
  facts: DestinationFacts,
  now: Date
): QrCampaignDestination {
  const reasons: QrCampaignClosedReason[] = [];
  if (!campaign.isActive) reasons.push('paused');
  if (isCampaignExpired(campaign.expiresAt, now)) reasons.push('expired');
  const open = openCampaignDestination(campaign, facts);
  if (open.kind === 'none') reasons.push(...open.reasons);
  return reasons.length > 0 ? { kind: 'none', reasons } : open;
}

/**
 * Of the diagnoses some campaigns of the organization name, the ones /d/<slug> serves, by id.
 * The rule of findPublicDiagnosis (lib/features/diagnosis-builder/public-diagnosis.ts, which this
 * feature does not import): a diagnosis of the organization in the `published` state with a
 * current version of its own, while no other diagnosis with the same slug is (slugs are unique
 * within an organization, so that is another organization's; /d/<slug> then serves neither).
 * One query for the whole list. Only the organization's diagnoses are read; the others are only
 * checked for the slug, which /d/<slug> shows to anyone. Checked against findPublicDiagnosis on
 * PostgreSQL in test/unit/integration/qr-campaign-destination.db.test.ts
 */
export async function servedCampaignDiagnoses(
  db: Executor,
  organizationId: string,
  diagnosisIds: readonly (string | null)[]
): Promise<Map<string, ServedDiagnosis>> {
  const ids = [...new Set(diagnosisIds.filter((id): id is string => id !== null))];
  if (ids.length === 0) return new Map();
  const other = alias(diagnoses, 'other_diagnosis');
  const otherVersion = alias(diagnosisVersions, 'other_diagnosis_version');
  const rows = await db
    .select({ id: diagnoses.id, slug: diagnoses.slug })
    .from(diagnoses)
    .innerJoin(
      diagnosisVersions,
      and(
        eq(diagnosisVersions.id, diagnoses.currentVersionId),
        eq(diagnosisVersions.organizationId, diagnoses.organizationId)
      )
    )
    .where(
      and(
        eq(diagnoses.organizationId, organizationId),
        inArray(diagnoses.id, ids),
        eq(diagnoses.status, 'published'),
        isNotNull(diagnoses.currentVersionId),
        notExists(
          db
            .select({ one: sql`1` })
            .from(other)
            .innerJoin(
              otherVersion,
              and(
                eq(otherVersion.id, other.currentVersionId),
                eq(otherVersion.organizationId, other.organizationId)
              )
            )
            .where(
              and(
                eq(other.slug, diagnoses.slug),
                ne(other.id, diagnoses.id),
                eq(other.status, 'published'),
                isNotNull(other.currentVersionId)
              )
            )
        )
      )
    );
  return new Map(rows.map((row) => [row.id, { id: row.id, slug: row.slug }]));
}

/**
 * Where a scan of each of the organization's campaigns goes (campaignDestination), in the order
 * given, for the settings page. One query for the diagnoses they name (servedCampaignDiagnoses)
 */
export async function destinationsOfCampaigns(
  db: Executor,
  organizationId: string,
  campaigns: readonly {
    isActive: boolean;
    expiresAt: Date | null;
    organizationId: string;
    diagnosisId: string | null;
  }[],
  diagnosisOrganizationId: string | null,
  now: Date = new Date()
): Promise<QrCampaignDestination[]> {
  const served = await servedCampaignDiagnoses(
    db,
    organizationId,
    campaigns.map((campaign) => campaign.diagnosisId)
  );
  return campaigns.map((campaign) =>
    campaignDestination(
      campaign,
      {
        diagnosisOrganizationId,
        servedDiagnosis: campaign.diagnosisId ? (served.get(campaign.diagnosisId) ?? null) : null,
      },
      now
    )
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
      shortCode: qrCampaigns.shortCode,
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
    shortCode: row.shortCode,
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
 * builder diagnosis when `publishedSlug` is given (openCampaignDestination has checked that
 * /d/<slug> serves that diagnosis), otherwise the AX diagnosis, where /diagnostic/[slug] sends
 * too (only a campaign of the AX organization that names no diagnosis, #663). With the
 * campaign's UTM parameters (empty ones are left out) and its short code (QR_CODE_PARAM, #700),
 * both from the campaign row: a code or a UTM value sent with the scan never gets in.
 */
export function qrEntryRedirectPath(
  campaign: { shortCode: string; utm: CampaignUtm },
  publishedSlug: string | null,
  locale: Locale = defaultLocale
): string {
  const page = publishedSlug ? `d/${encodeURIComponent(publishedSlug)}` : 'ax-diagnosis';
  const { utm } = campaign;
  const query = new URLSearchParams();
  const params: [string, string | null][] = [
    ['utm_source', utm.source],
    ['utm_medium', utm.medium],
    ['utm_campaign', utm.campaign],
    ['utm_content', utm.content],
    [QR_CODE_PARAM, campaign.shortCode],
  ];
  for (const [key, value] of params) {
    if (value) query.set(key, value);
  }
  const search = query.toString();
  return `/${locale}/${page}${search ? `?${search}` : ''}`;
}
