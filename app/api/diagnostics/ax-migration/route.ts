import { db } from '@/lib/db/client';
import { allowedEmailDomains, isAllowedEmail, isTestMode } from '@/lib/email/allowed-recipients';
import { axMigrationDefinition } from '@/lib/features/diagnostics/ax-migration/definition';
import {
  evaluateAxMigration,
  toPublicResult,
} from '@/lib/features/diagnostics/ax-migration/evaluate';
import { AX_RATE_LIMITS } from '@/lib/features/diagnostics/ax-migration/limits';
import { notifyAxMigrationSubmission } from '@/lib/features/diagnostics/ax-migration/notify';
import {
  axMigrationSubmissionSchema,
  submitAxMigrationDiagnosis,
} from '@/lib/features/diagnostics/ax-migration/submission-service';
import { validateAnswers } from '@/lib/features/diagnostics/engine';
import { resolveDiagnosisOrganizationId } from '@/lib/features/diagnostics/organization';
import { consumeRateLimits, pruneRateLimits } from '@/lib/features/diagnostics/rate-limit';
import {
  checkPublicJsonRequest,
  clientIp,
  ipBlock,
  readJsonBody,
  tooManyRequests,
} from '@/lib/features/diagnostics/request-guard';
import { turnstileSiteKey, verifyTurnstile } from '@/lib/features/diagnostics/turnstile';
import { getInfoOffers } from '@/lib/features/info-offers/service';
import { publicInfoOffers } from '@/lib/features/info-offers/types/schemas';
import { jstDate } from '@/lib/features/leads/types/pipeline';
import { notifyReferralDiagnosed } from '@/lib/features/prospects/referrals';
import { reportRejectedRequest, reportServerError } from '@/lib/ops/alert';
import { type NextRequest, NextResponse, after } from 'next/server';

/** Upper bound for the request body (answers + contact + tracking are a few KB) */
const MAX_BODY_BYTES = 32 * 1024;
/** Cap the number of validation issues echoed back */
const MAX_ISSUES = 20;

/**
 * POST /api/diagnostics/ax-migration
 *
 * Public endpoint for the AX migration self-diagnosis.
 * Validates answers, evaluates them on the server, saves the submission and
 * links it to a lead. Returns only the respondent-facing result.
 */
export async function POST(req: NextRequest) {
  const guard = checkPublicJsonRequest(req, MAX_BODY_BYTES);
  if (guard) return guard;

  const read = await readJsonBody(req, MAX_BODY_BYTES);
  if (!read.ok) return read.response;
  const body = read.body;

  const parsed = axMigrationSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Test mode: only company addresses are accepted (checked before anything is counted)
  if (!isAllowedEmail(parsed.data.contact.email)) {
    return NextResponse.json(
      {
        error: 'Email address not accepted in test mode',
        code: 'email_domain_not_allowed',
        domains: allowedEmailDomains(),
      },
      { status: 400 }
    );
  }

  // Checked before anything is counted or saved: invalid answers use up no limit
  const validation = validateAnswers(axMigrationDefinition, parsed.data.answers);
  if (!validation.success) {
    return NextResponse.json(
      { error: 'Invalid answers', issues: validation.issues.slice(0, MAX_ISSUES) },
      { status: 400 }
    );
  }

  // Honeypot filled: answer like a normal success so bots learn nothing, but store nothing
  if (parsed.data.website) {
    after(() => reportRejectedRequest('ax-diagnosis/submit', 'honeypot'));
    return NextResponse.json({
      submissionId: crypto.randomUUID(),
      consultationRequested: parsed.data.consultationRequested,
      result: toPublicResult(evaluateAxMigration(validation.answers)),
    });
  }

  const organizationId = resolveDiagnosisOrganizationId();
  if (!organizationId) {
    console.error(
      'AX diagnosis: AX_DIAGNOSIS_ORGANIZATION_ID / DEFAULT_ORGANIZATION_ID is not set'
    );
    return NextResponse.json({ error: 'Diagnosis is not available' }, { status: 503 });
  }

  const ip = clientIp(req);
  // Once the site is public (test mode off) the bot check is required: missing keys close the
  // form instead of opening it unprotected (#232). In test mode it stays optional.
  if (!isTestMode() && !turnstileSiteKey()) {
    console.error('AX diagnosis: Turnstile is not configured while test mode is off');
    return NextResponse.json(
      { error: 'Verification unavailable', code: 'verification_unavailable' },
      { status: 503 }
    );
  }
  const verification = await verifyTurnstile(parsed.data.turnstileToken, ip, req.nextUrl.hostname);
  if (!verification.ok) {
    if (verification.reason !== 'unavailable') {
      after(() => reportRejectedRequest('ax-diagnosis/submit', 'verification_failed'));
    }
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
    // Per address and per email; the organization-wide limit applies to the notifications only
    // (notify.ts), so a flood cannot shut the form for everyone
    const limit = await consumeRateLimits(db, [
      ...(ip
        ? [
            { rule: AX_RATE_LIMITS.submitPerIp, identifier: ipBlock(ip) },
            { rule: AX_RATE_LIMITS.submitPerIpDaily, identifier: ipBlock(ip) },
          ]
        : []),
      { rule: AX_RATE_LIMITS.submitPerEmail, identifier: parsed.data.contact.email.toLowerCase() },
    ]);
    after(() =>
      pruneRateLimits(db).catch((error) => console.error('Rate limit cleanup error:', error))
    );
    if (!limit.allowed) {
      console.warn(`AX diagnosis: rate limit reached (${limit.rule})`);
      after(() => reportRejectedRequest('ax-diagnosis/submit', 'rate_limited'));
      return tooManyRequests(limit.retryAfterSeconds);
    }

    const outcome = await submitAxMigrationDiagnosis(db, organizationId, parsed.data);
    if (!outcome.ok) {
      return NextResponse.json(
        { error: 'Invalid answers', issues: outcome.issues.slice(0, MAX_ISSUES) },
        { status: 400 }
      );
    }

    // For an existing lead, show sales the stored identity, not what an anonymous visitor typed
    const identity = outcome.existingLead ?? {
      company: parsed.data.contact.company,
      name: parsed.data.contact.name,
      email: parsed.data.contact.email,
    };

    // Taken now: the consultation deadline counts from when the request came in
    const requestedAt = new Date();
    // After the response: notifications never delay or fail the respondent's flow, and the
    // serverless function stays alive until they are sent (a promise left running is cut off
    // on Vercel once the response has been returned)
    after(() =>
      notifyAxMigrationSubmission({
        organizationId,
        leadId: outcome.leadId,
        submissionId: outcome.submissionId,
        company: identity.company ?? '',
        name: identity.name ?? '',
        email: identity.email,
        result: outcome.result,
        consultationRequested: parsed.data.consultationRequested,
        leadCreated: outcome.leadCreated,
        identityUnverified: outcome.existingLead !== null && !outcome.continued,
        additionalSystem: outcome.continued,
        requestedAt,
      }).catch((error) => {
        console.error('AX diagnosis notification error:', error);
        return reportServerError('ax-diagnosis/notify', error);
      })
    );

    // The employee whose own link brought the new lead is told (#265)
    const referralMemberUserId = outcome.referralMemberUserId;
    if (referralMemberUserId) {
      after(() =>
        notifyReferralDiagnosed(db, {
          organizationId,
          memberUserId: referralMemberUserId,
          leadId: outcome.leadId,
          company: identity.company ?? '',
        })
      );
    }

    // Documents and seminars for respondents still gathering information (#153); the result is
    // shown without them when they cannot be read
    const offers = await getInfoOffers(db, organizationId)
      .then((settings) => publicInfoOffers(settings, jstDate()))
      .catch((error) => {
        console.error('AX diagnosis: info offers could not be read:', error);
        return null;
      });

    return NextResponse.json({
      submissionId: outcome.submissionId,
      consultationRequested: parsed.data.consultationRequested,
      result: toPublicResult(outcome.result),
      ...(offers ? { offers } : {}),
    });
  } catch (error) {
    console.error('AX diagnosis submission error:', error);
    after(() => reportServerError('ax-diagnosis/submit', error));
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
