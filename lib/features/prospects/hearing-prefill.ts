/**
 * What employees heard in the customer search (#265), as prior information of a new hearing:
 * it fills only what the diagnosis and the sales agency left empty (diagnosis > agency >
 * employee), and is marked 社員の記録 until the meeting confirms it.
 *
 * Only what maps without guessing goes in: the system, and a note in 課題のメモ with the
 * troubles, the support end and what was heard. How serious each trouble is stays for the
 * meeting to ask.
 */
import type { db as defaultDb } from '@/lib/db/client';
import { prospects, users } from '@/lib/db/schema';
import {
  type HearingFieldEntry,
  type HearingFields,
  parseStoredHearingFields,
} from '@/lib/features/lead-hearings/types/schemas';
import { and, asc, eq, sql } from 'drizzle-orm';
import { leadNoteFromProspect } from './lead-link';

type Database = typeof defaultDb;

/** 課題のメモ holds at most this many characters (the catalog's text default) */
const NOTE_MAX = 1000;

export interface ProspectForPrefill {
  contactedOn: string;
  recorder: string | null;
  department: string | null;
  jobTitle: string | null;
  surname: string | null;
  targetSystem: string | null;
  supportEndSoon: string | null;
  troubles: string[];
  heard: string | null;
}

export function referralHearingFields(
  rows: readonly ProspectForPrefill[],
  existing: HearingFields
): HearingFields {
  if (rows.length === 0) return existing;
  const entries: Record<string, HearingFieldEntry> = {};
  // The latest row that names a system
  const system = [...rows].reverse().find((row) => row.targetSystem)?.targetSystem;
  if (system && !existing.targetSystem) {
    entries.targetSystem = { value: system, status: 'not_yet', source: 'referral' };
  }
  if (!existing.challengeNotes) {
    // Cut by characters, not UTF-16 units, so an emoji is never split
    const note = Array.from(rows.map((row) => leadNoteFromProspect(row)).join('\n\n'))
      .slice(0, NOTE_MAX)
      .join('');
    entries.challengeNotes = { value: note, status: 'not_yet', source: 'referral' };
  }
  // Values outside the catalog are left out, as for the other prefills
  const { fields } = parseStoredHearingFields(entries);
  return { ...existing, ...fields };
}

/** Customer search rows linked to the lead, oldest first */
export async function findProspectsForPrefill(
  db: Pick<Database, 'select'>,
  input: { organizationId: string; leadId: string }
): Promise<ProspectForPrefill[]> {
  const rows = await db
    .select({
      contactedOn: prospects.contactedOn,
      recorderName: prospects.recorderName,
      creatorName: sql<string | null>`coalesce(nullif(trim(${users.name}), ''), ${users.email})`,
      department: prospects.department,
      jobTitle: prospects.jobTitle,
      surname: prospects.surname,
      targetSystem: prospects.targetSystem,
      supportEndSoon: prospects.supportEndSoon,
      troubles: prospects.troubles,
      heard: prospects.heard,
    })
    .from(prospects)
    .leftJoin(users, eq(users.id, prospects.createdBy))
    .where(
      and(eq(prospects.organizationId, input.organizationId), eq(prospects.leadId, input.leadId))
    )
    .orderBy(asc(prospects.contactedOn), asc(prospects.createdAt));
  return rows.map(({ recorderName, creatorName, ...row }) => ({
    ...row,
    recorder: recorderName ?? creatorName,
  }));
}
