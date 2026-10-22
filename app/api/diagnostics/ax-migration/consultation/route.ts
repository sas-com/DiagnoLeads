import { db } from '@/lib/db/client';
import { diagnosticSubmissions, leads } from '@/lib/db/schema';
import type { AxMigrationResult } from '@/lib/features/diagnostics/ax-migration/evaluate';
import { AX_RATE_LIMITS } from '@/lib/features/diagnostics/ax-migration/limits';
import { notifyAxMigrationSubmission } from '@/lib/features/diagnostics/ax-migration/notify';
import { requestAxMigrationConsultation } from '@/lib/features/diagnostics/ax-migration/submission-service';
import { consumeRateLimit } from '@/lib/features/diagnostics/rate-limit';
import {
  CONSULTATION_BODY_MAX_BYTES,
  checkPublicJsonRequest,
  clientIp,
  ipBlock,
  readJsonBody,
  tooManyRequests,
} from '@/lib/features/diagnostics/request-guard';
import { acceptMeetingPreferences } from '@/lib/features/meeting-requests/service';
import { meetingPreferencesSchema } from '@/lib/features/meeting-requests/types/schemas';
import { reportRejectedRequest, reportServerError } from '@/lib/ops/alert';
import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse, after } from 'next/server';
import { z } from 'zod';

const consultationSchema = z.object({
  submissionId: z.string().uuid(),
  /** First meeting preferences, sent after the request (#155); topics and a note (#244) */
  preferences: meetingPreferencesSchema.optional(),
});

/**
 * POST /api/diagnostics/ax-migration/consultation
 *
 * Consultation request (相談申込) made from the result page.
 * Idempotent: only the first of concurrent / repeated requests notifies sales.
 */
export async function POST(req: NextRequest) {
  const guard = checkPublicJsonRequest(req, CONSULTATION_BODY_MAX_BYTES);
  if (guard) return guard;

  const read = await readJsonBody(req, CONSULTATION_BODY_MAX_BYTES);
  if (!read.ok) return read.response;
  const body = read.body;

  const parsed = consultationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed' }, { status: 400 });
  }

  try {
    // Per address, where the address can be trusted (see clientIp)
    const ip = clientIp(req);
    if (ip) {
      const limit = await consumeRateLimit(db, AX_RATE_LIMITS.consultationPerIp, ipBlock(ip));
      if (!limit.allowed) {
        after(() => reportRejectedRequest('ax-diagnosis/consultation', 'rate_limited'));
        return tooManyRequests(limit.retryAfterSeconds);
      }
    }

    const requestedAt = new Date();
    const outcome = await requestAxMigrationConsultation(db, parsed.data.submissionId, requestedAt);
    if (!outcome.ok) {
      return outcome.reason === 'closed'
        ? NextResponse.json({ error: 'Closed', code: 'closed' }, { status: 409 })
        : NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const { leadId } = outcome;
    if (!outcome.alreadyRequested && leadId) {
      // After the response, keeping the function alive until sales are notified. The request is
      // already recorded, so the lookups for the message must not fail the respondent's request
      // (a retry would find it recorded and notify no one).
      after(async () => {
        try {
          const [lead, submission] = await Promise.all([
            db.query.leads.findFirst({ where: eq(leads.id, leadId) }),
            db.query.diagnosticSubmissions.findFirst({
              where: eq(diagnosticSubmissions.id, parsed.data.submissionId),
            }),
          ]);
          if (!lead || !submission) return;
          await notifyAxMigrationSubmission({
            organizationId: outcome.organizationId,
            leadId: lead.id,
            submissionId: submission.id,
            company: lead.company ?? '',
            name: lead.name ?? '',
            email: lead.email,
            result: submission.result as unknown as AxMigrationResult,
            consultationRequested: true,
            leadCreated: false,
            identityUnverified: !outcome.leadCreated && !outcome.continued,
            additionalSystem: outcome.continued,
            requestedAt,
          });
        } catch (error) {
          console.error('AX consultation notification error:', error);
          await reportServerError('ax-diagnosis/consultation-notify', error);
        }
      });
    }

    const preferences = parsed.data.preferences
      ? await acceptMeetingPreferences(
          db,
          {
            organizationId: outcome.organizationId,
            leadId,
            submissionId: parsed.data.submissionId,
            // An answer tied to an existing lead only by email never replaces a verified request
            identityVerified: outcome.leadCreated || outcome.continued,
            preferences: parsed.data.preferences,
          },
          (task) => after(task)
        )
      : undefined;

    return NextResponse.json({
      ok: true,
      alreadyRequested: outcome.alreadyRequested,
      ...(preferences ? { preferences } : {}),
    });
  } catch (error) {
    console.error('AX consultation request error:', error);
    after(() => reportServerError('ax-diagnosis/consultation', error));
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
