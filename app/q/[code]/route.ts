import { db } from '@/lib/db/client';
import { findPublicDiagnosis } from '@/lib/features/diagnosis-builder/public-diagnosis';
import { resolveDiagnosisOrganizationId } from '@/lib/features/diagnostics/organization';
import { consumeRateLimit } from '@/lib/features/diagnostics/rate-limit';
import { clientIp, ipBlock } from '@/lib/features/diagnostics/request-guard';
import {
  QR_ENTRY_RATE_LIMITS,
  QR_ENTRY_TOO_MANY_REQUESTS_TEXT,
  QR_SCAN_DAILY_CAP,
} from '@/lib/features/distribution/limits';
import { type QrScanDevice, recordQrScan, scanDayOf } from '@/lib/features/distribution/scans';
import {
  type QrEntryCampaign,
  findOpenQrCampaign,
  openCampaignDestination,
  qrEntryRedirectPath,
} from '@/lib/features/distribution/short-code-entry';
import { SHORT_CODE_PATTERN } from '@/lib/features/distribution/types';
import { deviceOf, isBot } from '@/lib/features/site-visits/request';
import { reportRejectedRequest, reportServerError } from '@/lib/ops/alert';
import { type NextRequest, NextResponse, after } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
/**
 * Seconds one scan may run. vercel.json limits app/api/** only, and nothing bounds a query of
 * the database client. A scan takes milliseconds; this stops one from running on while the
 * database is stuck, and leaves room for the connect timeout (10 s, lib/db/client.ts) and the
 * alert after it (lib/ops/alert.ts)
 */
export const maxDuration = 15;

/**
 * Every answer: never kept by a browser or a CDN (pausing a campaign takes effect on the next
 * scan) and never indexed
 */
const HEADERS = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };

const TEXT = { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8' };

const notFound = () => new NextResponse('Not Found', { status: 404, headers: TEXT });

/** Whether this instance has logged that no organization receives the AX diagnosis */
let reportedNoAxOrganization = false;

/**
 * With no organization that receives the AX diagnosis, every campaign without a diagnosis
 * answers 404; that is logged once an instance, so QR codes handed out at an event do not all
 * stop unnoticed
 */
function reportNoAxOrganization(): void {
  if (reportedNoAxOrganization) return;
  reportedNoAxOrganization = true;
  console.error(
    'QR entry: AX_DIAGNOSIS_ORGANIZATION_ID / DEFAULT_ORGANIZATION_ID is not set, so campaigns without a diagnosis answer 404'
  );
}

/**
 * The kind of device a scan is recorded with, or null when the request is not a scan:
 * - a bot (link previews, crawlers, monitors, no User-Agent), excluded as /api/collect excludes
 *   them from the page views
 * - HEAD, which Next.js answers with this GET handler: it sends nobody to the diagnosis
 * Only the kind of device is kept of the User-Agent (decision 2026-10-23-site-visit-measurement).
 * isBot and deviceOf read only the head of the User-Agent (#705), so a long header sent on
 * purpose does not hold the redirect (they run before it is answered)
 */
function scannedDevice(req: NextRequest): QrScanDevice | null {
  if (req.method !== 'GET') return null;
  const userAgent = req.headers.get('user-agent');
  if (!userAgent || isBot(userAgent)) return null;
  return deviceOf(userAgent);
}

/** What the alert holds when a campaign's scans pass the daily cap: only this name */
function dailyCapReached(): Error {
  const error = new Error('QR scans of a campaign reached the daily cap');
  error.name = 'QrScanDailyCapReached';
  return error;
}

/**
 * Record a scan the entry has sent on (#41). Run after the response: the visitor never waits
 * for the write, and a failed write is reported like the entry's other errors, never answered.
 * Counted against the campaign's daily cap first (QR_SCAN_DAILY_CAP): past it the scan is not
 * written, and the one scan that goes past it tells the people on call
 */
async function recordScan(campaign: QrEntryCampaign, device: QrScanDevice): Promise<void> {
  try {
    const now = new Date();
    const day = scanDayOf(now);
    // Counted atomically, so exactly one scan sees limit + 1 and the alert goes out once a day
    const cap = await consumeRateLimit(db, QR_SCAN_DAILY_CAP, `${campaign.campaignId}:${day}`, now);
    if (!cap.allowed) {
      if (cap.count === QR_SCAN_DAILY_CAP.limit + 1) {
        console.warn('QR scans reached the daily cap of the campaign; no more are recorded today', {
          campaignId: campaign.campaignId,
          day,
        });
        await reportServerError('qr-entry/scan-daily-cap', dailyCapReached());
      }
      return;
    }
    await recordQrScan(db, campaign, device, now);
  } catch (error) {
    // The error of the database, never the campaign
    console.error('QR scan record error:', error instanceof Error ? error.name : 'unknown');
    await reportServerError('qr-entry/scan', error);
  }
}

/**
 * GET /q/<short code>
 *
 * The QR code of a campaign (#503). Sends the visitor to the campaign's diagnosis with the
 * campaign's UTM parameters (owner decisions in #663, openCampaignDestination, which the settings
 * page of the campaigns shows too, #692):
 * - a campaign that names a builder diagnosis (diagnosis_id): to /d/<slug> while that page
 *   serves this diagnosis; 404 while it does not (paused, archived, a slug two organizations
 *   publish, a diagnosis of another organization), never to another diagnosis
 * - a campaign that names none: to the AX diagnosis, only when the campaign is the AX
 *   organization's (resolveDiagnosisOrganizationId), whose leads the AX diagnosis makes; 404
 *   for another organization's, so its visitors never become the AX organization's leads
 * The address is a path of this app built from the campaign row; nothing of the request (host,
 * query, headers) goes into it. A paused, expired or unknown code is 404.
 * Outside [locale] (lib/i18n/middleware.ts skips /q/): the code is case-sensitive and the
 * locale routing would otherwise redirect it first.
 *
 * Each scan sent on is recorded after the response (#41, recordScan): counted after the rate
 * limit and against the campaign's daily cap, the row and the count in one statement, never a
 * 404 or a 429.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  // Checked before anything is counted or looked up
  if (!SHORT_CODE_PATTERN.test(code)) return notFound();

  try {
    // Per address, where the address can be trusted (see clientIp)
    const ip = clientIp(req);
    if (ip) {
      const limit = await consumeRateLimit(db, QR_ENTRY_RATE_LIMITS.perIp, ipBlock(ip));
      if (!limit.allowed) {
        after(() => reportRejectedRequest('qr-entry', 'rate_limited'));
        // Plain text: the phone that scanned the code shows the body as it is
        return new NextResponse(QR_ENTRY_TOO_MANY_REQUESTS_TEXT, {
          status: 429,
          headers: { ...TEXT, 'Retry-After': String(limit.retryAfterSeconds) },
        });
      }
    }

    const campaign = await findOpenQrCampaign(db, code);
    if (!campaign) return notFound();

    // What /d/<slug> serves for the diagnosis the campaign names (one of its own organization)
    const served =
      campaign.diagnosisId && campaign.diagnosis
        ? await findPublicDiagnosis(db, campaign.diagnosis.slug)
        : null;
    const diagnosisOrganizationId = resolveDiagnosisOrganizationId();
    const destination = openCampaignDestination(campaign, {
      diagnosisOrganizationId,
      servedDiagnosis: served,
    });
    if (destination.kind === 'none') {
      if (diagnosisOrganizationId === null && destination.reasons.includes('not_ax_organization')) {
        reportNoAxOrganization();
      }
      return notFound();
    }

    const device = scannedDevice(req);
    if (device) after(() => recordScan(campaign, device));

    // A relative Location: the visitor stays on the host they scanned
    const publishedSlug = destination.kind === 'diagnosis' ? destination.slug : null;
    return new NextResponse(null, {
      status: 307,
      headers: { ...HEADERS, Location: qrEntryRedirectPath(campaign.utm, publishedSlug) },
    });
  } catch (error) {
    // The error of the database, never the code
    console.error('QR entry error:', error instanceof Error ? error.name : 'unknown');
    after(() => reportServerError('qr-entry', error));
    return new NextResponse('Internal Server Error', { status: 500, headers: TEXT });
  }
}
