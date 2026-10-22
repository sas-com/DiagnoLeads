import { db } from '@/lib/db/client';
import { AX_RATE_LIMITS } from '@/lib/features/diagnostics/ax-migration/limits';
import { consumeRateLimit } from '@/lib/features/diagnostics/rate-limit';
import {
  checkPublicJsonRequest,
  clientIp,
  ipBlock,
  readJsonBody,
  tooManyRequests,
} from '@/lib/features/diagnostics/request-guard';
import { requestInfoOffer } from '@/lib/features/info-offers/service';
import { requestInfoOfferSchema } from '@/lib/features/info-offers/types/schemas';
import { reportRejectedRequest, reportServerError } from '@/lib/ops/alert';
import { type NextRequest, NextResponse, after } from 'next/server';

const MAX_BYTES = 1024;

/**
 * POST /api/diagnostics/ax-migration/offers
 *
 * A document download or a seminar sign-up from the result page (#153). Answers with the
 * document's location once the request is recorded. Idempotent per submission and offer.
 */
export async function POST(req: NextRequest) {
  const guard = checkPublicJsonRequest(req, MAX_BYTES);
  if (guard) return guard;

  const read = await readJsonBody(req, MAX_BYTES);
  if (!read.ok) return read.response;

  const parsed = requestInfoOfferSchema.safeParse(read.body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed' }, { status: 400 });
  }

  try {
    const ip = clientIp(req);
    if (ip) {
      const limit = await consumeRateLimit(db, AX_RATE_LIMITS.offersPerIp, ipBlock(ip));
      if (!limit.allowed) {
        after(() => reportRejectedRequest('ax-diagnosis/offers', 'rate_limited'));
        return tooManyRequests(limit.retryAfterSeconds);
      }
    }

    const outcome = await requestInfoOffer(db, parsed.data);
    if (!outcome.ok) {
      return outcome.reason === 'not_found'
        ? NextResponse.json({ error: 'Not found' }, { status: 404 })
        : NextResponse.json({ error: 'Unavailable', code: outcome.reason }, { status: 409 });
    }
    return NextResponse.json({
      ok: true,
      alreadyRequested: outcome.alreadyRequested,
      ...(outcome.url ? { url: outcome.url } : {}),
    });
  } catch (error) {
    console.error('AX offer request error:', error);
    after(() => reportServerError('ax-diagnosis/offers', error));
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
