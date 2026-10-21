/**
 * Agency handovers (Refs #152): importing the agency's appointment reports, reading a lead's
 * handover, and the hearing prefill from it. Every query is scoped by organizationId; the router
 * checks permissions.
 */
import type { db as defaultDb } from '@/lib/db/client';
import { agencyHandovers, leads, users } from '@/lib/db/schema';
import type { HearingFieldEntry, HearingFields } from '@/lib/features/lead-hearings/types/schemas';
import { parseStoredHearingFields } from '@/lib/features/lead-hearings/types/schemas';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { type HandoverRow, handoverRowSchema } from './types/schemas';

type Database = typeof defaultDb;

export type HandoverImportStatus = 'saved' | 'unmatched' | 'ambiguous' | 'invalid';

export interface HandoverImportResult {
  index: number;
  status: HandoverImportStatus;
  leadId?: string;
}

/**
 * Save the rows of a report. Each row finds its lead by email address, or else by company name
 * when exactly one lead of the organization has it; a later import replaces the lead's handover.
 * Rows without a lead are reported, not saved (no lead is created from an agency report).
 */
export async function importHandovers(
  db: Database,
  input: { organizationId: string; userId: string; rows: unknown[] },
  now: Date = new Date()
): Promise<{ results: HandoverImportResult[] }> {
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
  // The last row wins when a report lists a lead twice
  const toSave = new Map<string, { index: number; row: HandoverRow }>();
  for (const { index, row } of valid) {
    const candidates = row.email
      ? (byEmail.get(row.email) ?? [])
      : (byCompany.get(row.company?.toLowerCase() ?? '') ?? []);
    if (candidates.length > 1) {
      results[index] = { index, status: 'ambiguous' };
    } else if (candidates.length === 1) {
      toSave.set(candidates[0], { index, row });
      results[index] = { index, status: 'saved', leadId: candidates[0] };
    }
  }

  for (const [leadId, { row }] of toSave) {
    const { email: _email, company: _company, ...values } = row;
    const record = { ...values, importedBy: input.userId, updatedAt: now };
    await db
      .insert(agencyHandovers)
      .values({ ...record, organizationId: input.organizationId, leadId, createdAt: now })
      .onConflictDoUpdate({
        target: agencyHandovers.leadId,
        set: record,
        // Never across organizations
        setWhere: eq(agencyHandovers.organizationId, input.organizationId),
      });
  }
  return { results };
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
