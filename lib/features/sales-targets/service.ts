/**
 * Sales targets data access (Refs #437). Every query is scoped by organizationId; a member's
 * target can only be set for someone who can hold leads in the organization. The router checks
 * permissions.
 */

import type { db as defaultDb } from '@/lib/db/client';
import { organizations, salesTargets } from '@/lib/db/schema';
import { findAssignableMember } from '@/lib/features/leads/assignment';
import { TRPCError } from '@trpc/server';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { SALES_FORECAST_SETTINGS_KEY, readFiscalYearStartMonth } from './fiscal-year';
import type { SaveTargetsInput } from './types/schemas';

type Database = typeof defaultDb;

export interface TargetView {
  /** null: the organization as a whole */
  userId: string | null;
  /** First day of the month */
  month: string;
  amount: number;
}

export async function getFiscalYearStartMonth(
  db: Database,
  organizationId: string
): Promise<number> {
  const [row] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  return readFiscalYearStartMonth(row?.settings);
}

/** Store the start month; only this key of the settings is replaced (merged in SQL) */
export async function setFiscalYearStartMonth(
  db: Database,
  organizationId: string,
  month: number
): Promise<void> {
  const value = JSON.stringify({ fiscalYearStartMonth: month });
  await db
    .update(organizations)
    .set({
      settings: sql`coalesce(${organizations.settings}, '{}'::jsonb) || jsonb_build_object(${SALES_FORECAST_SETTINGS_KEY}::text, ${value}::jsonb)`,
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, organizationId));
}

/** Targets of the organization in the months (the organization's and every member's) */
export async function listTargets(
  db: Database,
  input: { organizationId: string; months: string[] }
): Promise<TargetView[]> {
  if (input.months.length === 0) return [];
  const rows = await db
    .select({ userId: salesTargets.userId, month: salesTargets.month, amount: salesTargets.amount })
    .from(salesTargets)
    .where(
      and(
        eq(salesTargets.organizationId, input.organizationId),
        inArray(salesTargets.month, input.months)
      )
    )
    .orderBy(asc(salesTargets.month));
  return rows.map((row) => ({ userId: row.userId, month: row.month, amount: row.amount }));
}

/**
 * Set or remove targets in one transaction (amount null removes one). A member's target is only
 * for someone who can hold leads in the organization.
 */
export async function saveTargets(
  db: Database,
  input: SaveTargetsInput & { userId: string },
  now: Date = new Date()
): Promise<{ saved: number; removed: number }> {
  return db.transaction(async (tx) => {
    // Two saves of the same organization run one after the other (each replaces its months)
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`sales-targets:${input.organizationId}`}))`
    );
    const memberIds = [
      ...new Set(input.entries.map((entry) => entry.userId).filter((id): id is string => !!id)),
    ];
    for (const memberId of memberIds) {
      if (!(await findAssignableMember(tx, input.organizationId, memberId))) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'A target can only be set for a member who can hold leads',
        });
      }
    }

    let saved = 0;
    let removed = 0;
    for (const entry of input.entries) {
      const scope = and(
        eq(salesTargets.organizationId, input.organizationId),
        eq(salesTargets.month, entry.month),
        entry.userId ? eq(salesTargets.userId, entry.userId) : isNull(salesTargets.userId)
      );
      const deleted = await tx.delete(salesTargets).where(scope).returning({ id: salesTargets.id });
      if (entry.amount === null) {
        removed += deleted.length;
        continue;
      }
      await tx.insert(salesTargets).values({
        organizationId: input.organizationId,
        userId: entry.userId,
        month: entry.month,
        amount: entry.amount,
        updatedBy: input.userId,
        createdAt: now,
        updatedAt: now,
      });
      saved += 1;
    }
    return { saved, removed };
  });
}
