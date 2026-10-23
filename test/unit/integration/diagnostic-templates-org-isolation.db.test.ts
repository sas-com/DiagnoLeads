/**
 * Organization isolation of the diagnosticTemplates router (#356): a member of organization B
 * who passes the id or slug of organization A's template gets NOT_FOUND (incrementSubmission
 * changes nothing), and A's templates stay as they were.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_test \
 *     bunx vitest --run test/unit/integration/diagnostic-templates-org-isolation.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import { diagnosticTemplates, organizationMembers, organizations, users } from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('diagnosticTemplates organization isolation (PostgreSQL)', () => {
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
  let templateA: string;
  let slugA: string;

  async function createOrganization(name: string) {
    const [org] = await pg
      .insert(organizations)
      .values({ name, slug: `tpl-iso-${unique()}` })
      .returning();
    organizationIds.push(org.id);
    return org.id;
  }

  async function callerFor(organizationId: string) {
    const [user] = await pg
      .insert(users)
      .values({ email: `tpl-iso-${unique()}@example.com`, name: 'Template' })
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

  const templatesOf = (organizationId: string) =>
    pg.select().from(diagnosticTemplates).where(eq(diagnosticTemplates.organizationId, organizationId));

  beforeAll(async () => {
    orgA = await createOrganization('テンプレート切り分けA');
    orgB = await createOrganization('テンプレート切り分けB');
    adminB = await callerFor(orgB);
    slugA = `a-${unique()}`;
    const [row] = await pg
      .insert(diagnosticTemplates)
      .values({
        organizationId: orgA,
        name: 'Template A',
        slug: slugA,
        title: 'Template A',
        isActive: true,
        submissionCount: 5,
        conversionCount: 2,
      })
      .returning();
    templateA = row.id;
  });

  afterAll(async () => {
    if (organizationIds.length > 0) {
      await pg.delete(organizations).where(inArray(organizations.id, organizationIds));
    }
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  const asB = () => ({ organizationId: orgB });

  const calls: Record<string, () => Promise<unknown>> = {
    get: () => adminB.diagnosticTemplates.get({ ...asB(), id: templateA }),
    getBySlug: () => adminB.diagnosticTemplates.getBySlug({ ...asB(), slug: slugA }),
    update: () =>
      adminB.diagnosticTemplates.update({ ...asB(), id: templateA, name: 'Changed by B' }),
    delete: () => adminB.diagnosticTemplates.delete({ ...asB(), id: templateA }),
    duplicate: () =>
      adminB.diagnosticTemplates.duplicate({
        ...asB(),
        id: templateA,
        newName: 'Copy by B',
        newSlug: `copy-${unique()}`,
      }),
    createVariant: () =>
      adminB.diagnosticTemplates.createVariant({
        ...asB(),
        parentTemplateId: templateA,
        name: 'Variant by B',
        slug: `variant-${unique()}`,
      }),
    getStats: () => adminB.diagnosticTemplates.getStats({ ...asB(), id: templateA }),
  };

  it.each(Object.keys(calls))('%s with a template of another organization answers NOT_FOUND', async (name) => {
    const before = await templatesOf(orgA);
    await expect(calls[name]()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await templatesOf(orgA)).toEqual(before);
  });

  it('incrementSubmission with a template of another organization changes nothing', async () => {
    const before = await templatesOf(orgA);
    await adminB.diagnosticTemplates.incrementSubmission({ ...asB(), id: templateA, converted: true });
    expect(await templatesOf(orgA)).toEqual(before);
  });

  it('creates no template in B from the refused copies', async () => {
    expect(await templatesOf(orgB)).toEqual([]);
  });

  it("refuses A's organizationId to a member of B", async () => {
    await expect(
      adminB.diagnosticTemplates.get({ organizationId: orgA, id: templateA })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
