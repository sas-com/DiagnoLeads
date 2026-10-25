import { db } from '@/lib/db/client';
import { findPublicDiagnosis } from '@/lib/features/diagnosis-builder/public-diagnosis';
import { resolveDiagnosisOrganizationId } from '@/lib/features/diagnostics/organization';
import { consumeRateLimit } from '@/lib/features/diagnostics/rate-limit';
import { clientIp, ipBlock } from '@/lib/features/diagnostics/request-guard';
import {
  QR_ENTRY_RATE_LIMITS,
  QR_ENTRY_TOO_MANY_REQUESTS_TEXT,
} from '@/lib/features/distribution/limits';
import {
  findOpenQrCampaign,
  qrEntryRedirectPath,
} from '@/lib/features/distribution/short-code-entry';
import { SHORT_CODE_PATTERN } from '@/lib/features/distribution/types';
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
 * Whether the AX diagnosis makes its leads in this organization. The ids are compared in one
 * case: PostgreSQL returns a uuid in lower case, the environment may hold it in either.
 * With no such organization every campaign without a diagnosis answers 404; that is logged once
 * an instance, so QR codes handed out at an event do not all stop unnoticed
 */
function receivesAxDiagnosis(organizationId: string): boolean {
  const axOrganizationId = resolveDiagnosisOrganizationId();
  if (axOrganizationId === null) {
    if (!reportedNoAxOrganization) {
      reportedNoAxOrganization = true;
      console.error(
        'QR entry: AX_DIAGNOSIS_ORGANIZATION_ID / DEFAULT_ORGANIZATION_ID is not set, so campaigns without a diagnosis answer 404'
      );
    }
    return false;
  }
  return axOrganizationId.toLowerCase() === organizationId.toLowerCase();
}

/**
 * GET /q/<short code>
 *
 * The QR code of a campaign (#503). Sends the visitor to the campaign's diagnosis with the
 * campaign's UTM parameters (owner decisions in #663):
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
 * Scans are not recorded yet (#41 adds them here).
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

    let publishedSlug: string | null = null;
    if (campaign.diagnosisId) {
      // The diagnosis the campaign names, or nowhere: /d/<slug> serves a slug only while exactly
      // one organization publishes it, so send there only when it serves this very diagnosis
      const published = campaign.diagnosis
        ? await findPublicDiagnosis(db, campaign.diagnosis.slug)
        : null;
      if (!published || published.id !== campaign.diagnosisId) return notFound();
      publishedSlug = published.slug;
    } else if (!receivesAxDiagnosis(campaign.organizationId)) {
      // The AX diagnosis makes leads of the AX organization only (also 404 while it has none)
      return notFound();
    }

    // A relative Location: the visitor stays on the host they scanned
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
