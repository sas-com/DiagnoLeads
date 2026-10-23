/**
 * Organization isolation of the embed router (#356): a member of organization B who passes the id
 * of organization A's embed config gets NOT_FOUND, and A's config (its API key included) stays as
 * it was. The template checks of create and update are in tenant-scope.db.test.ts.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_test \
 *     bunx vitest --run test/unit/integration/embed-org-isolation.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import { embedConfigs, organizationMembers, organizations, users } from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

// The embed router uses the app's database client; point it at the test database
const { connection } = vi.hoisted(() => ({ connection: { url: process.env.TEST_DATABASE_URL } }));
vi.mock('@/lib/db', async () => {
  const pg = await import('postgres');
  const { drizzle: connect } = await import('drizzle-orm/postgres-js');
  const dbSchema = await import('@/lib/db/schema');
  const client = pg.default(connection.url ?? 'postgres://unused@127.0.0.1:1/unused', { max: 2 });
  return { db: connect(client, { schema: dbSchema }) };
});

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('embed organization isolation (PostgreSQL)', () => {
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
  let configA: string;

  async function createOrganization(name: string) {
    const [org] = await pg
      .insert(organizations)
      .values({ name, slug: `embed-iso-${unique()}` })
      .returning();
    organizationIds.push(org.id);
    return org.id;
  }

  async function callerFor(organizationId: string) {
    const [user] = await pg
      .insert(users)
      .values({ email: `embed-iso-${unique()}@example.com`, name: 'Embed' })
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

  const configsOfA = () =>
    pg.select().from(embedConfigs).where(eq(embedConfigs.organizationId, orgA));

  beforeAll(async () => {
    orgA = await createOrganization('埋め込み切り分けA');
    orgB = await createOrganization('埋め込み切り分けB');
    adminB = await callerFor(orgB);
    const key = `dl_embed_${unique()}`;
    const [config] = await pg
      .insert(embedConfigs)
      .values({ organizationId: orgA, name: 'Config A', apiKey: key, apiKeyHash: `hash-${key}` })
      .returning();
    configA = config.id;
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
    get: () => adminB.embed.get({ ...asB(), id: configA }),
    update: () => adminB.embed.update({ ...asB(), id: configA, data: { name: 'Changed by B' } }),
    regenerateApiKey: () => adminB.embed.regenerateApiKey({ ...asB(), id: configA }),
    delete: () => adminB.embed.delete({ ...asB(), id: configA }),
    getAccessLogs: () => adminB.embed.getAccessLogs({ ...asB(), embedConfigId: configA }),
    getStats: () => adminB.embed.getStats({ ...asB(), embedConfigId: configA }),
  };

  it.each(Object.keys(calls))('%s with a config of another organization answers NOT_FOUND', async (name) => {
    const before = await configsOfA();
    await expect(calls[name]()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await configsOfA()).toEqual(before);
  });

  it("lists only B's own configs", async () => {
    expect(await adminB.embed.list(asB())).toEqual([]);
  });

  it("refuses A's organizationId to a member of B", async () => {
    await expect(
      adminB.embed.get({ organizationId: orgA, id: configA })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
