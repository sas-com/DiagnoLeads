/**
 * Sales targets data access (Refs #437). Every query is scoped by organizationId; a member's
 * target can only be set for someone who can hold leads in the organization, and every change
 * of a target or of the fiscal year start leaves an audit_logs row. The router checks
 * permissions.
 */

import type { db as defaultDb } from '@/lib/db/client';
import { auditLogs, organizations, salesTargets, users } from '@/lib/db/schema';
import { findAssignableMember } from '@/lib/features/leads/service';
import { TRPCError } from '@trpc/server';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { SALES_FORECAST_SETTINGS_KEY, readFiscalYearStartMonth } from './types/fiscal-year';
import type { SaveTargetsInput } from './types/schemas';

type Database = typeof defaultDb;

/** audit_logs resource of a change of the targets; the resource id is the organization's */
export const SALES_TARGET_AUDIT_RESOURCE = 'sales_target';

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

/**
 * Store the start month; only this key of the settings is replaced (merged in SQL). A change
 * leaves an audit row with the month before and after.
 */
export async function setFiscalYearStartMonth(
  db: Database,
  input: { organizationId: string; month: number; userId: string }
): Promise<void> {
  const value = JSON.stringify({ fiscalYearStartMonth: input.month });
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ settings: organizations.settings })
      .from(organizations)
      .where(eq(organizations.id, input.organizationId))
      .for('update');
    const before = readFiscalYearStartMonth(row?.settings);
    // The whole salesForecast object is replaced: merge inside it once it holds a second key
    await tx
      .update(organizations)
      .set({
        settings: sql`coalesce(${organizations.settings}, '{}'::jsonb) || jsonb_build_object(${SALES_FORECAST_SETTINGS_KEY}::text, ${value}::jsonb)`,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, input.organizationId));
    if (before === input.month) return;
    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      userId: input.userId,
      action: 'update',
      resource: 'organization',
      resourceId: input.organizationId,
      changes: {
        before: { fiscalYearStartMonth: before },
        after: { fiscalYearStartMonth: input.month },
      },
    });
  });
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
 * Those holding one of the targets who can no longer hold leads (they left the organization or
 * became viewers), so the targets can be removed. Only the name is returned: the email of
 * someone outside the organization is not shown. The ids come from the organization's rows.
 */
export async function listFormerTargetHolders(
  db: Database,
  targets: TargetView[],
  memberIds: ReadonlySet<string>
): Promise<{ userId: string; name: string | null }[]> {
  const ids = [
    ...new Set(
      targets.flatMap((target) =>
        target.userId && !memberIds.has(target.userId) ? [target.userId] : []
      )
    ),
  ];
  if (ids.length === 0) return [];
  const rows = await db
    .select({ userId: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, ids))
    .orderBy(asc(users.name));
  return rows.map((row) => ({ userId: row.userId, name: row.name?.trim() || null }));
}

const entryKey = (userId: string | null, month: string) => `${userId ?? ''}|${month}`;

/**
 * Set or remove targets in one transaction (amount null removes one). Entries equal to what is
 * stored are left alone; the others leave one audit row with the amounts before and after. A
 * target is only set for someone who can hold leads in the organization; one of someone who
 * left can still be removed.
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
      ...new Set(
        input.entries.flatMap((entry) =>
          entry.userId && entry.amount !== null ? [entry.userId] : []
        )
      ),
    ];
    for (const memberId of memberIds) {
      if (!(await findAssignableMember(tx, input.organizationId, memberId))) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'A target can only be set for a member who can hold leads',
        });
      }
    }

    const storedRows = await tx
      .select({
        userId: salesTargets.userId,
        month: salesTargets.month,
        amount: salesTargets.amount,
      })
      .from(salesTargets)
      .where(
        and(
          eq(salesTargets.organizationId, input.organizationId),
          inArray(salesTargets.month, [...new Set(input.entries.map((entry) => entry.month))])
        )
      );
    const stored = new Map(
      storedRows.map((row) => [entryKey(row.userId, row.month), row.amount] as const)
    );
    const storedAmount = (entry: { userId: string | null; month: string }) =>
      stored.get(entryKey(entry.userId, entry.month)) ?? null;
    const changes = input.entries.filter((entry) => storedAmount(entry) !== entry.amount);

    let saved = 0;
    let removed = 0;
    for (const entry of changes) {
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
    if (changes.length > 0) {
      await tx.insert(auditLogs).values({
        organizationId: input.organizationId,
        userId: input.userId,
        action: 'update',
        resource: SALES_TARGET_AUDIT_RESOURCE,
        resourceId: input.organizationId,
        changes: {
          before: changes.map((entry) => ({
            userId: entry.userId,
            month: entry.month,
            amount: storedAmount(entry),
          })),
          after: changes.map(({ userId, month, amount }) => ({ userId, month, amount })),
        },
      });
    }
    return { saved, removed };
  });
}
