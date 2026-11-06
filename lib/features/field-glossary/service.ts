/**
 * Field glossary data access (Epic #780 P0b).
 *
 * The dictionary is site-wide: entries are the same for every organization and carry no
 * organizationId (decision 2026-10-26-field-glossary-site-wide), so reads are not scoped by
 * organization, like CMS content. A field has at most one field-level entry (value is null) and
 * any number of value entries (value set).
 */

import type { db as defaultDb } from '@/lib/db/client';
import { type FieldGlossaryEntry, fieldGlossary } from '@/lib/db/schema';
import { asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';

type Database = typeof defaultDb;

/**
 * The columns the screens need. Every signed-in user of any organization reads them, so who last
 * edited an entry (updated_by, an operator's user id) and the timestamps stay out (#800 review).
 */
const HELP_COLUMNS = {
  id: fieldGlossary.id,
  fieldKey: fieldGlossary.fieldKey,
  value: fieldGlossary.value,
  labelJa: fieldGlossary.labelJa,
  labelEn: fieldGlossary.labelEn,
  descriptionJa: fieldGlossary.descriptionJa,
  descriptionEn: fieldGlossary.descriptionEn,
  sortOrder: fieldGlossary.sortOrder,
};

export type FieldGlossaryHelp = Pick<FieldGlossaryEntry, keyof typeof HELP_COLUMNS>;

/** One entry as an editor writes it; the router has checked the key and value against the list */
export interface FieldGlossaryWrite {
  fieldKey: string;
  value: string | null;
  descriptionJa: string;
  descriptionEn: string | null;
  sortOrder: number;
  updatedBy: string;
}

/**
 * Read the glossary entries for the given field keys. Returns each field's own entry first, then
 * its value entries by sort_order, so the caller can group them without another sort.
 */
export async function getFieldGlossaryEntries(
  executor: Database,
  keys: string[]
): Promise<FieldGlossaryHelp[]> {
  if (keys.length === 0) return [];
  return executor
    .select(HELP_COLUMNS)
    .from(fieldGlossary)
    .where(inArray(fieldGlossary.fieldKey, keys))
    .orderBy(
      asc(fieldGlossary.fieldKey),
      // Field-level entry (value is null) before the field's value entries
      desc(sql`${fieldGlossary.value} is null`),
      asc(fieldGlossary.sortOrder)
    );
}

/**
 * Write the entry for a field (value null) or one of its values, replacing the one already there.
 * Each kind has its own partial unique index, so the conflict target names the one that applies.
 */
export async function upsertFieldGlossaryEntry(
  executor: Database,
  entry: FieldGlossaryWrite
): Promise<FieldGlossaryEntry> {
  const values = {
    fieldKey: entry.fieldKey,
    value: entry.value,
    descriptionJa: entry.descriptionJa,
    descriptionEn: entry.descriptionEn,
    sortOrder: entry.sortOrder,
    updatedBy: entry.updatedBy,
  };
  const set = {
    descriptionJa: entry.descriptionJa,
    descriptionEn: entry.descriptionEn,
    sortOrder: entry.sortOrder,
    updatedBy: entry.updatedBy,
    updatedAt: new Date(),
  };
  const [row] = await executor
    .insert(fieldGlossary)
    .values(values)
    .onConflictDoUpdate(
      entry.value === null
        ? { target: fieldGlossary.fieldKey, targetWhere: isNull(fieldGlossary.value), set }
        : {
            target: [fieldGlossary.fieldKey, fieldGlossary.value],
            targetWhere: isNotNull(fieldGlossary.value),
            set,
          }
    )
    .returning();
  return row;
}

/**
 * Delete one entry. The table has no organization (it is site-wide), so the id alone names the
 * row; the router has made sure the caller is an editor. Returns whether a row was deleted.
 */
export async function deleteFieldGlossaryEntry(executor: Database, id: string): Promise<boolean> {
  const deleted = await executor
    .delete(fieldGlossary)
    .where(eq(fieldGlossary.id, id))
    .returning({ id: fieldGlossary.id });
  return deleted.length > 0;
}
