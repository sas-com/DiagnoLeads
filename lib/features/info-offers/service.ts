/**
 * Offers for respondents gathering information (Refs #153): the organization's settings, the
 * requests made from the AX diagnosis result, and seminar attendance. Every query is scoped by
 * organizationId; the public route and the router check what they must.
 */
import type { db as defaultDb } from '@/lib/db/client';
import {
  diagnosticSubmissions,
  leadOfferRequests,
  leads,
  organizations,
  users,
} from '@/lib/db/schema';
import { AX_MIGRATION_DIAGNOSTIC_KEY } from '@/lib/features/diagnostics/ax-migration/definition';
import { RESULT_SCREEN_WINDOW_MS } from '@/lib/features/diagnostics/ax-migration/submission-service';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import {
  INFO_OFFERS_SETTINGS_KEY,
  type InfoOffersSettings,
  OFFER_SCORE,
  type OfferKind,
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

/** Add points to the lead score, kept within 0-100 */
const addScore = (points: number) =>
  sql`least(100, greatest(0, coalesce(${leads.score}, 0) + ${points}))`;

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
      await tx
        .update(leads)
        .set({
          score: addScore(OFFER_SCORE[input.kind]),
          // The first action after the diagnosis; a consultation request stays the conversion
          conversionPoint: sql`case when ${leads.conversionPoint} is null or ${leads.conversionPoint} = 'web_diagnosis' then ${input.kind === 'document' ? 'document_download' : 'seminar'} else ${leads.conversionPoint} end`,
          updatedAt: now,
        })
        .where(
          and(eq(leads.id, submission.leadId), eq(leads.organizationId, submission.organizationId))
        );
    }
    return { ok: true as const, alreadyRequested: false, url };
  });
}

export interface LeadOfferRequestView {
  id: string;
  kind: OfferKind;
  title: string;
  scheduledOn: string | null;
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
  return rows.map((row) => ({ ...row, kind: row.kind as OfferKind }));
}

/**
 * Record whether the respondent attended a seminar. Attending adds to the lead score once;
 * taking it back removes the same points. Only seminars of verified answers change the score.
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
    await tx
      .update(leadOfferRequests)
      .set({
        attendedAt: input.attended ? now : null,
        attendanceRecordedBy: input.attended ? input.userId : null,
      })
      .where(eq(leadOfferRequests.id, input.id));
    if (request.leadId && request.identityVerified) {
      await tx
        .update(leads)
        .set({
          score: addScore(input.attended ? OFFER_SCORE.attended : -OFFER_SCORE.attended),
          updatedAt: now,
        })
        .where(and(eq(leads.id, request.leadId), eq(leads.organizationId, input.organizationId)));
    }
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
