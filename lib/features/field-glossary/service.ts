/**
 * Field glossary data access (Epic #780 P0b).
 *
 * The dictionary is site-wide: entries are the same for every organization and carry no
 * organizationId (decision 2026-10-26-field-glossary-site-wide), so reads are not scoped by
 * organization, like CMS content. A field has at most one field-level entry (value is null) and
 * any number of value entries (value set).
 *
 * Writes are restricted to owners/admins of the operator organization (the one that receives the
 * AX diagnosis). content_editors is being removed (#339 P2), so it is not used; no one may edit
 * while no operator organization is configured.
 */

import type { db as defaultDb } from '@/lib/db/client';
import {
  type FieldGlossaryEntry,
  type OrganizationRole,
  fieldGlossary,
  organizationMembers,
} from '@/lib/db/schema';
import { resolveDiagnosisOrganizationId } from '@/lib/multi-tenant/helpers/diagnosis-organization';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

type Database = typeof defaultDb;

/** Roles of the operator organization that may edit the glossary */
const OPERATOR_EDITOR_ROLES: readonly OrganizationRole[] = ['owner', 'admin'];

/**
 * Read the glossary entries for the given field keys. Returns each field's own entry first, then
 * its value entries by sort_order, so the caller can group them without another sort.
 */
/**
 * The columns the help popovers need. getByKeys is open to every authenticated user, so it must
 * not leak the editor's user id or the timestamps (#800 security review); those stay in list,
 * which only operator editors may call.
 */
export type FieldGlossaryHelp = Pick<
  FieldGlossaryEntry,
  | 'id'
  | 'fieldKey'
  | 'value'
  | 'labelJa'
  | 'labelEn'
  | 'descriptionJa'
  | 'descriptionEn'
  | 'sortOrder'
>;

const HELP_COLUMNS = {
  id: fieldGlossary.id,
  fieldKey: fieldGlossary.fieldKey,
  value: fieldGlossary.value,
  labelJa: fieldGlossary.labelJa,
  labelEn: fieldGlossary.labelEn,
  descriptionJa: fieldGlossary.descriptionJa,
  descriptionEn: fieldGlossary.descriptionEn,
  sortOrder: fieldGlossary.sortOrder,
} as const;

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

/** Every entry, for the operator's edit page. The dictionary is small, so a high cap is enough. */
export async function listFieldGlossaryEntries(
  executor: Database,
  limit: number
): Promise<FieldGlossaryEntry[]> {
  return executor
    .select()
    .from(fieldGlossary)
    .orderBy(
      asc(fieldGlossary.fieldKey),
      desc(sql`${fieldGlossary.value} is null`),
      asc(fieldGlossary.sortOrder)
    )
    .limit(limit);
}

/**
 * Whether the user may edit the site-wide glossary: an owner/admin of the operator organization
 * (resolveDiagnosisOrganizationId). No one may while no operator organization is configured
 * (owner decision 2026-11-06, Issue #800).
 */
export async function canEditFieldGlossary(executor: Database, userId: string): Promise<boolean> {
  const operatorOrgId = resolveDiagnosisOrganizationId();
  if (!operatorOrgId) return false;
  const rows = await executor
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, operatorOrgId),
        eq(organizationMembers.userId, userId)
      )
    )
    .limit(1);
  const role = rows[0]?.role;
  return role !== undefined && OPERATOR_EDITOR_ROLES.includes(role);
}

export interface UpsertFieldGlossaryEntry {
  id?: string;
  fieldKey: string;
  value: string | null;
  labelJa: string | null;
  labelEn: string | null;
  descriptionJa: string | null;
  descriptionEn: string | null;
  sortOrder: number;
  updatedBy: string;
}

/**
 * Insert a new entry, or update the one with the given id. Returns the saved row, or null when an
 * id was given but no row matched (the router turns that into NOT_FOUND). A duplicate (field_key,
 * value) raises a unique-violation the caller maps to CONFLICT.
 */
export async function upsertFieldGlossaryEntry(
  executor: Database,
  entry: UpsertFieldGlossaryEntry
): Promise<FieldGlossaryEntry | null> {
  const values = {
    fieldKey: entry.fieldKey,
    value: entry.value,
    labelJa: entry.labelJa,
    labelEn: entry.labelEn,
    descriptionJa: entry.descriptionJa,
    descriptionEn: entry.descriptionEn,
    sortOrder: entry.sortOrder,
    updatedBy: entry.updatedBy,
  };
  if (entry.id) {
    const [updated] = await executor
      .update(fieldGlossary)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(fieldGlossary.id, entry.id))
      .returning();
    return updated ?? null;
  }
  const [inserted] = await executor.insert(fieldGlossary).values(values).returning();
  return inserted ?? null;
}

/** Delete the entry with the given id. Returns whether a row was removed. */
export async function deleteFieldGlossaryEntry(executor: Database, id: string): Promise<boolean> {
  const deleted = await executor
    .delete(fieldGlossary)
    .where(eq(fieldGlossary.id, id))
    .returning({ id: fieldGlossary.id });
  return deleted.length > 0;
}

/**
 * A PostgreSQL unique-violation (SQLSTATE 23505), e.g. a duplicate (field_key, value). drizzle
 * wraps the driver error in a DrizzleQueryError ("Failed query: …") whose `.cause` is the
 * postgres-js error that actually carries the SQLSTATE, so walk the cause chain instead of only
 * reading the top-level error (the depth cap guards against a cyclic chain).
 */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 10; depth++) {
    if (
      typeof current === 'object' &&
      'code' in current &&
      (current as { code?: unknown }).code === '23505'
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
