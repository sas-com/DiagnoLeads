/**
 * Organization isolation of the abTests router (#356): a member of organization B who passes the
 * ids of organization A's test or templates gets NOT_FOUND, and A's rows stay as they were.
 * Passing A's organizationId is refused before any procedure runs.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_test \
 *     bunx vitest --run test/unit/integration/ab-tests-org-isolation.db.test.ts
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

describe.skipIf(!url)('abTests organization isolation (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organizationIds: string[] = [];
  const userIds: string[] = [];

  let orgA: string;
  let orgB: string;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let adminB: any;
  let templateA1: string;
  let templateA2: string;
  let templateB: string;
  let draftTestA: string;
  let runningTestA: string;

  async function createOrganization(name: string) {
    const [org] = await pg
      .insert(organizations)
      .values({ name, slug: `ab-iso-${unique()}` })
      .returning();
    organizationIds.push(org.id);
    return org.id;
  }

  async function callerFor(organizationId: string) {
    const [user] = await pg
      .insert(users)
      .values({ email: `ab-iso-${unique()}@example.com`, name: 'AB' })
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

  async function insertTest(organizationId: string, status: 'draft' | 'running') {
    const [row] = await pg
      .insert(diagnosticAbTests)
      .values({
        organizationId,
        name: `Test ${status}`,
        baseTemplateId: templateA1,
        status,
        variants: [
          { templateId: templateA1, name: 'A', trafficPercent: 50, impressions: 3, submissions: 1, conversions: 0 },
          { templateId: templateA2, name: 'B', trafficPercent: 50, impressions: 2, submissions: 0, conversions: 0 },
        ],
      })
      .returning();
    return row.id;
  }

  const rowsOfA = () =>
    pg.select().from(diagnosticAbTests).where(eq(diagnosticAbTests.organizationId, orgA));

  beforeAll(async () => {
    orgA = await createOrganization('ABテスト切り分けA');
    orgB = await createOrganization('ABテスト切り分けB');
    adminB = await callerFor(orgB);
    templateA1 = await insertTemplate(orgA);
    templateA2 = await insertTemplate(orgA);
    templateB = await insertTemplate(orgB);
    draftTestA = await insertTest(orgA, 'draft');
    runningTestA = await insertTest(orgA, 'running');
  });

  afterAll(async () => {
    if (organizationIds.length > 0) {
      await pg.delete(organizations).where(inArray(organizations.id, organizationIds));
    }
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  const asB = () => ({ organizationId: orgB });
  const variantsOfA = () => [
    { templateId: templateA1, name: 'A', trafficPercent: 50 },
    { templateId: templateA2, name: 'B', trafficPercent: 50 },
  ];

  const calls: Record<string, () => Promise<unknown>> = {
    get: () => adminB.abTests.get({ ...asB(), id: draftTestA }),
    update: () => adminB.abTests.update({ ...asB(), id: draftTestA, name: 'Changed by B' }),
    delete: () => adminB.abTests.delete({ ...asB(), id: draftTestA }),
    start: () => adminB.abTests.start({ ...asB(), id: draftTestA }),
    pause: () => adminB.abTests.pause({ ...asB(), id: runningTestA }),
    complete: () => adminB.abTests.complete({ ...asB(), id: runningTestA }),
    getResults: () => adminB.abTests.getResults({ ...asB(), id: runningTestA }),
    'create (base template of A)': () =>
      adminB.abTests.create({
        ...asB(),
        name: 'B test',
        baseTemplateId: templateA1,
        variants: variantsOfA(),
      }),
    'create (variant templates of A)': () =>
      adminB.abTests.create({
        ...asB(),
        name: 'B test',
        baseTemplateId: templateB,
        variants: [
          { templateId: templateB, name: 'A', trafficPercent: 50 },
          { templateId: templateA2, name: 'B', trafficPercent: 50 },
        ],
      }),
  };

  it.each(Object.keys(calls))('%s with ids of another organization answers NOT_FOUND', async (name) => {
    const before = await rowsOfA();
    await expect(calls[name]()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await rowsOfA()).toEqual(before);
  });

  // These two answer "nothing" instead of an error when the running test is not found
  const quiet: Record<string, [() => Promise<unknown>, unknown]> = {
    selectVariant: [() => adminB.abTests.selectVariant({ ...asB(), testId: runningTestA }), null],
    recordEvent: [
      () =>
        adminB.abTests.recordEvent({
          ...asB(),
          testId: runningTestA,
          variantTemplateId: templateA1,
          eventType: 'impression',
        }),
      expect.objectContaining({ success: false }),
    ],
  };

  it.each(Object.keys(quiet))(
    '%s with ids of another organization returns nothing and changes nothing',
    async (name) => {
      const [call, expected] = quiet[name];
      const before = await rowsOfA();
      expect(await call()).toEqual(expected);
      expect(await rowsOfA()).toEqual(before);
    }
  );

  it('creates nothing in B from the refused creates', async () => {
    const rowsOfB = await pg
      .select()
      .from(diagnosticAbTests)
      .where(eq(diagnosticAbTests.organizationId, orgB));
    expect(rowsOfB).toEqual([]);
  });

  it("refuses A's organizationId to a member of B", async () => {
    await expect(
      adminB.abTests.get({ organizationId: orgA, id: draftTestA })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
