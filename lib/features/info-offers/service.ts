/**
 * Offers for respondents gathering information (Refs #153): the organization's settings, the
 * requests made from the AX diagnosis result, and seminar attendance. Every query is scoped by
 * organizationId; the public route and the router check what they must.
 */
import type { db as defaultDb } from '@/lib/db/client';
import {
  type LandingRequestContact,
  diagnosticSubmissions,
  leadOfferRequests,
  leads,
  organizations,
  users,
} from '@/lib/db/schema';
import { AX_MIGRATION_DIAGNOSTIC_KEY } from '@/lib/features/diagnostics/ax-migration/definition';
import { RESULT_SCREEN_WINDOW_MS } from '@/lib/features/diagnostics/ax-migration/submission-service';
import { hashToken } from '@/lib/features/respondent-email';
import { and, desc, eq, gte, isNull, ne, sql } from 'drizzle-orm';
import {
  INFO_OFFERS_SETTINGS_KEY,
  type InfoDocument,
  type InfoOffersSettings,
  OFFER_SCORE,
  type OfferKind,
  landingDocument,
  readInfoOffers,
} from './types/schemas';

type Database = typeof defaultDb;
type Executor = Pick<Database, 'select' | 'update'>;

export async function getInfoOffers(
  db: Executor,
  organizationId: string
): Promise<InfoOffersSettings> {
  const [row] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  return readInfoOffers(row?.settings);
}

/** Only this key of the settings is replaced (merged in SQL) */
export async function saveInfoOffers(
  db: Executor,
  organizationId: string,
  settings: InfoOffersSettings
): Promise<void> {
  await db
    .update(organizations)
    .set({
      settings: sql`coalesce(${organizations.settings}, '{}'::jsonb) || jsonb_build_object(${INFO_OFFERS_SETTINGS_KEY}::text, ${JSON.stringify(settings)}::jsonb)`,
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, organizationId));
}

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Add points to the lead score, kept within 0-100, and return what was actually added. The lead
 * row is locked so concurrent requests add up.
 */
async function addLeadScore(
  tx: Transaction,
  lead: { id: string; organizationId: string },
  points: number,
  now: Date,
  extra: Partial<typeof leads.$inferInsert> | Record<string, unknown> = {}
): Promise<number> {
  const [row] = await tx
    .select({ score: leads.score })
    .from(leads)
    .where(and(eq(leads.id, lead.id), eq(leads.organizationId, lead.organizationId)))
    .for('no key update');
  if (!row) return 0;
  const before = row.score ?? 0;
  const after = Math.min(100, Math.max(0, before + points));
  await tx
    .update(leads)
    .set({ ...extra, ...(after !== before ? { score: after } : {}), updatedAt: now })
    .where(and(eq(leads.id, lead.id), eq(leads.organizationId, lead.organizationId)));
  return after - before;
}

export type RequestInfoOfferOutcome =
  | { ok: true; alreadyRequested: boolean; url: string | null }
  | { ok: false; reason: 'not_found' | 'closed' | 'unavailable' };

/**
 * Record a request made from the result page. Only while the result screen can still be open
 * (like the consultation request), only for an offer the organization offers now, once per
 * submission and offer. The lead gets the conversion point (when it had only the diagnosis)
 * and the score only when the answer created or continued it: a lead matched by email alone is
 * not changed by someone who may not be its owner (#233).
 */
export async function requestInfoOffer(
  database: Database,
  input: { submissionId: string; kind: OfferKind; offerId: string },
  now: Date = new Date()
): Promise<RequestInfoOfferOutcome> {
  const [submission] = await database
    .select({
      organizationId: diagnosticSubmissions.organizationId,
      leadId: diagnosticSubmissions.leadId,
      leadCreated: diagnosticSubmissions.leadCreated,
      continuedFrom: diagnosticSubmissions.continuedFromSubmissionId,
      createdAt: diagnosticSubmissions.createdAt,
    })
    .from(diagnosticSubmissions)
    .where(
      and(
        eq(diagnosticSubmissions.id, input.submissionId),
        eq(diagnosticSubmissions.diagnosticKey, AX_MIGRATION_DIAGNOSTIC_KEY)
      )
    );
  if (!submission) return { ok: false, reason: 'not_found' };
  if (submission.createdAt.getTime() < now.getTime() - RESULT_SCREEN_WINDOW_MS) {
    return { ok: false, reason: 'closed' };
  }

  const settings = await getInfoOffers(database, submission.organizationId);
  if (!settings.enabled) return { ok: false, reason: 'unavailable' };
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(now);
  const offer =
    input.kind === 'document'
      ? settings.documents.find((item) => item.id === input.offerId)
      : settings.seminars.find((item) => item.id === input.offerId && item.date >= today);
  if (!offer) return { ok: false, reason: 'unavailable' };
  const url = 'url' in offer ? offer.url : null;
  const identityVerified = submission.leadCreated || submission.continuedFrom !== null;

  return database.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(leadOfferRequests)
      .values({
        organizationId: submission.organizationId,
        leadId: submission.leadId,
        submissionId: input.submissionId,
        kind: input.kind,
        offerId: offer.id,
        title: offer.title,
        scheduledOn: 'date' in offer ? offer.date : null,
        identityVerified,
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: leadOfferRequests.id });
    if (!inserted) return { ok: true as const, alreadyRequested: true, url };

    if (submission.leadId && identityVerified) {
      // The same offer through another answer of the same person (another system diagnosed
      // from the result) is recorded, but counts once
      const [earlier] = await tx
        .select({ id: leadOfferRequests.id })
        .from(leadOfferRequests)
        .where(
          and(
            eq(leadOfferRequests.organizationId, submission.organizationId),
            eq(leadOfferRequests.leadId, submission.leadId),
            eq(leadOfferRequests.kind, input.kind),
            eq(leadOfferRequests.offerId, offer.id),
            eq(leadOfferRequests.identityVerified, true),
            ne(leadOfferRequests.id, inserted.id)
          )
        )
        .limit(1);
      const added = await addLeadScore(
        tx,
        { id: submission.leadId, organizationId: submission.organizationId },
        earlier ? 0 : OFFER_SCORE[input.kind],
        now,
        {
          // The first action after the diagnosis; a consultation request stays the conversion
          conversionPoint: sql`case when ${leads.conversionPoint} is null or ${leads.conversionPoint} = 'web_diagnosis' then ${input.kind === 'document' ? 'document_download' : 'seminar'} else ${leads.conversionPoint} end`,
        }
      );
      if (added !== 0) {
        await tx
          .update(leadOfferRequests)
          .set({ scorePoints: added })
          .where(eq(leadOfferRequests.id, inserted.id));
      }
    }
    return { ok: true as const, alreadyRequested: false, url };
  });
}

// ---------------------------------------------------------------------------------------------
// Requests from the landing pages' form (#899)
// ---------------------------------------------------------------------------------------------

/** How long the mailed link opens the document */
export const LANDING_DOCUMENT_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** The organization's landing document with its location, or null when the form is closed */
export async function getLandingDocument(
  db: Executor,
  organizationId: string
): Promise<InfoDocument | null> {
  return landingDocument(await getInfoOffers(db, organizationId));
}

/**
 * Record a request of the landing form, inside the caller's transaction (the one that matched
 * or created the lead). A lead created by the request gets OFFER_SCORE.document as its score
 * from the caller, recorded here as the request's points; a lead matched by email alone is not
 * changed (identityVerified false), as on the diagnosis (#233).
 */
export async function recordLandingOfferRequest(
  tx: Pick<Database, 'insert'>,
  input: {
    organizationId: string;
    leadId: string;
    leadCreated: boolean;
    document: Pick<InfoDocument, 'id' | 'title'>;
    email: string;
    contact: LandingRequestContact;
    downloadTokenHash: string;
    now: Date;
  }
): Promise<{ id: string }> {
  const [row] = await tx
    .insert(leadOfferRequests)
    .values({
      organizationId: input.organizationId,
      leadId: input.leadId,
      submissionId: null,
      kind: 'document',
      offerId: input.document.id,
      title: input.document.title,
      source: 'landing',
      email: input.email,
      contact: input.contact,
      identityVerified: input.leadCreated,
      scorePoints: input.leadCreated ? OFFER_SCORE.document : 0,
      downloadTokenHash: input.downloadTokenHash,
      downloadExpiresAt: new Date(input.now.getTime() + LANDING_DOCUMENT_LINK_TTL_MS),
      createdAt: input.now,
    })
    .returning({ id: leadOfferRequests.id });
  return row;
}

/** Tokens of the mailed links are 32 random bytes in base64url (43 characters) */
const LINK_TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

export type OpenLandingDocumentOutcome =
  | { outcome: 'open'; url: string }
  | { outcome: 'expired' | 'not_found' | 'unavailable' };

/**
 * Open the document of a mailed link: the first opening is recorded, then the caller redirects
 * to the document's current location. The token is looked up by its hash; everything after is
 * scoped by the organization of the request it belongs to. A document removed from the settings
 * since the mail is 'unavailable'.
 */
export async function openLandingDocument(
  db: Database,
  token: string,
  now: Date = new Date()
): Promise<OpenLandingDocumentOutcome> {
  if (!LINK_TOKEN.test(token)) return { outcome: 'not_found' };
  const hash = hashToken(token);
  const [request] = await db
    .select({
      id: leadOfferRequests.id,
      organizationId: leadOfferRequests.organizationId,
      offerId: leadOfferRequests.offerId,
      expiresAt: leadOfferRequests.downloadExpiresAt,
    })
    .from(leadOfferRequests)
    .where(
      and(
        eq(leadOfferRequests.downloadTokenHash, hash),
        eq(leadOfferRequests.source, 'landing'),
        eq(leadOfferRequests.kind, 'document')
      )
    )
    .limit(1);
  if (!request) return { outcome: 'not_found' };
  if (!request.expiresAt || request.expiresAt.getTime() <= now.getTime()) {
    return { outcome: 'expired' };
  }

  const settings = await getInfoOffers(db, request.organizationId);
  const document = settings.documents.find((item) => item.id === request.offerId);
  if (!document) return { outcome: 'unavailable' };

  await db
    .update(leadOfferRequests)
    .set({ openedAt: now })
    .where(
      and(
        eq(leadOfferRequests.id, request.id),
        eq(leadOfferRequests.organizationId, request.organizationId),
        isNull(leadOfferRequests.openedAt)
      )
    );
  return { outcome: 'open', url: document.url };
}

export interface LeadOfferRequestView {
  id: string;
  kind: OfferKind;
  title: string;
  scheduledOn: string | null;
  /** 'result' (the diagnosis result) or 'landing' (the landing pages' form, #899) */
  source: 'result' | 'landing';
  /** First opening of the mailed link (landing requests) */
  openedAt: Date | null;
  identityVerified: boolean;
  attendedAt: Date | null;
  attendanceRecordedByName: string | null;
  createdAt: Date;
}

/** The lead's requests, newest first; undefined when the lead is not found */
export async function listLeadOfferRequests(
  db: Database,
  input: { organizationId: string; leadId: string }
): Promise<LeadOfferRequestView[] | undefined> {
  const [lead] = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.id, input.leadId), eq(leads.organizationId, input.organizationId)));
  if (!lead) return undefined;
  const rows = await db
    .select({
      id: leadOfferRequests.id,
      kind: leadOfferRequests.kind,
      title: leadOfferRequests.title,
      scheduledOn: leadOfferRequests.scheduledOn,
      source: leadOfferRequests.source,
      openedAt: leadOfferRequests.openedAt,
      identityVerified: leadOfferRequests.identityVerified,
      attendedAt: leadOfferRequests.attendedAt,
      attendanceRecordedByName: sql<
        string | null
      >`coalesce(nullif(trim(${users.name}), ''), ${users.email})`,
      createdAt: leadOfferRequests.createdAt,
    })
    .from(leadOfferRequests)
    .leftJoin(users, eq(users.id, leadOfferRequests.attendanceRecordedBy))
    .where(
      and(
        eq(leadOfferRequests.organizationId, input.organizationId),
        eq(leadOfferRequests.leadId, input.leadId)
      )
    )
    .orderBy(desc(leadOfferRequests.createdAt));
  return rows.map((row) => ({
    ...row,
    kind: row.kind as OfferKind,
    source: row.source === 'landing' ? 'landing' : 'result',
  }));
}

/**
 * Record whether the respondent attended a seminar. Attending adds to the lead score once;
 * taking it back removes exactly what was added. Only seminars of verified answers change the
 * score.
 * false when the request is not found (or is not a seminar)
 */
export async function setSeminarAttendance(
  database: Database,
  input: { organizationId: string; id: string; attended: boolean; userId: string },
  now: Date = new Date()
): Promise<boolean> {
  return database.transaction(async (tx) => {
    const [request] = await tx
      .select({
        leadId: leadOfferRequests.leadId,
        attendedAt: leadOfferRequests.attendedAt,
        attendancePoints: leadOfferRequests.attendancePoints,
        identityVerified: leadOfferRequests.identityVerified,
      })
      .from(leadOfferRequests)
      .where(
        and(
          eq(leadOfferRequests.id, input.id),
          eq(leadOfferRequests.organizationId, input.organizationId),
          eq(leadOfferRequests.kind, 'seminar')
        )
      )
      .for('update');
    if (!request) return false;
    if ((request.attendedAt !== null) === input.attended) return true;
    // Attending adds up to OFFER_SCORE.attended; taking it back removes what was added
    const points =
      request.leadId && request.identityVerified
        ? await addLeadScore(
            tx,
            { id: request.leadId, organizationId: input.organizationId },
            input.attended ? OFFER_SCORE.attended : -request.attendancePoints,
            now
          )
        : 0;
    await tx
      .update(leadOfferRequests)
      .set({
        attendedAt: input.attended ? now : null,
        attendanceRecordedBy: input.attended ? input.userId : null,
        attendancePoints: input.attended ? points : 0,
      })
      .where(eq(leadOfferRequests.id, input.id));
    return true;
  });
}

/** Requests per seminar from today on, for the settings screen */
export async function countSeminarRequests(
  db: Database,
  organizationId: string,
  since: string
): Promise<Record<string, { requested: number; attended: number }>> {
  const rows = await db
    .select({
      offerId: leadOfferRequests.offerId,
      requested: sql<number>`count(*)::int`,
      attended: sql<number>`count(${leadOfferRequests.attendedAt})::int`,
    })
    .from(leadOfferRequests)
    .where(
      and(
        eq(leadOfferRequests.organizationId, organizationId),
        eq(leadOfferRequests.kind, 'seminar'),
        gte(leadOfferRequests.scheduledOn, since)
      )
    )
    .groupBy(leadOfferRequests.offerId);
  return Object.fromEntries(
    rows.map((row) => [row.offerId, { requested: row.requested, attended: row.attended }])
  );
}
