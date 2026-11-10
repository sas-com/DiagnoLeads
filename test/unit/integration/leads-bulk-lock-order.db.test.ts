/**
 * The bulk status change and the bulk delete lock their leads in the order of the ids (#967), as
 * the agency report import does, on a real PostgreSQL. Another session holds the lead of the
 * lowest id, as an import does while it saves: the bulk operation waits for that lead holding
 * none of the others, so that the other session can still take them, and the two never wait for
 * each other (a deadlock, 40P01, which failed one of them with a 500).
 * The bulk operation's session reads the leads by a sequential scan, in the order they are
 * stored: the highest id first, the order it locked them in before. All values are fictional.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/leads-bulk-lock-order.db.test.ts
 */
import type { Database } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import { leads, organizationMembers, organizations, users } from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;
/** Leads of one bulk operation */
const LEADS = 12;

describe.skipIf(!url)('bulk lead operations lock in the order of the ids (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)! as unknown as Database;
  // The bulk operation's session: no index, so its plan reads the rows in the order they are stored
  const scanning = url
    ? postgres(url, {
        max: 1,
        connection: { enable_indexscan: 'off', enable_bitmapscan: 'off', enable_indexonlyscan: 'off' },
      })
    : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const scanned = (scanning ? drizzle(scanning, { schema }) : null)! as unknown as Database;
  // The other session, which holds a lead as an import does while it saves
  const holder = url ? postgres(url, { max: 1 }) : null;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let org: string;
  let userId: string;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let caller: any;

  beforeAll(async () => {
    const [row] = await pg
      .insert(organizations)
      .values({ name: 'ロックの順テスト', slug: `lock-order-${unique()}` })
      .returning();
    org = row.id;
    const [user] = await pg
      .insert(users)
      .values({ email: `lock-order-${unique()}@example.com`, name: 'admin' })
      .returning();
    userId = user.id;
    await pg.insert(organizationMembers).values({ organizationId: org, userId, role: 'admin' });
    caller = appRouter.createCaller({
      db: scanned,
      session: { session: { id: 's', userId }, user },
      user,
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);
  });

  afterAll(async () => {
    await pg.delete(organizations).where(eq(organizations.id, org));
    await pg.delete(users).where(inArray(users.id, [userId]));
    await Promise.all([client?.end(), scanning?.end(), holder?.end()]);
  });

  /** Leads stored the highest id first, in one statement; their ids from the lowest */
  const insertLeads = async () => {
    const ids = Array.from({ length: LEADS }, () => crypto.randomUUID()).sort();
    await pg.insert(leads).values(
      [...ids].reverse().map((id) => ({
        id,
        organizationId: org,
        email: `lock-order-${unique()}@example.com`,
        company: '架空商事',
      }))
    );
    return ids;
  };

  /**
   * Until a session waits for a lock the given backend holds. Only the sessions waiting behind
   * this test's own connection count, not those of other test files. Throws after 5 seconds,
   * when the test could no longer show what it means to.
   */
  async function untilBlockedBy(pid: number) {
    for (let i = 0; i < 100; i++) {
      const [row] = await pg.execute<{ waiting: number }>(sql`
        select count(*)::int as waiting from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))`);
      if (row && row.waiting >= 1) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('The bulk operation did not wait for the lead held');
  }

  /**
   * Holds the lead of the lowest id until the bulk operation waits for it, then takes the others
   * without waiting (nowait): those it cannot take, the bulk operation holds already. Returns how
   * many it took (or the error), and what the bulk operation returned once the lead was let go.
   */
  async function whileHolding(ids: string[], operation: () => Promise<unknown>) {
    const [lowest, ...others] = ids;
    let held!: () => void;
    const holding = new Promise<void>((resolve) => {
      held = resolve;
    });
    let waiting!: () => void;
    const waited = new Promise<void>((resolve) => {
      waiting = resolve;
    });
    let pid = 0;
    // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
    const taken = holder!.begin(async (tx) => {
      const [row] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid`;
      pid = row.pid;
      await tx`select 1 from leads where id = ${lowest} for no key update`;
      held();
      await waited;
      try {
        // In a savepoint, so that the transaction can still commit and let the lead go
        const rows = await tx.savepoint(
          (sp) => sp`select id from leads where id in ${sp(others)} for no key update nowait`
        );
        return rows.length;
      } catch (error) {
        return error;
      }
    });
    await holding;
    const result = operation();
    await untilBlockedBy(pid);
    waiting();
    const othersTaken = await taken;
    return { othersTaken, result: await result };
  }

  it('changes the status in the order of the ids, holding no other lead while it waits for one', async () => {
    const ids = await insertLeads();

    const { othersTaken, result } = await whileHolding(ids, () =>
      caller.leads.bulkUpdateStatus({ organizationId: org, ids, status: 'nurturing' })
    );

    expect(othersTaken).toBe(LEADS - 1);
    expect(result).toMatchObject({ success: true, updatedCount: LEADS });
    const statuses = await pg
      .select({ status: leads.status })
      .from(leads)
      .where(inArray(leads.id, ids));
    expect(statuses.every((lead) => lead.status === 'nurturing')).toBe(true);
  });

  it('deletes in the order of the ids, holding no other lead while it waits for one', async () => {
    const ids = await insertLeads();

    const { othersTaken, result } = await whileHolding(ids, () =>
      caller.leads.bulkDelete({ organizationId: org, ids })
    );

    expect(othersTaken).toBe(LEADS - 1);
    expect(result).toMatchObject({ success: true, deletedCount: LEADS });
    expect(await pg.select({ id: leads.id }).from(leads).where(inArray(leads.id, ids))).toEqual([]);
  });
});
