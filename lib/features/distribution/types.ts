import { z } from 'zod';

/**
 * Path of the public entry of a QR campaign: /q/<short code> (app/q/[code]/route.ts, #503).
 * Not /d/: that is the public page of builder diagnoses, which looks up slugs, not short codes
 */
export const QR_ENTRY_PATH = '/q';

/**
 * What a short code can be before the database is asked. generateShortCode makes 8 letters and
 * digits; codes are compared case-sensitively ("AbC" and "abc" are different codes)
 */
export const SHORT_CODE_PATTERN = /^[A-Za-z0-9]{1,64}$/;

/**
 * The query parameter the /q/ entry adds to the address of the diagnosis: the campaign's own
 * short code, from the campaign row (#700, owner decision of 2026-10-25). The diagnosis reads it
 * with the UTM values (readTrackingParams, components/features/diagnosis-runner/tracking-params.ts,
 * which drops what cannot be a code) and keeps it in tracking (trackingSchema), and a submission
 * that creates a lead counts for the campaign of the lead's organization with that code
 * (countCampaignCompletion, service.ts). Here, not in short-code-entry.ts, so the browser reads
 * the same name without the entry's database code
 */
export const QR_CODE_PARAM = 'qr';

/** The two counts of a campaign row the new-lead rate is made of */
export interface CampaignLeadCounts {
  /** The scans the /q/ entry recorded (qr_campaigns.scan_count) */
  scanCount: number;
  /** The new leads the diagnoses counted by the short code (qr_campaigns.completion_count) */
  completionCount: number;
}

/**
 * The new-lead rate of a QR campaign (新規リード率, #700): its new leads over its scans, in
 * percent with one decimal. Both counts come from the campaign row, so the rate and the totals
 * never come from different places. The one rule for the settings page and getCampaignStats
 * (owner decisions of 2026-10-26 on #700):
 * - null for a campaign without scans: the rate cannot be computed, and the page shows "—"
 *   rather than 0% (also when it has new leads)
 * - not capped at 100: a new lead counts by the code in the address of the diagnosis, also when
 *   its scan was not recorded (past the daily cap, a User-Agent judged a bot) or the address was
 *   passed on, so more new leads than scans show as over 100
 */
export function campaignNewLeadRate({
  scanCount,
  completionCount,
}: CampaignLeadCounts): number | null {
  if (scanCount <= 0) return null;
  return Math.round((completionCount / scanCount) * 1000) / 10;
}

/**
 * Why a scan of a campaign goes nowhere: the /q/ entry answers 404 (#692, #695). In the order the
 * settings page lists them. A paused or expired campaign is not found at all; a campaign that
 * names no diagnosis goes to the AX diagnosis only when it is the AX organization's; a campaign
 * that names a diagnosis goes there only while /d/<slug> serves it (owner decisions in #663)
 */
export const QR_CAMPAIGN_CLOSED_REASONS = [
  'paused',
  'expired',
  'not_ax_organization',
  'diagnosis_not_published',
] as const;

export type QrCampaignClosedReason = (typeof QR_CAMPAIGN_CLOSED_REASONS)[number];

/**
 * Where a scan of a campaign goes (campaignDestination in short-code-entry.ts, the entry's own
 * rule): the AX diagnosis, the public page of the campaign's builder diagnosis (/d/<slug>), or
 * nowhere, with every reason that applies
 */
export type QrCampaignDestination =
  | { kind: 'ax_diagnosis' }
  | { kind: 'diagnosis'; slug: string }
  | { kind: 'none'; reasons: QrCampaignClosedReason[] };

/**
 * The utm_medium a QR campaign is created with: where its code is handed out, in the order the
 * create form lists them (#788, owner decision of 2026-10-26 on #788). Each maps to an existing
 * 流入元 in MEDIUM_TO_INFLOW (diagnostics/tracking.ts, whose type requires every one of them), so
 * the new leads from the scans are never left 未設定; INFLOW_SOURCES gets no new value.
 * - seminar: a seminar or a webinar → seminar
 * - exhibition: an exhibition (trade show) → seminar
 * - direct_mail: a direct mail, posted or handed out one by one → advertising. Not `dm`: other
 *   campaigns use dm for an email or a message, which stays an unknown medium
 */
export const QR_CAMPAIGN_MEDIUMS = ['seminar', 'exhibition', 'direct_mail'] as const;
export type QrCampaignMedium = (typeof QR_CAMPAIGN_MEDIUMS)[number];

/**
 * The medium of a campaign created without one, on the form and in the API. It replaced
 * 'offline' (#788), which maps to no 流入元
 */
export const DEFAULT_QR_CAMPAIGN_MEDIUM: QrCampaignMedium = 'seminar';

/**
 * QR Code Campaign Schema (for tracking)
 */
export const createQRCampaignSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  diagnosticTemplateId: z.string().uuid(),
  utmSource: z.string().max(50).default('qrcode'),
  // Any medium, as before #788: the form offers QR_CAMPAIGN_MEDIUMS only, and the campaigns
  // created before keep theirs ('offline', or what was typed), which the entry passes on as is
  utmMedium: z.string().max(50).default(DEFAULT_QR_CAMPAIGN_MEDIUM),
  utmCampaign: z.string().max(100).optional(),
  utmContent: z.string().max(100).optional(),
  expiresAt: z.string().datetime().optional(),
});

export type CreateQRCampaignInput = z.infer<typeof createQRCampaignSchema>;

/**
 * QR Code Campaign Response
 */
export interface QRCampaign {
  id: string;
  name: string;
  description?: string;
  diagnosticTemplateId: string;
  shortCode: string;
  trackingUrl: string;
  qrCodeDataUrl: string;
  scanCount: number;
  completionCount: number;
  isActive: boolean;
  expiresAt?: Date;
  createdAt: Date;
}

/**
 * QR Code Scan Event
 */
export interface QRScanEvent {
  campaignId: string;
  scannedAt: Date;
  ipAddressHash?: string;
  userAgent?: string;
  deviceType?: 'mobile' | 'tablet' | 'desktop';
  location?: {
    country?: string;
    city?: string;
  };
}
