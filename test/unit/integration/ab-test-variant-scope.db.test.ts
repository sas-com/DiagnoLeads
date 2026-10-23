/**
 * The variants of an A/B test must use templates of the test's organization, on update as on
 * create (#356). A template of another organization answers NOT_FOUND and the test is unchanged.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_test \
 *     bunx vitest --run test/unit/integration/ab-test-variant-scope.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import {
  diagnosticAbTests,
  diagnosticTemplates,
  organizationMembers,
  organizations,
  users,
} from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('A/B test variants stay in the organization (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organizationIds: string[] = [];
  const userIds: string[] = [];

  let orgA: string;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let adminA: any;
  let templateA1: string;
  let templateA2: string;
  let templateB: string;

  async function createOrganization(name: string) {
    const [org] = await pg
      .insert(organizations)
      .values({ name, slug: `ab-scope-${unique()}` })
      .returning();
    organizationIds.push(org.id);
    return org.id;
  }

  async function callerFor(organizationId: string) {
    const [user] = await pg
      .insert(users)
      .values({ email: `ab-scope-${unique()}@example.com`, name: 'AB' })
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

  async function insertTemplate(organizationId: string) {
    const [row] = await pg
      .insert(diagnosticTemplates)
      .values({ organizationId, name: 'Template', slug: `t-${unique()}`, title: 'Template' })
      .returning();
    return row.id;
  }

  const variant = (name: string, templateId: string) => ({
    name,
    templateId,
    trafficPercent: 50,
  });

  beforeAll(async () => {
    orgA = await createOrganization('ABテスト範囲A');
    const orgB = await createOrganization('ABテスト範囲B');
    adminA = await callerFor(orgA);
    templateA1 = await insertTemplate(orgA);
    templateA2 = await insertTemplate(orgA);
    templateB = await insertTemplate(orgB);
  });

  afterAll(async () => {
    if (organizationIds.length > 0) {
      await pg.delete(organizations).where(inArray(organizations.id, organizationIds));
    }
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  async function createTest() {
    return adminA.abTests.create({
      organizationId: orgA,
      name: 'Test',
      baseTemplateId: templateA1,
      variants: [variant('A', templateA1), variant('B', templateA2)],
    });
  }

  it('refuses a template of another organization on create', async () => {
    await expect(
      adminA.abTests.create({
        organizationId: orgA,
        name: 'Test',
        baseTemplateId: templateA1,
        variants: [variant('A', templateA1), variant('B', templateB)],
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses a template of another organization on update and leaves the test unchanged', async () => {
    const test = await createTest();
    await expect(
      adminA.abTests.update({
        organizationId: orgA,
        id: test.id,
        variants: [variant('A', templateA1), variant('B', templateB)],
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const [row] = await pg.select().from(diagnosticAbTests).where(eq(diagnosticAbTests.id, test.id));
    expect(row.variants.map((v) => v.templateId)).toEqual([templateA1, templateA2]);
  });

  it('accepts templates of the organization on update', async () => {
    const test = await createTest();
    const updated = await adminA.abTests.update({
      organizationId: orgA,
      id: test.id,
      variants: [variant('A', templateA2), variant('B', templateA1)],
    });
    expect(updated.variants.map((v: { templateId: string }) => v.templateId)).toEqual([
      templateA2,
      templateA1,
    ]);
  });
});
