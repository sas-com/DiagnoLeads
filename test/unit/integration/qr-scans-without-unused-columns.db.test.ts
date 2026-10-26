/**
 * Stage 1 of #702 against PostgreSQL: the QR code works on a qr_scans without session_id,
 * converted and lead_id, the columns stage 2 drops. Production gets each migration before its
 * merge (.claude/rules/db-schema.md), so this code runs between the drop and the merge of stage 2:
 * it reads and writes the scans with the columns named, never select() or a relational query of
 * all columns. Checked here: the entry (/q/<code>) records the scans, getCampaignStats counts them,
 * deleteCampaign deletes the campaign and, by the cascade, its scans.
 *
 * The production code already named the columns before stage 1, so this file passes on that code
 * too: it is the proof that stage 2 is safe, and until stage 2 it fails when a change makes this
 * code name a dropped column (select(), a relational query of all columns, recordQrScan writing
 * converted or lead_id).
 *
 * The columns of the shared qr_scans are not dropped: the integration files run in parallel on one
 * database, and the drop (with the lead_id foreign key) would lock qr_scans and leads under them.
 * The stage-2 shape is built in a schema of this file's own instead: qr_campaigns and qr_scans
 * copied from the migrated tables (LIKE ... INCLUDING ALL: columns, defaults, constraints,
 * indexes), qr_scans without the three columns, with the cascade of campaign_id. The code runs on a
 * client whose search_path puts that schema first, so its unqualified "qr_scans" and "qr_campaigns"
 * name the copies; every other table is the shared one. Stage 2, whose migration drops the
 * columns of the shared table, removes this file.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/qr-scans-without-unused-columns.db.test.ts
 */
import { GET } from '@/app/q/[code]/route';
import type { Database } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import {
  diagnosticTemplates,
  organizationMembers,
  organizations,
  qrCampaigns,
  qrScans,
  users,
} from '@/lib/db/schema';
import { recordQrScan } from '@/lib/features/distribution/scans';
import { appRouter } from '@/server/routers/_app';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { NextRequest } from 'next/server';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The entry and the router run on the client of the stage-2 shape; the organization receives the
// AX diagnosis. after() keeps the work the entry leaves for after the response
const deps = vi.hoisted(() => ({
  db: null as unknown,
  axOrganizationId: null as string | null,
  afterTasks: [] as (() => unknown)[],
}));
vi.mock('@/lib/db/client', () => ({
  get db() {
    return deps.db;
  },
}));
vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/features/diagnostics/organization', () => ({
  resolveDiagnosisOrganizationId: () => deps.axOrganizationId,
}));
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => unknown) => {
    deps.afterTasks.push(task);
  },
}));

const url = process.env.TEST_DATABASE_URL;

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const CREATED = new Date('2026-10-01T00:00:00Z');
const DROPPED = ['session_id', 'converted', 'lead_id'];

/** The message of the database's error, under the error drizzle wraps it in */
async function databaseError(query: PromiseLike<unknown>): Promise<string> {
  try {
    await query;
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    return cause instanceof Error ? cause.message : String(cause);
  }
  return 'no error';
}

describe.skipIf(!url)('QR scans without the columns stage 2 of #702 drops (PostgreSQL)', () => {
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  /** Lower-case letters, digits and _ only, so it is a plain identifier */
  const stage2 = `qr702_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  // Builds and drops the schema; its search_path is the default one
  const admin = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
  const client = url
    ? postgres(url, { max: 4, onnotice: () => {}, connection: { search_path: `${stage2}, public` } })
    : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)! as unknown as Database;
  deps.db = pg;
  const campaignIds: string[] = [];
  let organizationId: string;
  let templateId: string;
  let userId: string;
  let caller: ReturnType<typeof appRouter.createCaller>;

  /** Letters and digits of generateShortCode's alphabet, so the codes are unique per run */
  const randomPart = (length: number) => {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  };

  async function createCampaign() {
    const shortCode = `Wo${randomPart(8)}`;
    const [row] = await pg
      .insert(qrCampaigns)
      .values({
        organizationId,
        diagnosticTemplateId: templateId,
        name: 'Campaign',
        shortCode,
        trackingUrl: `https://example.com/q/${shortCode}`,
      })
      .returning({ id: qrCampaigns.id });
    campaignIds.push(row.id);
    return { id: row.id, code: shortCode };
  }

  /** GET /q/<code>, then the work it left for after the response */
  async function scan(code: string, userAgent: string) {
    const req = new NextRequest(`https://app.example/q/${code}`, {
      headers: { 'user-agent': userAgent },
    });
    const res = await GET(req, { params: Promise.resolve({ code }) });
    await Promise.all(deps.afterTasks.splice(0).map((task) => task()));
    return res;
  }

  const scansOf = (campaignId: string) =>
    pg
      .select({ deviceType: qrScans.deviceType, organizationId: qrScans.organizationId })
      .from(qrScans)
      .where(eq(qrScans.campaignId, campaignId));

  async function scanCountOf(campaignId: string) {
    const [row] = await pg
      .select({ scanCount: qrCampaigns.scanCount })
      .from(qrCampaigns)
      .where(eq(qrCampaigns.id, campaignId));
    return row?.scanCount;
  }

  beforeAll(async () => {
    if (!admin) return;
    await admin.unsafe(`create schema ${stage2}`);
    await admin.unsafe(
      `create table ${stage2}.qr_campaigns (like public.qr_campaigns including all)`
    );
    await admin.unsafe(`create table ${stage2}.qr_scans (like public.qr_scans including all)`);
    await admin.unsafe(
      `alter table ${stage2}.qr_scans ${DROPPED.map((column) => `drop column ${column}`).join(', ')}`
    );
    await admin.unsafe(
      `alter table ${stage2}.qr_scans add foreign key (campaign_id) references ${stage2}.qr_campaigns (id) on delete cascade`
    );

    const [org] = await pg
      .insert(organizations)
      .values({ name: 'QR列なし', slug: `qr-702-${unique()}` })
      .returning({ id: organizations.id });
    organizationId = org.id;
    deps.axOrganizationId = org.id;
    const [template] = await pg
      .insert(diagnosticTemplates)
      .values({ organizationId, name: 'Template', slug: `t-${unique()}`, title: 'Template' })
      .returning({ id: diagnosticTemplates.id });
    templateId = template.id;

    const [user] = await pg
      .insert(users)
      .values({ email: `qr-702-${unique()}@example.com`, name: 'QR' })
      .returning();
    userId = user.id;
    await pg.insert(organizationMembers).values({ organizationId, userId, role: 'admin' });
    // The session as Better Auth gives it to the router
    const authUser = {
      id: user.id,
      email: user.email,
      name: user.name ?? 'QR',
      emailVerified: false,
      image: null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
    caller = appRouter.createCaller({
      db: pg,
      session: {
        session: {
          id: 's',
          userId: user.id,
          token: 't',
          expiresAt: new Date('2099-01-01T00:00:00Z'),
          createdAt: CREATED,
          updatedAt: CREATED,
        },
        user: authUser,
      },
      user: authUser,
    });
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.unsafe(`drop schema if exists ${stage2} cascade`);
    for (const campaignId of campaignIds) {
      await admin`delete from public_rate_limits where key like ${`qr-scan-campaign-day:${campaignId}:%`}`;
    }
    if (organizationId) await admin`delete from organizations where id = ${organizationId}`;
    if (userId) await admin`delete from users where id = ${userId}`;
    await client?.end();
    await admin.end();
  });

  it('runs on a qr_scans without the three columns, where a select of every column fails', async () => {
    const columns = await pg.execute<{ column_name: string }>(sql`
      select column_name from information_schema.columns
      where table_schema = ${stage2} and table_name = 'qr_scans'
    `);
    const names = columns.map((row) => row.column_name);
    expect(names).toEqual(expect.arrayContaining(['id', 'campaign_id', 'organization_id']));
    for (const column of DROPPED) expect(names).not.toContain(column);
    // What stage 1 must never do: select() names every column of the schema, the three included
    expect(await databaseError(pg.select().from(qrScans))).toMatch(
      /column "?\w*\.?(session_id|converted|lead_id)"? does not exist/
    );
  });

  it('records the scans the entry sends on, and recordQrScan writes a row', async () => {
    const campaign = await createCampaign();
    expect((await scan(campaign.code, IPHONE)).status).toBe(307);
    expect((await scan(campaign.code, DESKTOP)).status).toBe(307);
    expect(await recordQrScan(pg, { campaignId: campaign.id, organizationId }, 'tablet')).toBe(true);

    const rows = await scansOf(campaign.id);
    expect(rows.map((row) => row.deviceType).sort()).toEqual(['desktop', 'mobile', 'tablet']);
    expect(rows.every((row) => row.organizationId === organizationId)).toBe(true);
    expect(await scanCountOf(campaign.id)).toBe(3);
  });

  it('getCampaignStats counts the recorded scans', async () => {
    const campaign = await createCampaign();
    await scan(campaign.code, IPHONE);
    await scan(campaign.code, IPHONE);
    await scan(campaign.code, DESKTOP);

    const stats = await caller.distribution.getCampaignStats({
      organizationId,
      campaignId: campaign.id,
    });
    expect(stats).toMatchObject({
      totalScans: 3,
      totalConversions: 0,
      conversionRate: 0,
      deviceBreakdown: { mobile: 2, desktop: 1 },
    });
    expect(stats.recentScans).toHaveLength(3);
    for (const recent of stats.recentScans) {
      expect(Object.keys(recent).sort()).toEqual(['deviceType', 'id', 'scannedOn']);
    }
  });

  it('deleteCampaign deletes the campaign and, by the cascade, its scans', async () => {
    const campaign = await createCampaign();
    const other = await createCampaign();
    await scan(campaign.code, IPHONE);
    await scan(other.code, IPHONE);
    expect(await scansOf(campaign.id)).toHaveLength(1);

    expect(await caller.distribution.deleteCampaign({ organizationId, id: campaign.id })).toEqual({
      success: true,
    });
    expect(await scanCountOf(campaign.id)).toBeUndefined();
    expect(await scansOf(campaign.id)).toEqual([]);
    // The other campaign's scans stay
    expect(await scansOf(other.id)).toHaveLength(1);
  });
});
