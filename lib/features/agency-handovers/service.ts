/**
 * Agency handovers (Refs #152): importing the agency's appointment reports, reading a lead's
 * handover, and the hearing prefill from it. Every query is scoped by organizationId; the router
 * checks permissions.
 *
 * An appointment day that a report sets for a lead, new or another day than before, is the lead's
 * first meeting: the import creates its deal in 見極め in the same transaction (#854, decision
 * 2026-10-28-auto-qualification-deal; see ensureQualificationDeals in the deals feature).
 */
import type { db as defaultDb } from '@/lib/db/client';
import { agencyHandovers, leads, users } from '@/lib/db/schema';
import { afterDealChanges, ensureQualificationDeals } from '@/lib/features/deals/service';
import type { HearingFieldEntry, HearingFields } from '@/lib/features/lead-hearings/types/schemas';
import { parseStoredHearingFields } from '@/lib/features/lead-hearings/types/schemas';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { type HandoverRow, handoverRowSchema } from './types/schemas';

type Database = typeof defaultDb;

/** 'replaced': a later row of the same report was for the same lead and was saved instead */
export type HandoverImportStatus = 'saved' | 'unmatched' | 'ambiguous' | 'invalid' | 'replaced';

export interface HandoverImportResult {
  index: number;
  status: HandoverImportStatus;
  leadId?: string;
}

/**
 * Save the rows of a report. Each row finds its lead by email address, or else by company name
 * when exactly one lead of the organization has it; a later import replaces the lead's handover,
 * except an appointment day the later row leaves empty: the day saved before stays (#854).
 * Rows without a lead are reported, not saved (no lead is created from an agency report).
 *
 * A row whose appointment day is new for its lead, or another day than the one saved before,
 * creates the lead's deal in 見極め (#854), unless the lead has an open deal, is won, or the other
 * cases of qualificationDealSkip; importing the same day again creates none, even after sales
 * lost the deal. The answer counts the deals created, never shows them (#276). Their webhooks
 * go out in one call after the commit, within the limit of one call (LEAD_WEBHOOK_EVENT_LIMIT:
 * the events past it are dropped and reported, as for an import of leads).
 */
export async function importHandovers(
  db: Database,
  input: { organizationId: string; userId: string; rows: unknown[] },
  now: Date = new Date()
): Promise<{ results: HandoverImportResult[]; dealsCreated: number }> {
  const parsed = input.rows.map((raw) => handoverRowSchema.safeParse(raw));
  const valid = parsed.flatMap((result, index) =>
    result.success ? [{ index, row: result.data }] : []
  );
  const emails = [...new Set(valid.flatMap(({ row }) => (row.email ? [row.email] : [])))];
  const companies = [
    ...new Set(
      valid.flatMap(({ row }) => (!row.email && row.company ? [row.company.toLowerCase()] : []))
    ),
  ];
  const [byEmailRows, byCompanyRows] = await Promise.all([
    emails.length === 0
      ? []
      : db
          .select({ id: leads.id, email: sql<string>`lower(${leads.email})` })
          .from(leads)
          .where(
            and(
              eq(leads.organizationId, input.organizationId),
              inArray(sql`lower(${leads.email})`, emails)
            )
          ),
    companies.length === 0
      ? []
      : db
          .select({ id: leads.id, company: sql<string>`lower(trim(${leads.company}))` })
          .from(leads)
          .where(
            and(
              eq(leads.organizationId, input.organizationId),
              inArray(sql`lower(trim(${leads.company}))`, companies)
            )
          ),
  ]);
  const group = (rows: { id: string; key: string }[]) => {
    const map = new Map<string, string[]>();
    for (const row of rows) map.set(row.key, [...(map.get(row.key) ?? []), row.id]);
    return map;
  };
  const byEmail = group(byEmailRows.map((row) => ({ id: row.id, key: row.email })));
  const byCompany = group(byCompanyRows.map((row) => ({ id: row.id, key: row.company })));

  const results: HandoverImportResult[] = parsed.map((result, index) =>
    result.success ? { index, status: 'unmatched' } : { index, status: 'invalid' }
  );
  // The last row wins when a report lists a lead twice; the earlier rows are kept to report them
  const toSave = new Map<string, { index: number; row: HandoverRow; replaced: number[] }>();
  for (const { index, row } of valid) {
    const candidates = row.email
      ? (byEmail.get(row.email) ?? [])
      : (byCompany.get(row.company?.toLowerCase() ?? '') ?? []);
    if (candidates.length > 1) {
      results[index] = { index, status: 'ambiguous' };
    } else if (candidates.length === 1) {
      const earlier = toSave.get(candidates[0]);
      if (earlier) results[earlier.index] = { index: earlier.index, status: 'replaced' };
      const replaced = earlier ? [...earlier.replaced, earlier.index] : [];
      toSave.set(candidates[0], { index, row, replaced });
      results[index] = { index, status: 'saved', leadId: candidates[0] };
    }
  }
  /** None of a lead's rows was saved: none of them was replaced by a saved row either */
  const unmatched = (rows: { index: number; replaced: number[] }) => {
    for (const index of [...rows.replaced, rows.index]) {
      results[index] = { index, status: 'unmatched' };
    }
  };

  // All or nothing: a row the database rejects leaves the report unsaved, not half of it
  const outcomes = await db.transaction(async (tx) => {
    const leadIds = [...toSave.keys()];
    // The leads first, in the order of their ids, in one statement; then their handovers. Two
    // imports of the same leads take them in the same order, and the paths that lock one lead
    // (deals, a confirmed meeting, a customer search row, a lead's update, a diagnosis answer)
    // take it before its rows, so none of them deadlocks with an import. The bulk status change
    // and the bulk deletion of leads take theirs in the order of their ids too (#967)
    const locked =
      leadIds.length === 0
        ? []
        : await tx
            .select({ id: leads.id })
            .from(leads)
            .where(and(eq(leads.organizationId, input.organizationId), inArray(leads.id, leadIds)))
            .orderBy(asc(leads.id))
            .for('no key update');
    const found = new Set(locked.map((lead) => lead.id));
    // The appointment days saved before, read under the lock: an import that saved the same
    // leads a moment before is seen
    const before =
      found.size === 0
        ? []
        : await tx
            .select({
              leadId: agencyHandovers.leadId,
              appointmentOn: agencyHandovers.appointmentOn,
            })
            .from(agencyHandovers)
            .where(
              and(
                eq(agencyHandovers.organizationId, input.organizationId),
                inArray(agencyHandovers.leadId, [...found])
              )
            );
    const appointedBefore = new Map(before.map((handover) => [handover.leadId, handover]));

    const meetings: { leadId: string; meetingOn: string }[] = [];
    for (const [leadId, rows] of toSave) {
      // Deleted since the report was matched
      if (!found.has(leadId)) {
        unmatched(rows);
        continue;
      }
      const { email: _email, company: _company, ...values } = rows.row;
      const record = { ...values, importedBy: input.userId, updatedAt: now };
      const [saved] = await tx
        .insert(agencyHandovers)
        .values({ ...record, organizationId: input.organizationId, leadId, createdAt: now })
        .onConflictDoUpdate({
          target: agencyHandovers.leadId,
          set: {
            ...record,
            // An empty appointment day (a column not mapped, a day not read) keeps the one saved
            // before: the next report of that day is then no new first meeting (#854)
            appointmentOn: rows.row.appointmentOn ?? sql`${agencyHandovers.appointmentOn}`,
          },
          // Never across organizations
          setWhere: eq(agencyHandovers.organizationId, input.organizationId),
        })
        .returning({ id: agencyHandovers.id });
      if (!saved) {
        unmatched(rows);
        continue;
      }
      // The first meeting is set: a new appointment day, or another day than before (#854). The
      // same day again keeps the deal as it is, even one lost meanwhile
      const appointmentOn = rows.row.appointmentOn;
      if (appointmentOn && appointmentOn !== appointedBefore.get(leadId)?.appointmentOn) {
        meetings.push({ leadId, meetingOn: appointmentOn });
      }
    }
    // The deals of all of them at once: a report of 500 appointments stays within the time of a
    // function and holds its leads briefly
    return ensureQualificationDeals(
      tx,
      {
        organizationId: input.organizationId,
        userId: input.userId,
        source: 'agency_handover',
        meetings,
      },
      now
    );
  });

  // The webhooks of the leads the deals moved, in one call after the commit
  const created = outcomes.flatMap((outcome) => (outcome.created ? [outcome] : []));
  if (created.length > 0) {
    await afterDealChanges(
      db,
      { organizationId: input.organizationId, userId: input.userId },
      created
    );
  }
  return { results, dealsCreated: created.length };
}

export interface AgencyHandoverView extends Omit<HandoverRow, 'email' | 'company'> {
  updatedAt: Date;
  importedByName: string | null;
}

/** The lead's handover (null when none); undefined when the lead is not found */
export async function getLeadHandover(
  db: Database,
  input: { organizationId: string; leadId: string }
): Promise<AgencyHandoverView | null | undefined> {
  const [lead] = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.id, input.leadId), eq(leads.organizationId, input.organizationId)));
  if (!lead) return undefined;
  const [row] = await db
    .select({
      agencyName: agencyHandovers.agencyName,
      appointmentOn: agencyHandovers.appointmentOn,
      contactName: agencyHandovers.contactName,
      contactTitle: agencyHandovers.contactTitle,
      contactPhone: agencyHandovers.contactPhone,
      machineModel: agencyHandovers.machineModel,
      machineModelConfirmed: agencyHandovers.machineModelConfirmed,
      hardwareSupportEnd: agencyHandovers.hardwareSupportEnd,
      retirementPlan: agencyHandovers.retirementPlan,
      decisionMakerPresent: agencyHandovers.decisionMakerPresent,
      interestLevel: agencyHandovers.interestLevel,
      refusalReason: agencyHandovers.refusalReason,
      note: agencyHandovers.note,
      updatedAt: agencyHandovers.updatedAt,
      importedByName: sql<string | null>`coalesce(nullif(trim(${users.name}), ''), ${users.email})`,
    })
    .from(agencyHandovers)
    .leftJoin(users, eq(users.id, agencyHandovers.importedBy))
    .where(
      and(
        eq(agencyHandovers.leadId, input.leadId),
        eq(agencyHandovers.organizationId, input.organizationId)
      )
    );
  return row ? (row as AgencyHandoverView) : null;
}

/**
 * Hearing fields prefilled from the handover (source 'agency': not confirmed until the meeting).
 * Only fields the diagnosis did not fill: the respondent's own answer comes first.
 */
export function handoverHearingFields(
  handover: {
    machineModel: string | null;
    hardwareSupportEnd: string | null;
    retirementPlan: string | null;
    decisionMakerPresent: string | null;
  } | null,
  existing: HearingFields
): HearingFields {
  if (!handover) return existing;
  const values: Record<string, unknown> = {
    machineModel: handover.machineModel,
    hardwareSupportEnd: handover.hardwareSupportEnd,
    earliestRetirement: handover.retirementPlan,
    decisionMakerPresent: handover.decisionMakerPresent,
  };
  const entries: Record<string, HearingFieldEntry> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined) continue;
    if (existing[key as keyof HearingFields]) continue;
    entries[key] = {
      value: value as HearingFieldEntry['value'],
      status: 'not_yet',
      source: 'agency',
    };
  }
  // Values outside the catalog are left out, as for the diagnosis prefill
  const { fields } = parseStoredHearingFields(entries);
  return { ...existing, ...fields };
}

/** The handover's fields the hearing prefill reads */
export async function findHandoverForPrefill(
  db: Pick<Database, 'select'>,
  input: { organizationId: string; leadId: string }
) {
  const [row] = await db
    .select({
      machineModel: agencyHandovers.machineModel,
      hardwareSupportEnd: agencyHandovers.hardwareSupportEnd,
      retirementPlan: agencyHandovers.retirementPlan,
      decisionMakerPresent: agencyHandovers.decisionMakerPresent,
    })
    .from(agencyHandovers)
    .where(
      and(
        eq(agencyHandovers.leadId, input.leadId),
        eq(agencyHandovers.organizationId, input.organizationId)
      )
    );
  return row ?? null;
}
