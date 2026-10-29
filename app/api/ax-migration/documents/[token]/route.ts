import { db } from '@/lib/db/client';
import { AX_RATE_LIMITS } from '@/lib/features/diagnostics/ax-migration/limits';
import { consumeRateLimits } from '@/lib/features/diagnostics/rate-limit';
import { clientIp, ipBlock, tooManyRequests } from '@/lib/features/diagnostics/request-guard';
import { openLandingDocument } from '@/lib/features/info-offers/service';
import { reportRejectedRequest, reportServerError } from '@/lib/ops/alert';
import { type NextRequest, NextResponse, after } from 'next/server';

export const runtime = 'nodejs';

/**
 * Redirect without caching, and without sending this URL (it carries the token) as the referrer
 * to the document's host
 */
function redirect(url: string | URL): NextResponse {
  const response = NextResponse.redirect(url, 302);
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

/**
 * GET /api/ax-migration/documents/<token>
 *
 * The link of the document mail (#899). Records the first opening of the request and redirects
 * to the document's current location. An unknown or expired link, or a document no longer
 * offered, goes to the landing page with `document_link=<reason>` (the page can say so; the
 * request page of #899 part 2 offers to ask again).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const ip = clientIp(req);
    if (ip) {
      const limit = await consumeRateLimits(db, [
        { rule: AX_RATE_LIMITS.documentOpenPerIp, identifier: ipBlock(ip) },
      ]);
      if (!limit.allowed) {
        after(() => reportRejectedRequest('ax-document-open', 'rate_limited'));
        return tooManyRequests(limit.retryAfterSeconds);
      }
    }

    const result = await openLandingDocument(db, token);
    if (result.outcome === 'open') return redirect(result.url);
    const landing = new URL('/ja/ax-migration', req.nextUrl.origin);
    landing.searchParams.set('document_link', result.outcome);
    return redirect(landing);
  } catch (error) {
    // Never the token
    console.error('AX document open error:', error instanceof Error ? error.name : 'unknown');
    after(() => reportServerError('ax-document-open', error));
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
