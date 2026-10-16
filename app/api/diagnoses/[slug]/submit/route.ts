import { db } from '@/lib/db/client';
import { allowedEmailDomains, isAllowedEmail } from '@/lib/email/allowed-recipients';
import { validateDiagnosisAnswers } from '@/lib/features/diagnosis-builder/answers';
import { toPublicResult } from '@/lib/features/diagnosis-builder/evaluate';
import { DIAGNOSIS_RATE_LIMITS } from '@/lib/features/diagnosis-builder/limits';
import { notifyDiagnosisSubmission } from '@/lib/features/diagnosis-builder/notify';
import { resolveSubmittedVersion } from '@/lib/features/diagnosis-builder/public-diagnosis';
import {
  diagnosisSubmissionSchema,
  mqlReasonTexts,
  resultTypeName,
  submitBuilderDiagnosis,
} from '@/lib/features/diagnosis-builder/submission-service';
import { consumeRateLimits, pruneRateLimits } from '@/lib/features/diagnostics/rate-limit';
import {
  checkPublicJsonRequest,
  clientIp,
  ipBlock,
  readJsonBody,
  tooManyRequests,
} from '@/lib/features/diagnostics/request-guard';
import { turnstileSiteKey, verifyTurnstile } from '@/lib/features/diagnostics/turnstile';
import { DIAGNOSIS_TURNSTILE_ACTION } from '@/lib/features/diagnostics/turnstile-action';
import { type NextRequest, NextResponse, after } from 'next/server';

/** Upper bound for the request body (answers incl. free text + contact + tracking) */
const MAX_BODY_BYTES = 64 * 1024;
/** Cap the number of validation issues echoed back */
const MAX_ISSUES = 20;

const isFilled = (value: unknown) => typeof value === 'string' && value.trim() !== '';

/** A result that reveals nothing, for a filled honeypot */
const EMPTY_PUBLIC_RESULT = { axes: {}, overall: 0, tiers: {}, resultTypeId: null };

/**
 * POST /api/diagnoses/[slug]/submit
 *
 * Public endpoint of the diagnoses made in the builder. Checks in this order, so the cheap
 * checks come first and nothing invalid is counted or saved: request (origin, content type,
 * declared size) → body size → honeypot → schema → (test mode address) → version (current, or
 * the one replaced within 24 hours, else 409) → answers → Turnstile (required) → DB rate limits.
 * Scores are computed on the server from the answered version; only the respondent-facing
 * result is returned.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const guard = checkPublicJsonRequest(req, MAX_BODY_BYTES);
  if (guard) return guard;

  const read = await readJsonBody(req, MAX_BODY_BYTES);
  if (!read.ok) return read.response;
  const body = read.body;

  // Honeypot filled: answer like a success so bots learn nothing, but look at and store nothing
  if (typeof body === 'object' && body !== null && isFilled(Reflect.get(body, 'website'))) {
    return NextResponse.json({
      submissionId: crypto.randomUUID(),
      consultationRequested: false,
      result: EMPTY_PUBLIC_RESULT,
    });
  }

  const parsed = diagnosisSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const input = parsed.data;

  // Test mode: only company addresses are accepted (checked before anything is counted)
  if (!isAllowedEmail(input.contact.email)) {
    return NextResponse.json(
      {
        error: 'Email address not accepted in test mode',
        code: 'email_domain_not_allowed',
        domains: allowedEmailDomains(),
      },
      { status: 400 }
    );
  }

  const { slug } = await params;
  const now = new Date();
  let resolved: Awaited<ReturnType<typeof resolveSubmittedVersion>>;
  try {
    resolved = await resolveSubmittedVersion(db, slug, input.versionId, now);
  } catch (error) {
    console.error('Diagnosis submission: version lookup failed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
  if (!resolved.ok) {
    return resolved.reason === 'not_found'
      ? NextResponse.json({ error: 'Not found' }, { status: 404 })
      : NextResponse.json(
          { error: 'The diagnosis was updated', code: 'version_outdated' },
          { status: 409 }
        );
  }
  const { diagnosis, version } = resolved;

  // Checked before anything is counted or saved: invalid answers use up no limit
  const validation = validateDiagnosisAnswers(version.definition, input.answers);
  if (!validation.success) {
    return NextResponse.json(
      { error: 'Invalid answers', issues: validation.issues.slice(0, MAX_ISSUES) },
      { status: 400 }
    );
  }

  // Turnstile is required for builder diagnoses: without the keys the form is not available
  const ip = clientIp(req);
  if (!turnstileSiteKey()) {
    console.error('Diagnosis submission: Turnstile is not configured');
    return NextResponse.json(
      { error: 'Verification unavailable', code: 'verification_unavailable' },
      { status: 503 }
    );
  }
  const verification = await verifyTurnstile(
    input.turnstileToken,
    ip,
    req.nextUrl.hostname,
    DIAGNOSIS_TURNSTILE_ACTION
  );
  if (!verification.ok) {
    return verification.reason === 'unavailable'
      ? NextResponse.json(
          { error: 'Verification unavailable', code: 'verification_unavailable' },
          { status: 503 }
        )
      : NextResponse.json(
          { error: 'Verification failed', code: 'verification_failed' },
          { status: 403 }
        );
  }

  try {
    const limit = await consumeRateLimits(db, [
      ...(ip
        ? [
            { rule: DIAGNOSIS_RATE_LIMITS.submitPerIp, identifier: ipBlock(ip) },
            { rule: DIAGNOSIS_RATE_LIMITS.submitPerIpDaily, identifier: ipBlock(ip) },
          ]
        : []),
      { rule: DIAGNOSIS_RATE_LIMITS.submitPerEmail, identifier: input.contact.email.toLowerCase() },
    ]);
    after(() =>
      pruneRateLimits(db).catch((error) => console.error('Rate limit cleanup error:', error))
    );
    if (!limit.allowed) {
      console.warn(`Diagnosis submission: rate limit reached (${limit.rule})`);
      return tooManyRequests(limit.retryAfterSeconds);
    }

    const outcome = await submitBuilderDiagnosis(db, diagnosis, version, input, now);
    if (!outcome.ok) {
      return NextResponse.json(
        { error: 'Invalid answers', issues: outcome.issues.slice(0, MAX_ISSUES) },
        { status: 400 }
      );
    }

    // For an existing lead, show sales the stored identity, not what an anonymous visitor typed
    const identity = outcome.existingLead ?? {
      company: input.contact.company,
      name: input.contact.name,
      email: input.contact.email,
    };
    const definition = version.definition;
    after(() =>
      notifyDiagnosisSubmission({
        organizationId: diagnosis.organizationId,
        diagnosisId: diagnosis.id,
        diagnosisTitle: definition.title,
        leadId: outcome.leadId,
        submissionId: outcome.submissionId,
        company: identity.company ?? '',
        name: identity.name ?? '',
        email: identity.email,
        resultTypeName: resultTypeName(definition, outcome.evaluation),
        leadScore: outcome.evaluation.leadScore.points,
        mqlLevel: outcome.evaluation.mql.level,
        mqlQualified: outcome.evaluation.mql.qualified,
        mqlReasons: mqlReasonTexts(definition, outcome.evaluation),
        consultationRequested: input.consultationRequested,
        leadCreated: outcome.leadCreated,
        identityUnverified: outcome.existingLead !== null,
        requestedAt: now,
      }).catch((error) => console.error('Diagnosis notification error:', error))
    );

    return NextResponse.json({
      submissionId: outcome.submissionId,
      consultationRequested: input.consultationRequested,
      result: toPublicResult(outcome.evaluation),
    });
  } catch (error) {
    console.error('Diagnosis submission error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
