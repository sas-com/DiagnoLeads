import { db } from '@/lib/db/client';
import { allowedEmailDomains, isAllowedEmail, isTestMode } from '@/lib/email/allowed-recipients';
import {
  axDocumentRequestSchema,
  requestAxDocument,
} from '@/lib/features/diagnostics/ax-migration/document-request';
import { AX_RATE_LIMITS } from '@/lib/features/diagnostics/ax-migration/limits';
import { notifyAxDocumentRequest } from '@/lib/features/diagnostics/ax-migration/notify';
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
import { sendEmail } from '@/lib/features/email/email-service';
import {
  LANDING_DOCUMENT_LINK_TTL_MS,
  getLandingDocument,
  recordLandingOfferRequest,
} from '@/lib/features/info-offers/service';
import { OFFER_SCORE } from '@/lib/features/info-offers/types/schemas';
import { reportRejectedRequest, reportServerError } from '@/lib/ops/alert';
import { type NextRequest, NextResponse, after } from 'next/server';

export const runtime = 'nodejs';

/** Contact and tracking are well under this */
const MAX_BODY_BYTES = 8 * 1024;

const accepted = () => NextResponse.json({ status: 'accepted' });

/** The organization's documents (info-offers), handed to the AX flow */
const offers = {
  getDocument: getLandingDocument,
  record: recordLandingOfferRequest,
  score: OFFER_SCORE.document,
  linkTtlMs: LANDING_DOCUMENT_LINK_TTL_MS,
};

/**
 * POST /api/ax-migration/document-requests
 *
 * The document request form of the AX landing pages (#899). Records the request on the lead
 * (created when none has the address) and mails the link to the document the organization chose.
 *
 * Answers `{ status: 'accepted' }` whether the mail went out, the address is suppressed or a
 * link already went to it in the last 24 hours, so nothing about the address can be learnt.
 * 404 when the organization offers no document on the landing pages, 503 when its quota of
 * respondent mail is used up, the mail could not be sent (sending again is possible) or the
 * server is busy. The guards are the diagnosis endpoint's: size and content type, validation,
 * test mode, honeypot, Turnstile and rate limits per address and per email.
 */
export async function POST(req: NextRequest) {
  const guard = checkPublicJsonRequest(req, MAX_BODY_BYTES);
  if (guard) return guard;

  const read = await readJsonBody(req, MAX_BODY_BYTES);
  if (!read.ok) return read.response;

  const parsed = axDocumentRequestSchema.safeParse(read.body);
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

  // Honeypot filled: answer like a normal success so bots learn nothing, but store nothing
  if (parsed.data.website) {
    after(() => reportRejectedRequest('ax-document-request', 'honeypot'));
    return accepted();
  }

  const organizationId = resolveDiagnosisOrganizationId();
  if (!organizationId) {
    console.error(
      'AX document request: AX_DIAGNOSIS_ORGANIZATION_ID / DEFAULT_ORGANIZATION_ID is not set'
    );
    return NextResponse.json({ error: 'Not available' }, { status: 503 });
  }

  const ip = clientIp(req);
  // As for the diagnosis (#232): outside test mode the bot check is required, and missing keys
  // close the form instead of opening it unprotected
  if (!isTestMode() && !turnstileSiteKey()) {
    console.error('AX document request: Turnstile is not configured while test mode is off');
    return NextResponse.json(
      { error: 'Verification unavailable', code: 'verification_unavailable' },
      { status: 503 }
    );
  }
  const verification = await verifyTurnstile(parsed.data.turnstileToken, ip, req.nextUrl.hostname);
  if (!verification.ok) {
    if (verification.reason !== 'unavailable') {
      after(() => reportRejectedRequest('ax-document-request', 'verification_failed'));
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
    const limit = await consumeRateLimits(db, [
      ...(ip
        ? [
            { rule: AX_RATE_LIMITS.documentRequestPerIp, identifier: ipBlock(ip) },
            { rule: AX_RATE_LIMITS.documentRequestPerIpDaily, identifier: ipBlock(ip) },
          ]
        : []),
      {
        rule: AX_RATE_LIMITS.documentRequestPerEmail,
        identifier: parsed.data.contact.email.trim().toLowerCase(),
      },
    ]);
    after(() =>
      pruneRateLimits(db).catch((error) => console.error('Rate limit cleanup error:', error))
    );
    if (!limit.allowed) {
      after(() => reportRejectedRequest('ax-document-request', 'rate_limited'));
      return tooManyRequests(limit.retryAfterSeconds);
    }

    const result = await requestAxDocument(db, { offers, sendEmail }, organizationId, parsed.data);
    if (result.outcome === 'closed') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (result.outcome === 'unavailable') {
      return NextResponse.json({ error: 'Unavailable', status: 'unavailable' }, { status: 503 });
    }

    // Recorded requests are told to sales after the response, the failed mail included (the
    // request is on the lead either way)
    const request = result.request;
    if (request) {
      const { contact, systems } = parsed.data;
      after(() =>
        notifyAxDocumentRequest({
          organizationId,
          leadId: request.leadId,
          requestId: request.id,
          documentTitle: request.documentTitle,
          leadCreated: request.leadCreated,
          company: contact.company,
          name: contact.name,
          department: contact.department,
          title: contact.title,
          systems,
        }).catch((error) => {
          console.error('AX document request notification error:', error);
          return reportServerError('ax-document-request/notify', error);
        })
      );
    }

    // A mail that could not be sent can be asked for again
    if (result.delivery === 'failed') {
      return NextResponse.json({ error: 'Unavailable', status: 'unavailable' }, { status: 503 });
    }
    return accepted();
  } catch (error) {
    // The error of the database or the mail, never the address
    console.error('AX document request error:', error instanceof Error ? error.name : 'unknown');
    after(() => reportServerError('ax-document-request', error));
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
