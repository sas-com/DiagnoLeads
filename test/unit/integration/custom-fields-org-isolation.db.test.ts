/**
 * Organization isolation of the lead custom fields (#356) on a real PostgreSQL: an admin of
 * organization B passes the ids of A's fields. Nothing of A is read, changed, reordered, turned
 * off or deleted, and B's list holds only B's fields. All values are fictional.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/custom-fields-org-isolation.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import { customFields, organizationMembers, organizations, users } from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('custom fields: organization isolation (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let orgA: string;
  let orgB: string;
  const userIds: string[] = [];
  // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
  let adminA: any;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
  let adminB: any;
  /** A's two fields */
  const fieldsA: string[] = [];

  async function callerFor(organizationId: string) {
    const [user] = await pg
      .insert(users)
      .values({ email: `fields-iso-${unique()}@example.com`, name: 'テスト' })
      .returning();
    userIds.push(user.id);
    await pg.insert(organizationMembers).values({ organizationId, userId: user.id, role: 'admin' });
    return appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId: user.id }, user },
      user,
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);
  }

  const rowsOfA = () =>
    pg
      .select()
      .from(customFields)
      .where(inArray(customFields.id, fieldsA))
      .orderBy(customFields.displayOrder);

  beforeAll(async () => {
    const created = await pg
      .insert(organizations)
      .values([
        { name: '項目切り分けA', slug: `fields-iso-a-${unique()}` },
        { name: '項目切り分けB', slug: `fields-iso-b-${unique()}` },
      ])
      .returning({ id: organizations.id });
    orgA = created[0].id;
    orgB = created[1].id;
    adminA = await callerFor(orgA);
    adminB = await callerFor(orgB);
    for (const key of ['budget_year', 'contract_type']) {
      const field = await adminA.customFields.create({
        organizationId: orgA,
        key,
        name: `A の項目 ${key}`,
        fieldType: 'text',
      });
      fieldsA.push(field.id);
    }
  });

  afterAll(async () => {
    if (orgA) await pg.delete(organizations).where(inArray(organizations.id, [orgA, orgB]));
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  it("refuses B's admin when it names organization A itself", async () => {
    await expect(adminB.customFields.list({ organizationId: orgA })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it("lists and reads none of A's fields (list, get)", async () => {
    expect(await adminB.customFields.list({ organizationId: orgB, activeOnly: false })).toEqual(
      []
    );
    for (const id of fieldsA) {
      await expect(adminB.customFields.get({ organizationId: orgB, id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    }
  });

  it("changes, turns off, reorders and deletes none of A's fields by their ids", async () => {
    const before = await rowsOfA();
    for (const id of fieldsA) {
      await expect(
        adminB.customFields.update({ organizationId: orgB, id, name: '書き換え', isActive: false })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        adminB.customFields.toggleActive({ organizationId: orgB, id })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        adminB.customFields.delete({ organizationId: orgB, id })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    // Reordering with A's ids (reversed) moves nothing of A
    await adminB.customFields
      .reorder({ organizationId: orgB, fieldIds: [...fieldsA].reverse() })
      .catch(() => undefined);
    expect(await rowsOfA()).toEqual(before);
  });

  it("lets B use the same key as A, as a field of B's own (create)", async () => {
    const field = await adminB.customFields.create({
      organizationId: orgB,
      key: 'budget_year',
      name: 'B の項目',
      fieldType: 'text',
    });
    expect(field.organizationId).toBe(orgB);
    const [rowA] = await pg.select().from(customFields).where(eq(customFields.id, fieldsA[0]));
    expect(rowA.name).toBe('A の項目 budget_year');
  });
});
