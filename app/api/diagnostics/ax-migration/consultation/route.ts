import { db } from '@/lib/db/client';
import { diagnosticSubmissions, leads } from '@/lib/db/schema';
import type { AxMigrationResult } from '@/lib/features/diagnostics/ax-migration/evaluate';
import { AX_RATE_LIMITS } from '@/lib/features/diagnostics/ax-migration/limits';
import { notifyAxMigrationSubmission } from '@/lib/features/diagnostics/ax-migration/notify';
import { requestAxMigrationConsultation } from '@/lib/features/diagnostics/ax-migration/submission-service';
import { consumeRateLimit } from '@/lib/features/diagnostics/rate-limit';
import {
  checkPublicJsonRequest,
  clientIp,
  ipBlock,
  readJsonBody,
  tooManyRequests,
} from '@/lib/features/diagnostics/request-guard';
import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse, after } from 'next/server';
import { z } from 'zod';

const consultationSchema = z.object({
  submissionId: z.string().uuid(),
});

/**
 * POST /api/diagnostics/ax-migration/consultation
 *
 * Consultation request (相談申込) made from the result page.
 * Idempotent: only the first of concurrent / repeated requests notifies sales.
 */
export async function POST(req: NextRequest) {
  const guard = checkPublicJsonRequest(req, 1024);
  if (guard) return guard;

  const read = await readJsonBody(req, 1024);
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
      if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);
    }

    const requestedAt = new Date();
    const outcome = await requestAxMigrationConsultation(db, parsed.data.submissionId, requestedAt);
    if (!outcome.ok) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
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
        }
      });
    }

    return NextResponse.json({ ok: true, alreadyRequested: outcome.alreadyRequested });
  } catch (error) {
    console.error('AX consultation request error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
