import { db } from '@/lib/db/client';
import { AX_RATE_LIMITS } from '@/lib/features/diagnostics/ax-migration/limits';
import { axResultEmailEnabled } from '@/lib/features/diagnostics/ax-migration/result-email-config';
import { requestAxResultEmail } from '@/lib/features/diagnostics/ax-migration/result-email-flow';
import { consumeRateLimits } from '@/lib/features/diagnostics/rate-limit';
import {
  checkPublicJsonRequest,
  clientIp,
  ipBlock,
  readJsonBody,
  tooManyRequests,
} from '@/lib/features/diagnostics/request-guard';
import { sendEmail } from '@/lib/features/email/email-service';
import { reportServerError } from '@/lib/ops/alert';
import { type NextRequest, NextResponse, after } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';

const BODY_MAX_BYTES = 256;

/** Only the submission and the language: the address is the lead's, read on the server */
const bodySchema = z.object({
  submissionId: z.string().uuid(),
  locale: z.enum(['ja', 'en']),
});

/**
 * POST /api/diagnostics/ax-migration/result-email
 *
 * "Receive the result by email" on the result screen (#154). Sends the fixed-text confirmation
 * mail of the double opt-in to the address of the submission's lead.
 *
 * Answers `{ status: 'accepted' }` whether the mail went out, the address is suppressed, a
 * confirmation already went to it in the last 24 hours, test mode refused it or this submission
 * had already asked, so nothing about the address can be learnt. `closed` (409) after the result
 * screen's day, 404 for an unknown submission, `unavailable` (503) when the organization's quota
 * is used up, the mail could not be sent (pressing again sends a new confirmation) or the server
 * is busy.
 *
 * 404 while AX_RESULT_EMAIL_ENABLED is not 'true' (the button is hidden then too).
 */
export async function POST(req: NextRequest) {
  if (!axResultEmailEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const guard = checkPublicJsonRequest(req, BODY_MAX_BYTES);
  if (guard) return guard;

  const read = await readJsonBody(req, BODY_MAX_BYTES);
  if (!read.ok) return read.response;

  const parsed = bodySchema.safeParse(read.body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed' }, { status: 400 });
  }

  try {
    // Per address, where the address can be trusted (see clientIp)
    const ip = clientIp(req);
    if (ip) {
      const limit = await consumeRateLimits(db, [
        { rule: AX_RATE_LIMITS.resultEmailRequestPerIp, identifier: ipBlock(ip) },
      ]);
      if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);
    }

    const result = await requestAxResultEmail(db, { sendEmail }, parsed.data);
    switch (result.outcome) {
      // The same answer: whether an earlier press sent a confirmation, or found the address
      // suppressed, must not show
      case 'accepted':
      case 'already_requested':
        return NextResponse.json({ status: 'accepted' });
      case 'closed':
        return NextResponse.json({ error: 'Closed', status: 'closed' }, { status: 409 });
      case 'not_found':
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      default:
        return NextResponse.json({ error: 'Unavailable', status: 'unavailable' }, { status: 503 });
    }
  } catch (error) {
    // The error of the database or the mail, never the address
    console.error(
      'AX result email request error:',
      error instanceof Error ? error.name : 'unknown'
    );
    after(() => reportServerError('ax-diagnosis/result-email', error));
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
