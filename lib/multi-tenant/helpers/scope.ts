import type { Database } from '@/lib/db/client';
import { diagnosticTemplates, leads, tags } from '@/lib/db/schema';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray } from 'drizzle-orm';

/** Tables whose rows carry their organization, checked by id */
const SCOPED = {
  lead: leads,
  tag: tags,
  template: diagnosticTemplates,
} as const;

export type ScopedRow = keyof typeof SCOPED;

/**
 * Throw NOT_FOUND unless every id is a row of the organization (#350).
 * RLS is not in effect yet (see middleware/organization.ts), so an id sent by a member must be
 * checked before it is read, linked or written: another organization's row answers as missing,
 * like an id that does not exist.
 */
export async function assertInOrganization(
  db: Pick<Database, 'select'>,
  what: ScopedRow,
  organizationId: string,
  ids: string | readonly string[]
): Promise<void> {
  const wanted = [...new Set(typeof ids === 'string' ? [ids] : ids)];
  if (wanted.length === 0) return;
  const table = SCOPED[what];
  const found = await db
    .select({ id: table.id })
    .from(table)
    .where(and(inArray(table.id, wanted), eq(table.organizationId, organizationId)));
  if (found.length !== wanted.length) {
    throw new TRPCError({ code: 'NOT_FOUND', message: `The ${what} was not found` });
  }
}
