import { db } from '@/lib/db/client';
import { leads } from '@/lib/db/schema';
import { DIAGNOSIS_RATE_LIMITS } from '@/lib/features/diagnosis-builder/limits';
import { notifyDiagnosisSubmission } from '@/lib/features/diagnosis-builder/notify';
import { findPublicDiagnosis } from '@/lib/features/diagnosis-builder/public-diagnosis';
import {
  findBuilderSubmission,
  mqlReasonTexts,
  requestBuilderConsultation,
  resultTypeName,
} from '@/lib/features/diagnosis-builder/submission-service';
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
import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse, after } from 'next/server';
import { z } from 'zod';

const consultationSchema = z.object({
  submissionId: z.string().uuid(),
  /** First meeting preferences, sent after the request (#155); topics and a note (#244) */
  preferences: meetingPreferencesSchema.optional(),
});

/**
 * POST /api/diagnoses/[slug]/consultation
 *
 * Consultation request (相談申込) made from the result page of a builder diagnosis; the same
 * flow as the AX diagnosis (2-business-day deadline in the notification, the lead appears in the
 * pending consultation list). Idempotent: only the first request notifies sales.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const guard = checkPublicJsonRequest(req, CONSULTATION_BODY_MAX_BYTES);
  if (guard) return guard;

  const read = await readJsonBody(req, CONSULTATION_BODY_MAX_BYTES);
  if (!read.ok) return read.response;

  const parsed = consultationSchema.safeParse(read.body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed' }, { status: 400 });
  }

  try {
    const ip = clientIp(req);
    if (ip) {
      const limit = await consumeRateLimit(
        db,
        DIAGNOSIS_RATE_LIMITS.consultationPerIp,
        ipBlock(ip)
      );
      if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);
    }

    // Requests are taken while the diagnosis is published (also for an earlier version)
    const { slug } = await params;
    const diagnosis = await findPublicDiagnosis(db, slug);
    if (!diagnosis) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const requestedAt = new Date();
    const outcome = await requestBuilderConsultation(
      db,
      diagnosis.id,
      parsed.data.submissionId,
      requestedAt
    );
    if (!outcome.ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { leadId } = outcome;
    if (!outcome.alreadyRequested && leadId) {
      // After the response. The request is already recorded, so the lookups for the message must
      // not fail the respondent's request (a retry would find it recorded and notify no one).
      after(async () => {
        try {
          const [lead, submission] = await Promise.all([
            db.query.leads.findFirst({ where: eq(leads.id, leadId) }),
            findBuilderSubmission(db, parsed.data.submissionId),
          ]);
          if (!lead || !submission) return;
          await notifyDiagnosisSubmission({
            organizationId: outcome.organizationId,
            diagnosisId: diagnosis.id,
            diagnosisTitle: submission.definition.title,
            leadId: lead.id,
            submissionId: submission.id,
            company: lead.company ?? '',
            name: lead.name ?? '',
            email: lead.email,
            resultTypeName: resultTypeName(submission.definition, submission.evaluation),
            leadScore: submission.evaluation.leadScore.points,
            mqlLevel:
              submission.evaluation.mql.level ??
              (submission.evaluation.mql.qualified ? 'interest' : 'fit'),
            mqlQualified: submission.evaluation.mql.qualified,
            mqlReasons: mqlReasonTexts(submission.definition, submission.evaluation),
            consultationRequested: true,
            leadCreated: false,
            identityUnverified: !outcome.leadCreated,
            requestedAt,
          });
        } catch (error) {
          console.error('Diagnosis consultation notification error:', error);
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
            // An answer tied to an existing lead only by email never replaces a verified request.
            // Builder answers never have continued_from_submission_id: this matches requestVerified
            identityVerified: outcome.leadCreated,
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
    console.error('Diagnosis consultation request error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
