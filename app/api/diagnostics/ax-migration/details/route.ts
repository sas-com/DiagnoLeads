import { db } from '@/lib/db/client';
import { toPublicResult } from '@/lib/features/diagnostics/ax-migration/evaluate';
import { AX_RATE_LIMITS } from '@/lib/features/diagnostics/ax-migration/limits';
import {
  addAxMigrationDetails,
  axMigrationDetailsSchema,
} from '@/lib/features/diagnostics/ax-migration/submission-service';
import { consumeRateLimit } from '@/lib/features/diagnostics/rate-limit';
import {
  checkPublicJsonRequest,
  clientIp,
  ipBlock,
  readJsonBody,
  tooManyRequests,
} from '@/lib/features/diagnostics/request-guard';
import { reportRejectedRequest, reportServerError } from '@/lib/ops/alert';
import { type NextRequest, NextResponse, after } from 'next/server';

/**
 * POST /api/diagnostics/ax-migration/details
 *
 * Optional follow-up answers given after the result. Returns the refined public result.
 */
const MAX_BYTES = 8 * 1024;
/** Enough to point at the wrong answers without echoing a flood back */
const MAX_ISSUES = 20;

export async function POST(req: NextRequest) {
  const guard = checkPublicJsonRequest(req, MAX_BYTES);
  if (guard) return guard;

  const read = await readJsonBody(req, MAX_BYTES);
  if (!read.ok) return read.response;

  const parsed = axMigrationDetailsSchema.safeParse(read.body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed' }, { status: 400 });
  }

  try {
    // Per address, where the address can be trusted (see clientIp)
    const ip = clientIp(req);
    if (ip) {
      const limit = await consumeRateLimit(db, AX_RATE_LIMITS.detailsPerIp, ipBlock(ip));
      if (!limit.allowed) {
        after(() => reportRejectedRequest('ax-diagnosis/details', 'rate_limited'));
        return tooManyRequests(limit.retryAfterSeconds);
      }
    }

    const outcome = await addAxMigrationDetails(db, parsed.data.submissionId, parsed.data.answers);
    if (!outcome.ok) {
      if (outcome.reason === 'not_found') {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      if (outcome.reason === 'outdated') {
        return NextResponse.json({ error: 'Diagnosis version changed' }, { status: 409 });
      }
      if (outcome.reason === 'closed') {
        return NextResponse.json({ error: 'Follow-up answers are closed' }, { status: 409 });
      }
      return NextResponse.json(
        { error: 'Invalid answers', issues: outcome.issues.slice(0, MAX_ISSUES) },
        { status: 400 }
      );
    }
    return NextResponse.json({ result: toPublicResult(outcome.result) });
  } catch (error) {
    console.error('AX diagnosis details error:', error);
    after(() => reportServerError('ax-diagnosis/details', error));
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
