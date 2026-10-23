import { db } from '@/lib/db/client';
import { AX_RATE_LIMITS } from '@/lib/features/diagnostics/ax-migration/limits';
import {
  confirmAxResultEmail,
  declineAxResultEmail,
} from '@/lib/features/diagnostics/ax-migration/result-email-flow';
import { consumeRateLimits } from '@/lib/features/diagnostics/rate-limit';
import {
  checkPublicJsonRequest,
  clientIp,
  ipBlock,
  readJsonBody,
  tooManyRequests,
} from '@/lib/features/diagnostics/request-guard';
import { sendEmail } from '@/lib/features/email/email-service';
import { reportRejectedRequest, reportServerError } from '@/lib/ops/alert';
import { type NextRequest, NextResponse, after } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';

/** `{"token":"<43 characters>","action":"confirm"}` with room to spare */
const BODY_MAX_BYTES = 256;

const bodySchema = z.object({
  token: z
    .string()
    .min(16)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/),
  action: z.enum(['confirm', 'decline']),
});

/**
 * POST /api/diagnostics/ax-migration/result-email/confirm
 *
 * The buttons of the confirm page (#154): the page reads the token from the fragment of the link
 * in the confirmation mail and posts it here. Opening the page changes nothing (mail scanners
 * open links).
 *
 * - `confirm`: sends the result once. `{ status: 'sent' | 'already_sent' | 'expired_or_invalid'
 *   | 'busy' | 'unsubscribed' }`; 503 `unavailable` when the mail could not be sent (the link
 *   stays valid)
 * - `decline`: withdraws the request and suppresses the address. `{ status: 'declined' |
 *   'expired_or_invalid' | 'busy' }`
 *
 * Telling a valid token from an invalid one is safe: a token is 256 random bits, and no answer
 * carries the address.
 *
 * Works whatever AX_RESULT_EMAIL_ENABLED says: the flag hides the button and stops new
 * requests, while a confirmation already in someone's inbox keeps working (and declining must
 * always work).
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
        { rule: AX_RATE_LIMITS.resultEmailConfirmPerIp, identifier: ipBlock(ip) },
      ]);
      if (!limit.allowed) {
        after(() => reportRejectedRequest('ax-diagnosis/result-email-confirm', 'rate_limited'));
        return tooManyRequests(limit.retryAfterSeconds);
      }
    }

    const { token, action } = parsed.data;
    if (action === 'decline') {
      return NextResponse.json({ status: await declineAxResultEmail(db, { token }) });
    }
    const status = await confirmAxResultEmail(db, { sendEmail }, { token });
    if (status === 'failed') {
      return NextResponse.json({ error: 'Unavailable', status: 'unavailable' }, { status: 503 });
    }
    return NextResponse.json({ status });
  } catch (error) {
    // The error of the database or the mail, never the token
    console.error(
      'AX result email confirm error:',
      error instanceof Error ? error.name : 'unknown'
    );
    after(() => reportServerError('ax-diagnosis/result-email-confirm', error));
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
