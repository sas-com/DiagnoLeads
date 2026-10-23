/**
 * Organization isolation of the distribution router (#356): a member of organization B who
 * passes the id of organization A's QR campaign or template gets NOT_FOUND, and A's campaigns
 * stay as they were.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_test \
 *     bunx vitest --run test/unit/integration/distribution-org-isolation.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import {
  diagnosticTemplates,
  organizationMembers,
  organizations,
  qrCampaigns,
  users,
} from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

// The distribution router uses the app's database client; point it at the test database
const { connection } = vi.hoisted(() => ({ connection: { url: process.env.TEST_DATABASE_URL } }));
vi.mock('@/lib/db', async () => {
  const pg = await import('postgres');
  const { drizzle: connect } = await import('drizzle-orm/postgres-js');
  const dbSchema = await import('@/lib/db/schema');
  const client = pg.default(connection.url ?? 'postgres://unused@127.0.0.1:1/unused', { max: 2 });
  return { db: connect(client, { schema: dbSchema }) };
});

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('distribution organization isolation (PostgreSQL)', () => {
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
  let campaignA: string;

  async function createOrganization(name: string) {
    const [org] = await pg
      .insert(organizations)
      .values({ name, slug: `qr-iso-${unique()}` })
      .returning();
    organizationIds.push(org.id);
    return org.id;
  }

  async function callerFor(organizationId: string) {
    const [user] = await pg
      .insert(users)
      .values({ email: `qr-iso-${unique()}@example.com`, name: 'QR' })
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

  const campaignsOf = (organizationId: string) =>
    pg.select().from(qrCampaigns).where(eq(qrCampaigns.organizationId, organizationId));

  beforeAll(async () => {
    orgA = await createOrganization('QR切り分けA');
    orgB = await createOrganization('QR切り分けB');
    adminB = await callerFor(orgB);
    const [template] = await pg
      .insert(diagnosticTemplates)
      .values({ organizationId: orgA, name: 'Template', slug: `t-${unique()}`, title: 'Template' })
      .returning();
    templateA = template.id;
    const [campaign] = await pg
      .insert(qrCampaigns)
      .values({
        organizationId: orgA,
        diagnosticTemplateId: templateA,
        name: 'Campaign A',
        shortCode: `a${unique().replace(/[^a-z0-9]/g, '')}`.slice(0, 20),
        trackingUrl: 'https://example.com/a',
        scanCount: 4,
      })
      .returning();
    campaignA = campaign.id;
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
    getCampaign: () => adminB.distribution.getCampaign({ ...asB(), id: campaignA }),
    updateCampaign: () =>
      adminB.distribution.updateCampaign({
        ...asB(),
        id: campaignA,
        data: { name: 'Changed by B' },
      }),
    deleteCampaign: () => adminB.distribution.deleteCampaign({ ...asB(), id: campaignA }),
    generateCampaignQR: () =>
      adminB.distribution.generateCampaignQR({ ...asB(), campaignId: campaignA }),
    getCampaignStats: () =>
      adminB.distribution.getCampaignStats({ ...asB(), campaignId: campaignA }),
    'createCampaign (template of A)': () =>
      adminB.distribution.createCampaign({
        ...asB(),
        name: 'Campaign by B',
        diagnosticTemplateId: templateA,
      }),
    'generateQRCode (template of A)': () =>
      adminB.distribution.generateQRCode({ ...asB(), diagnosticTemplateId: templateA }),
  };

  it.each(Object.keys(calls))('%s with ids of another organization answers NOT_FOUND', async (name) => {
    const before = await campaignsOf(orgA);
    await expect(calls[name]()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await campaignsOf(orgA)).toEqual(before);
  });

  it('creates no campaign in B from the refused create', async () => {
    expect(await campaignsOf(orgB)).toEqual([]);
  });

  it("refuses A's organizationId to a member of B", async () => {
    await expect(
      adminB.distribution.getCampaign({ organizationId: orgA, id: campaignA })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
