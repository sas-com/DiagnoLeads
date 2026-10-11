import { db } from '@/lib/db/client';
import { diagnosticSubmissions, leads } from '@/lib/db/schema';
import type { AxMigrationResult } from '@/lib/features/diagnostics/ax-migration/evaluate';
import { notifyAxMigrationSubmission } from '@/lib/features/diagnostics/ax-migration/notify';
import { requestAxMigrationConsultation } from '@/lib/features/diagnostics/ax-migration/submission-service';
import { checkPublicJsonRequest, readJsonBody } from '@/lib/features/diagnostics/request-guard';
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
    const requestedAt = new Date();
    const outcome = await requestAxMigrationConsultation(db, parsed.data.submissionId, requestedAt);
    if (!outcome.ok) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (!outcome.alreadyRequested && outcome.leadId) {
      const [lead, submission] = await Promise.all([
        db.query.leads.findFirst({ where: eq(leads.id, outcome.leadId) }),
        db.query.diagnosticSubmissions.findFirst({
          where: eq(diagnosticSubmissions.id, parsed.data.submissionId),
        }),
      ]);
      if (lead && submission) {
        // After the response, keeping the function alive until sales are notified
        after(() =>
          notifyAxMigrationSubmission({
            organizationId: outcome.organizationId,
            leadId: lead.id,
            submissionId: submission.id,
            company: lead.company ?? '',
            name: lead.name ?? '',
            email: lead.email,
            result: submission.result as unknown as AxMigrationResult,
            consultationRequested: true,
            leadCreated: false,
            identityUnverified: !outcome.leadCreated,
            requestedAt,
          }).catch((error) => console.error('AX consultation notification error:', error))
        );
      }
    }

    return NextResponse.json({ ok: true, alreadyRequested: outcome.alreadyRequested });
  } catch (error) {
    console.error('AX consultation request error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
