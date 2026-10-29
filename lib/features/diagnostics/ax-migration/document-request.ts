/**
 * Document requests from the AX landing pages (#899): no diagnosis, a form with the contact, and
 * a mail with the link to the document the organization chose (axInfoOffers.landingDocumentId).
 *
 * - Leads are matched and created as for the diagnosis (upsertLeadFromSubmission): a lead with
 *   the same address is never changed, the request is only recorded on it as unverified (#233).
 *   A new lead gets the conversion point 'document_download' and OFFER_SCORE.document
 * - The mail follows the respondent mail rules of the result mail (#154, decision
 *   2026-10-23-respondent-result-email): fixed text with the document's title and link (never
 *   what was typed into the form), one mail per address (and organization) in 24 hours, the
 *   organization's quota counted before each attempt, the suppression list checked right before
 *   sending, the link's token stored only as a hash
 * - Whether a mail went out, the address was suppressed, a link went to it in the last 24 hours
 *   or test mode refused it, the outcome is 'accepted' (the route answers the same for all)
 *
 * Neither the address nor a token is logged.
 */
import type { Database } from '@/lib/db/client';
import type { LandingRequestContact } from '@/lib/db/schema';
import { respondentEmailSends } from '@/lib/db/schema';
import { isAllowedEmail as defaultIsAllowedEmail } from '@/lib/email/allowed-recipients';
import type { AxMailLocale } from '@/lib/features/ax-site/sender-identity';
import {
  type RespondentEmailDeps,
  SEND_TIMEOUT,
  newToken,
  normaliseEmail,
  sendRespondentEmail,
  unsubscribeUrls,
} from '@/lib/features/respondent-email';
import { and, eq, gte, or } from 'drizzle-orm';
import { z } from 'zod';
import { upsertLeadFromSubmission } from '../lead-upsert';
import { consumeRateLimits } from '../rate-limit';
import { resolveInflow } from '../service';
import { type Tracking, trackingSchema } from '../tracking';
import { contactSchema, plainText } from '../types/contact';
import { buildAxDocumentEmail } from './document-email';
import { AX_RATE_LIMITS } from './limits';
import { BUSY, holdingLock, wentOut } from './result-email-flow';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** One document link per address (and organization) in this rolling window */
export const DOCUMENT_LINK_INTERVAL_MS = 24 * HOUR;
/** Path of the link in the mail; the token follows */
export const DOCUMENT_LINK_PATH = '/api/ax-migration/documents';

/** The systems the requester may say they are thinking about (optional) */
export const AX_DOCUMENT_SYSTEMS = ['as400', 'acos', 'access', 'other'] as const;

const requiredPhone = contactSchema.shape.phone
  .unwrap()
  .refine((value) => value.length > 0, { message: 'Required' });

export const axDocumentRequestSchema = z.object({
  contact: contactSchema.extend({
    phone: requiredPhone,
    department: plainText(100).optional(),
    title: plainText(100).optional(),
  }),
  systems: z
    .array(z.enum(AX_DOCUMENT_SYSTEMS))
    .max(AX_DOCUMENT_SYSTEMS.length)
    .refine((items) => new Set(items).size === items.length, { message: 'Duplicate' })
    .optional(),
  privacyConsent: z.literal(true),
  tracking: trackingSchema,
  locale: z.enum(['ja', 'en']).default('ja'),
  /** Honeypot: people never fill it. The route answers a filled one with a fake success */
  website: z.string().max(500).optional(),
  /** Cloudflare Turnstile token (checked by the route) */
  turnstileToken: z.string().max(2048).optional(),
});
export type AxDocumentRequestInput = z.infer<typeof axDocumentRequestSchema>;

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * The offers the form hands out (lib/features/info-offers), given by the route: that feature
 * already reads the diagnosis, so the diagnosis does not import it back
 */
export interface LandingDocumentOffers {
  /** The organization's landing document with its location, or null when the form is closed */
  getDocument: (
    db: Database,
    organizationId: string
  ) => Promise<{ id: string; title: string } | null>;
  /** Record the request in the transaction that matched or created the lead */
  record: (
    tx: Transaction,
    input: {
      organizationId: string;
      leadId: string;
      leadCreated: boolean;
      document: { id: string; title: string };
      email: string;
      contact: LandingRequestContact;
      downloadTokenHash: string;
      now: Date;
    }
  ) => Promise<{ id: string }>;
  /** Score of a lead created by the request */
  score: number;
  /** How long the mailed link opens the document */
  linkTtlMs: number;
}

export interface AxDocumentRequestDeps {
  offers: LandingDocumentOffers;
  sendEmail: RespondentEmailDeps['sendEmail'];
  /** The app's base URL for the links; NEXT_PUBLIC_APP_URL by default */
  baseUrl?: string;
  /** Test mode (lib/email/allowed-recipients) by default */
  isAllowedEmail?: (email: string) => boolean;
}

/**
 * What the request did. The route answers 'accepted' alike whatever the delivery was; the
 * delivery is for tests and logs only, never the response.
 */
export type RequestAxDocumentResult =
  | {
      outcome: 'accepted';
      delivery: 'sent' | 'suppressed' | 'recent_link' | 'not_allowed' | 'failed';
      /** Null when nothing was recorded (an address no mail can go to) */
      request: {
        id: string;
        leadId: string;
        leadCreated: boolean;
        documentTitle: string;
      } | null;
    }
  /** The organization offers no document on the landing pages: the form is closed */
  | { outcome: 'closed' }
  /** The organization's quota of respondent mail is used up, or the server is busy */
  | { outcome: 'unavailable' };

/** The lead's target system when the requester named exactly one known system */
function targetSystemOf(systems: readonly string[] | undefined): string | null {
  const known = (systems ?? []).filter((system) => system !== 'other');
  return known.length === 1 && (systems ?? []).length === 1 ? known[0] : null;
}

export async function requestAxDocument(
  db: Database,
  deps: AxDocumentRequestDeps,
  organizationId: string,
  input: AxDocumentRequestInput,
  now: Date = new Date()
): Promise<RequestAxDocumentResult> {
  const document = await deps.offers.getDocument(db, organizationId);
  if (!document) return { outcome: 'closed' };

  const locale: AxMailLocale = input.locale === 'en' ? 'en' : 'ja';
  const email = normaliseEmail(input.contact.email);
  const isAllowed = deps.isAllowedEmail ?? ((address: string) => defaultIsAllowedEmail(address));
  // An address no mail can go to (test mode, or not an address): nothing is recorded, and the
  // answer is the same as for a mail that went out
  if (!email || !isAllowed(email)) {
    return { outcome: 'accepted', delivery: 'not_allowed', request: null };
  }

  const contact: LandingRequestContact = {
    company: input.contact.company,
    name: input.contact.name,
    phone: input.contact.phone,
    ...(input.contact.department ? { department: input.contact.department } : {}),
    ...(input.contact.title ? { title: input.contact.title } : {}),
    ...(input.systems && input.systems.length > 0 ? { systems: [...input.systems] } : {}),
  };
  const tracking: Tracking = input.tracking ?? {};

  const result = await holdingLock(
    db,
    // The same lock as the result mail: one respondent mail at a time per address
    `respondent-email:${organizationId}:${email}`,
    'wait',
    async (): Promise<RequestAxDocumentResult> => {
      // One link per address in 24 hours, whichever request asked for it. A timed-out attempt
      // counts as sent: a retry carries another request's key, so Resend would not stop a
      // second mail
      const [recent] = await db
        .select({ id: respondentEmailSends.id })
        .from(respondentEmailSends)
        .where(
          and(
            eq(respondentEmailSends.organizationId, organizationId),
            eq(respondentEmailSends.email, email),
            eq(respondentEmailSends.kind, 'document_link'),
            or(wentOut(), eq(respondentEmailSends.errorCode, SEND_TIMEOUT)),
            gte(respondentEmailSends.createdAt, new Date(now.getTime() - DOCUMENT_LINK_INTERVAL_MS))
          )
        )
        .limit(1);

      if (!recent) {
        // Counted before every attempt, suppressed addresses included (sendRespondentEmail
        // writes a row for those too). The quota is the organization's, so refusing tells
        // nothing about this address; nothing is recorded then
        const quota = await consumeRateLimits(
          db,
          [
            {
              rule: AX_RATE_LIMITS.respondentEmailPerOrganizationHourly,
              identifier: organizationId,
            },
            { rule: AX_RATE_LIMITS.respondentEmailPerOrganization, identifier: organizationId },
          ],
          now
        );
        if (!quota.allowed) return { outcome: 'unavailable' };
      }

      // A new link for every request: only its hash is stored
      const link = newToken();
      const recorded = await db.transaction(async (tx) => {
        const inflow = await resolveInflow(tx, organizationId, tracking);
        const { leadId, existing } = await upsertLeadFromSubmission(tx, {
          organizationId,
          email,
          newLead: {
            name: contact.name,
            company: contact.company,
            phone: contact.phone,
            status: 'new',
            score: deps.offers.score,
            source: 'website',
            inflowSource: inflow.inflowSource,
            referrerName: inflow.referrerName,
            agencyName: inflow.agencyName,
            agencyLinkId: inflow.agencyLinkId,
            conversionPoint: 'document_download',
            targetSystem: targetSystemOf(input.systems),
          },
          now,
        });
        const row = await deps.offers.record(tx, {
          organizationId,
          leadId,
          leadCreated: !existing,
          document,
          email,
          contact,
          downloadTokenHash: link.hash,
          now,
        });
        return { id: row.id, leadId, leadCreated: !existing, documentTitle: document.title };
      });

      if (recent) return { outcome: 'accepted', delivery: 'recent_link', request: recorded };

      const base = (deps.baseUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? '')
        .trim()
        .replace(/\/+$/, '');
      const sent = await sendRespondentEmail(
        db,
        { sendEmail: deps.sendEmail },
        {
          organizationId,
          email,
          kind: 'document_link',
          leadId: recorded.leadId,
          offerRequestId: recorded.id,
          ...unsubscribeUrls({ locale, baseUrl: base }),
          build: (unsubscribeUrl) =>
            buildAxDocumentEmail({
              locale,
              documentTitle: document.title,
              documentUrl: `${base}${DOCUMENT_LINK_PATH}/${encodeURIComponent(link.token)}`,
              validDays: Math.round(deps.offers.linkTtlMs / DAY),
              unsubscribeUrl,
            }),
          // One key per request: the request is recorded once, so a retry of the same send
          // cannot deliver twice
          idempotencyKey: `ax-document:${recorded.id}`,
        }
      );

      if (sent.outcome === 'sent' || sent.outcome === 'already_sent') {
        return { outcome: 'accepted', delivery: 'sent', request: recorded };
      }
      if (sent.outcome === 'suppressed') {
        return { outcome: 'accepted', delivery: 'suppressed', request: recorded };
      }
      if (sent.errorCode === 'recipient_not_allowed') {
        return { outcome: 'accepted', delivery: 'not_allowed', request: recorded };
      }
      // The request is kept (sales can follow it up); the requester may ask again
      return { outcome: 'accepted', delivery: 'failed', request: recorded };
    }
  );
  return result === BUSY ? { outcome: 'unavailable' } : result;
}
