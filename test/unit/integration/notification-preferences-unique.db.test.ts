/**
 * One notification_preferences row per user and organization (#768), on a real PostgreSQL. The
 * unique index on (user_id, organization_id) refuses a second row, and getOrCreatePreferences
 * makes one row when first reads run at once: the insert does nothing on the conflict and the
 * caller reads the row the other one made, also when that one commits later. updatePreferences
 * still changes the switches of that row. All values are fictional.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/notification-preferences-unique.db.test.ts
 */
import type { Database } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import { notificationPreferences, organizationMembers, organizations, users } from '@/lib/db/schema';
import {
  getOrCreatePreferences,
  updatePreferences,
} from '@/lib/features/notifications/notification-service';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.TEST_DATABASE_URL;

const INDEX = 'notification_preferences_user_org_unique';
/** Callers whose first reads run at once */
const CALLERS = 6;

/** 'ok', or the PostgreSQL error code and constraint the call failed with */
async function outcome(call: PromiseLike<unknown>) {
  try {
    await call;
    return 'ok';
  } catch (error) {
    const cause = error instanceof Error && error.cause ? error.cause : error;
    if (cause instanceof postgres.PostgresError) {
      return { code: cause.code, constraint: cause.constraint_name };
    }
    throw error;
  }
}

describe.skipIf(!url)('notification_preferences: one row per user and organization (PostgreSQL)', () => {
  // One connection per caller, so their statements run side by side
  const client = url ? postgres(url, { max: CALLERS + 2 }) : null;
  // Watches the other sessions from outside them
  const watcher = url ? postgres(url, { max: 1 }) : null;
  const pg = client
    ? drizzle(client, { schema })
    : (null as unknown as ReturnType<typeof drizzle<typeof schema>>);
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let orgA: string;
  let orgB: string;
  const userIds: string[] = [];

  const rowsOf = (userId: string, organizationId: string) =>
    pg
      .select()
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.userId, userId),
          eq(notificationPreferences.organizationId, organizationId)
        )
      );

  /** A new member of A and B with no settings yet */
  const newMember = async () => {
    const [user] = await pg
      .insert(users)
      .values({ email: `prefs-unique-${unique()}@example.com`, name: '通知の社員' })
      .returning({ id: users.id });
    userIds.push(user.id);
    await pg.insert(organizationMembers).values([
      { organizationId: orgA, userId: user.id, role: 'member' },
      { organizationId: orgB, userId: user.id, role: 'member' },
    ]);
    return user.id;
  };

  /**
   * A database whose first reads of the settings wait for each other: every caller misses the
   * row before any of them inserts, the race of two first reads at once
   */
  const readingTogether = (parties: number): Database => {
    let arrived = 0;
    let releaseAll = () => {};
    const allRead = new Promise<void>((resolve) => {
      releaseAll = resolve;
    });
    return {
      query: {
        notificationPreferences: {
          findFirst: async (
            config: Parameters<typeof pg.query.notificationPreferences.findFirst>[0]
          ) => {
            const row = await pg.query.notificationPreferences.findFirst(config);
            arrived += 1;
            if (arrived === parties) releaseAll();
            await allRead;
            return row;
          },
        },
      },
      insert: pg.insert.bind(pg),
    } as unknown as Database;
  };

  /** Waits until a session is blocked on a lock while inserting a settings row */
  const insertIsWaiting = async () => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
      const [{ waiting }] = await watcher!<{ waiting: number }[]>`
        select count(*)::int as waiting from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'
          and query like 'insert into "notification_preferences"%'
      `;
      if (waiting > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('No insert of a settings row waited for the open transaction');
  };

  beforeAll(async () => {
    const [a, b] = await pg
      .insert(organizations)
      .values([
        { name: '通知の設定の一意A', slug: `prefs-unique-a-${unique()}` },
        { name: '通知の設定の一意B', slug: `prefs-unique-b-${unique()}` },
      ])
      .returning({ id: organizations.id });
    orgA = a.id;
    orgB = b.id;
  });

  afterAll(async () => {
    if (orgA) await pg.delete(organizations).where(inArray(organizations.id, [orgA, orgB]));
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
    await watcher?.end();
  });

  it('has a unique index on (user_id, organization_id)', async () => {
    // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
    const rows = await client!<{ indexdef: string }[]>`
      select indexdef from pg_indexes
      where schemaname = 'public' and tablename = 'notification_preferences' and indexname = ${INDEX}
    `;

    expect(rows.map((row) => row.indexdef)).toEqual([
      `CREATE UNIQUE INDEX ${INDEX} ON public.notification_preferences USING btree (user_id, organization_id)`,
    ]);
  });

  it('refuses a second row for the same user and organization', async () => {
    const userId = await newMember();
    await pg.insert(notificationPreferences).values({ userId, organizationId: orgA });

    const second = await outcome(
      pg.insert(notificationPreferences).values({ userId, organizationId: orgA, emailDailyDigest: true })
    );

    expect(second).toEqual({ code: '23505', constraint: INDEX });
    expect(await rowsOf(userId, orgA)).toHaveLength(1);
  });

  it('takes a row of the same user in another organization', async () => {
    const userId = await newMember();
    await pg.insert(notificationPreferences).values({ userId, organizationId: orgA });

    const inB = await outcome(pg.insert(notificationPreferences).values({ userId, organizationId: orgB }));

    expect(inB).toBe('ok');
    expect([(await rowsOf(userId, orgA)).length, (await rowsOf(userId, orgB)).length]).toEqual([1, 1]);
  });

  it('makes one row when first reads run at once, and every caller gets it', async () => {
    const userId = await newMember();
    const database = readingTogether(CALLERS);

    const results = await Promise.all(
      Array.from({ length: CALLERS }, () => getOrCreatePreferences(userId, orgA, database))
    );

    const rows = await rowsOf(userId, orgA);
    expect(rows).toHaveLength(1);
    expect(results.map((result) => result.id)).toEqual(Array(CALLERS).fill(rows[0]?.id));
  });

  it('reads the row of a caller that commits after it, instead of a second row', async () => {
    const userId = await newMember();
    let commit = () => {};
    const committing = new Promise<void>((resolve) => {
      commit = resolve;
    });
    let inserted = () => {};
    const rowInserted = new Promise<void>((resolve) => {
      inserted = resolve;
    });
    // The other caller has inserted the row in a transaction it has not committed yet
    const other = pg.transaction(async (tx) => {
      const [row] = await tx
        .insert(notificationPreferences)
        .values({ userId, organizationId: orgA, emailDailyDigest: true })
        .returning();
      inserted();
      await committing;
      return row;
    });

    let reading: Promise<Awaited<ReturnType<typeof getOrCreatePreferences>>> | undefined;
    try {
      await rowInserted;
      // Misses the uncommitted row, so it inserts and waits for the other transaction
      reading = getOrCreatePreferences(userId, orgA, pg);
      reading.catch(() => {});
      await insertIsWaiting();
    } finally {
      commit();
    }
    const [made, read] = await Promise.all([other, reading]);

    expect({
      sameRow: read?.id === made?.id,
      emailDailyDigest: read?.emailDailyDigest,
      rows: (await rowsOf(userId, orgA)).length,
    }).toEqual({ sameRow: true, emailDailyDigest: true, rows: 1 });
  });

  it('updatePreferences changes the switches of the one row', async () => {
    const userId = await newMember();
    const before = await getOrCreatePreferences(userId, orgA, pg);

    const updated = await updatePreferences(
      userId,
      orgA,
      { emailDailyDigest: true, inAppLeadCreated: false },
      pg
    );

    const rows = await rowsOf(userId, orgA);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: before.id,
      emailDailyDigest: true,
      inAppLeadCreated: false,
      emailWeeklyReport: before.emailWeeklyReport,
    });
    expect(updated).toEqual(rows[0]);
  });

  it('updatePreferences makes the row on the first change', async () => {
    const userId = await newMember();

    const updated = await updatePreferences(userId, orgA, { emailWeeklyReport: false }, pg);

    const rows = await rowsOf(userId, orgA);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: updated?.id, emailWeeklyReport: false, inAppLeadCreated: true });
  });
});
