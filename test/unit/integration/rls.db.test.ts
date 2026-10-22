/**
 * RLS helpers against a real PostgreSQL database.
 * Skipped unless TEST_DATABASE_URL is set (see ax-migration-submission.db.test.ts).
 */
import { setCurrentUser } from '@/lib/db/rls';
import * as schema from '@/lib/db/schema';
import { inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('setCurrentUser (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 1 }) : null;
  const db = client ? drizzle(client, { schema }) : null;

  afterAll(async () => {
    await client?.end();
  });

  it('sets the user id for the current transaction only', async () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
    const inside = await db!.transaction(async (tx) => {
      await setCurrentUser(tx as never, userId);
      const rows = await tx.execute(sql`SELECT current_setting('app.current_user_id', true) AS id`);
      return (rows as unknown as { id: string }[])[0].id;
    });
    expect(inside).toBe(userId);

    // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
    const after = await db!.execute(sql`SELECT current_setting('app.current_user_id', true) AS id`);
    expect((after as unknown as { id: string | null }[])[0].id || '').toBe('');
  });

  it('accepts a null user', async () => {
    // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
    await expect(db!.transaction((tx) => setCurrentUser(tx as never, null))).resolves.toBeUndefined();
  });
});

describe.skipIf(!url)('app.* RLS helper functions (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 1 }) : null;
  const db = client ? drizzle(client, { schema }) : null;
  const organizationIds: string[] = [];
  const userIds: string[] = [];

  afterAll(async () => {
    if (db && organizationIds.length > 0) {
      await db.delete(schema.organizations).where(inArray(schema.organizations.id, organizationIds));
    }
    if (db && userIds.length > 0) await db.delete(schema.users).where(inArray(schema.users.id, userIds));
    await client?.end();
  });

  it('pins search_path on every helper (#359)', async () => {
    // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
    const rows = (await db!.execute(sql`
      SELECT proname, proconfig FROM pg_proc WHERE pronamespace = 'app'::regnamespace ORDER BY proname
    `)) as unknown as { proname: string; proconfig: string[] | null }[];
    expect(rows.map((r) => r.proname)).toEqual([
      'is_organization_member',
      'user_id',
      'user_organization_ids',
      'user_role_in_organization',
    ]);
    for (const row of rows) expect(row.proconfig).toContain('search_path=""');
  });

  it('still resolves the current user\'s organizations and role', async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
    const pg = db!;
    const [mine] = await pg.insert(schema.organizations).values({ name: 'Mine', slug: `rls-${suffix}-a` }).returning();
    const [other] = await pg
      .insert(schema.organizations)
      .values({ name: 'Other', slug: `rls-${suffix}-b` })
      .returning();
    organizationIds.push(mine.id, other.id);
    const [user] = await pg
      .insert(schema.users)
      .values({ email: `rls-${suffix}@example.com`, name: 'RLS' })
      .returning();
    userIds.push(user.id);
    await pg.insert(schema.organizationMembers).values({ organizationId: mine.id, userId: user.id, role: 'admin' });

    const result = await pg.transaction(async (tx) => {
      await setCurrentUser(tx as never, user.id);
      const rows = (await tx.execute(sql`
        SELECT
          app.user_id() AS user_id,
          ARRAY(SELECT app.user_organization_ids()) AS org_ids,
          app.is_organization_member(${mine.id}::uuid) AS in_mine,
          app.is_organization_member(${other.id}::uuid) AS in_other,
          app.user_role_in_organization(${mine.id}::uuid) AS role_mine,
          app.user_role_in_organization(${other.id}::uuid) AS role_other
      `)) as unknown as Record<string, unknown>[];
      return rows[0];
    });

    expect(result).toEqual({
      user_id: user.id,
      org_ids: [mine.id],
      in_mine: true,
      in_other: false,
      role_mine: 'admin',
      role_other: null,
    });
  });
});
