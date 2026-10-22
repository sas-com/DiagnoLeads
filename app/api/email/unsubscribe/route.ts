import { db } from '@/lib/db/client';
import { consumeRateLimits } from '@/lib/features/diagnostics/rate-limit';
import {
  checkPublicJsonRequest,
  clientIp,
  ipBlock,
  readJsonBody,
  tooManyRequests,
} from '@/lib/features/diagnostics/request-guard';
import { unsubscribeByToken } from '@/lib/features/respondent-email';
import { RESPONDENT_EMAIL_RATE_LIMITS } from '@/lib/features/respondent-email/limits';
import { reportServerError } from '@/lib/ops/alert';
import { type NextRequest, NextResponse, after } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';

/** `{"token":"<43 characters>"}` with room to spare */
const BODY_MAX_BYTES = 256;

/** Unsubscribe tokens are 32 random bytes in base64url (43 characters) */
const bodySchema = z.object({
  token: z
    .string()
    .min(16)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/),
});

/**
 * POST /api/email/unsubscribe
 *
 * The button of the unsubscribe page (#154): the page reads the token from the fragment of the
 * link in the mail and posts it here. Same checks as the other public JSON endpoints (JSON only,
 * same origin when the browser says where it comes from, bounded body, per-address limit).
 *
 * Answers `{ status: 'done' }` (also when the address was already unsubscribed) or
 * `{ status: 'not_found' }`, so the page can say the link is not valid. Telling the two apart is
 * safe: a token is 256 random bits, so guessing one is not feasible, and the answer never
 * carries the address.
 */
export async function POST(req: NextRequest) {
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
        { rule: RESPONDENT_EMAIL_RATE_LIMITS.unsubscribePerIp, identifier: ipBlock(ip) },
      ]);
      if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);
    }

    const status = await unsubscribeByToken(db, parsed.data.token, 'unsubscribe_page');
    return NextResponse.json({ status });
  } catch (error) {
    // The error of the database, never the token
    console.error('Unsubscribe error:', error instanceof Error ? error.name : 'unknown');
    after(() => reportServerError('respondent-email/unsubscribe', error));
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
