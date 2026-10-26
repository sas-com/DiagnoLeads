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
import { asc, desc, inArray, sql } from 'drizzle-orm';

type Database = typeof defaultDb;

/**
 * Read the glossary entries for the given field keys. Returns each field's own entry first, then
 * its value entries by sort_order, so the caller can group them without another sort.
 */
export async function getFieldGlossaryEntries(
  executor: Database,
  keys: string[]
): Promise<FieldGlossaryEntry[]> {
  if (keys.length === 0) return [];
  return executor
    .select()
    .from(fieldGlossary)
    .where(inArray(fieldGlossary.fieldKey, keys))
    .orderBy(
      asc(fieldGlossary.fieldKey),
      // Field-level entry (value is null) before the field's value entries
      desc(sql`${fieldGlossary.value} is null`),
      asc(fieldGlossary.sortOrder)
    );
}
