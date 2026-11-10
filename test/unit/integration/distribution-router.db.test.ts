/**
 * The QR campaign router on PostgreSQL, for the organization's own campaigns (#793): what a create
 * stores (the organization, the template, the drawn short code, the UTM values and the expiry),
 * the list newest first with the /q/ URL, the detail and the downloaded QR code, ids no campaign
 * or template has (NOT_FOUND, nothing written), a short code another organization's campaign
 * holds (drawn again: the codes are unique across organizations), and a delete that removes the
 * one campaign. The ids of another organization are in distribution-org-isolation.db.test.ts;
 * the role checks and the input limits, on the real router without a database, in
 * test/unit/features/distribution/router.test.ts.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_test \
 *     bunx vitest --run test/unit/integration/distribution-router.db.test.ts
 */
import { randomUUID } from 'node:crypto';
import * as schema from '@/lib/db/schema';
import {
  diagnosticTemplates,
  organizationMembers,
  organizations,
  qrCampaigns,
  users,
} from '@/lib/db/schema';
import { expiryOfJstDay } from '@/lib/features/distribution/campaign-expiry';
import { DEFAULT_QR_CAMPAIGN_MEDIUM } from '@/lib/features/distribution/types';
import { appRouter } from '@/server/routers/_app';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const { connection, drawnCodes } = vi.hoisted(() => ({
  connection: { url: process.env.TEST_DATABASE_URL },
  /** The short codes the router draws next, in order (a real draw once none is left) */
  drawnCodes: [] as string[],
}));
// The distribution router uses the app's database client; point it at the test database
vi.mock('@/lib/db', async () => {
  const pg = await import('postgres');
  const { drizzle: connect } = await import('drizzle-orm/postgres-js');
  const dbSchema = await import('@/lib/db/schema');
  const client = pg.default(connection.url ?? 'postgres://unused@127.0.0.1:1/unused', { max: 2 });
  return { db: connect(client, { schema: dbSchema }) };
});
vi.mock('@/lib/features/distribution/qr-code', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/features/distribution/qr-code')>();
  return {
    ...actual,
    generateShortCode: (length?: number) => drawnCodes.shift() ?? actual.generateShortCode(length),
  };
});

const url = process.env.TEST_DATABASE_URL;
const PNG_DATA_URL = /^data:image\/png;base64,/;

describe.skipIf(!url)(
  'distribution router on the organization’s own campaigns (PostgreSQL)',
  () => {
    const client = url ? postgres(url, { max: 2 }) : null;
    // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
    const pg = (client ? drizzle(client, { schema }) : null)!;
    const unique = () => `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
    /** A short code no other test run holds: letters and digits, as generateShortCode makes */
    const freshCode = (prefix: string) =>
      `${prefix}${unique().replace(/[^A-Za-z0-9]/g, '')}`.slice(0, 24);
    const organizationIds: string[] = [];
    const userIds: string[] = [];

    let orgA: string;
    let orgB: string;
    let templateA: string;
    let templateB: string;
    // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
    let adminA: any;

    async function createOrganization(name: string) {
      const [org] = await pg
        .insert(organizations)
        .values({ name, slug: `qr-router-${unique()}` })
        .returning();
      organizationIds.push(org.id);
      return org.id;
    }

    async function createTemplate(organizationId: string) {
      const [template] = await pg
        .insert(diagnosticTemplates)
        .values({ organizationId, name: 'Template', slug: `t-${unique()}`, title: 'Readiness' })
        .returning();
      return template.id;
    }

    async function callerFor(organizationId: string) {
      const [user] = await pg
        .insert(users)
        .values({ email: `qr-router-${unique()}@example.com`, name: 'QR' })
        .returning();
      userIds.push(user.id);
      await pg
        .insert(organizationMembers)
        .values({ organizationId, userId: user.id, role: 'admin' });
      return appRouter.createCaller({
        db: pg,
        session: { session: { id: 's', userId: user.id }, user },
        user,
        // biome-ignore lint/suspicious/noExplicitAny: test context
      } as any).distribution;
    }

    async function storeCampaign(
      organizationId: string,
      diagnosticTemplateId: string,
      values: Partial<typeof qrCampaigns.$inferInsert> = {}
    ) {
      const shortCode = values.shortCode ?? freshCode('s');
      const [campaign] = await pg
        .insert(qrCampaigns)
        .values({
          organizationId,
          diagnosticTemplateId,
          name: 'Stored',
          shortCode,
          trackingUrl: `http://localhost:3000/q/${shortCode}`,
          ...values,
        })
        .returning();
      return campaign;
    }

    const campaignsOf = (organizationId: string) =>
      pg
        .select()
        .from(qrCampaigns)
        .where(eq(qrCampaigns.organizationId, organizationId))
        .orderBy(qrCampaigns.id);
    const asA = () => ({ organizationId: orgA });

    beforeAll(async () => {
      orgA = await createOrganization('QRルーターA');
      orgB = await createOrganization('QRルーターB');
      templateA = await createTemplate(orgA);
      templateB = await createTemplate(orgB);
      adminA = await callerFor(orgA);
    });

    afterAll(async () => {
      drawnCodes.length = 0;
      if (organizationIds.length > 0) {
        await pg.delete(organizations).where(inArray(organizations.id, organizationIds));
      }
      if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
      await client?.end();
    });

    it('stores a new campaign in the organization with the drawn code, its UTM values and expiry', async () => {
      const created = await adminA.createCampaign({
        ...asA(),
        name: 'Fair 2026',
        description: 'Booth A',
        diagnosticTemplateId: templateA,
        utmCampaign: 'fair-2026',
        expiresAt: expiryOfJstDay('2026-12-31'),
      });
      const [row] = await pg.select().from(qrCampaigns).where(eq(qrCampaigns.id, created.id));
      expect(row).toMatchObject({
        organizationId: orgA,
        diagnosticTemplateId: templateA,
        name: 'Fair 2026',
        description: 'Booth A',
        utmSource: 'qrcode',
        utmMedium: DEFAULT_QR_CAMPAIGN_MEDIUM,
        utmCampaign: 'fair-2026',
        utmContent: null,
        scanCount: 0,
        completionCount: 0,
        isActive: true,
        expiresAt: new Date('2026-12-31T14:59:59.999Z'),
      });
      expect(row.shortCode).toMatch(/^[A-Za-z0-9]{8}$/);
      const tracking = new URL(row.trackingUrl);
      expect(tracking.pathname).toBe(`/q/${row.shortCode}`);
      expect(Object.fromEntries(tracking.searchParams)).toEqual({
        utm_source: 'qrcode',
        utm_medium: DEFAULT_QR_CAMPAIGN_MEDIUM,
        utm_campaign: 'fair-2026',
      });
      expect(created.qrCodeDataUrl).toMatch(PNG_DATA_URL);
    });

    it('lists the organization’s campaigns newest first, each with its /q/ URL and template', async () => {
      const orgC = await createOrganization('QRルーターC');
      const templateC = await createTemplate(orgC);
      const older = await storeCampaign(orgC, templateC, {
        createdAt: new Date('2026-10-01T00:00:00Z'),
      });
      const newer = await storeCampaign(orgC, templateC, {
        createdAt: new Date('2026-10-02T00:00:00Z'),
        utmCampaign: 'newer',
      });
      const adminC = await callerFor(orgC);

      const listed = await adminC.listCampaigns({ organizationId: orgC });
      expect(listed.map((campaign: { id: string }) => campaign.id)).toEqual([newer.id, older.id]);
      expect(listed[0]).toMatchObject({
        diagnosticTemplate: { id: templateC, name: 'Template', title: 'Readiness' },
      });
      expect(listed[0]).toHaveProperty('destination');
      // Built from the short code, not read from the stored tracking_url (#503)
      const tracking = new URL(listed[0].trackingUrl);
      expect(tracking.pathname).toBe(`/q/${newer.shortCode}`);
      expect(tracking.searchParams.get('utm_campaign')).toBe('newer');
    });

    it('answers the detail with its template and a QR code', async () => {
      const stored = await storeCampaign(orgA, templateA);
      const campaign = await adminA.getCampaign({ ...asA(), id: stored.id });
      expect(campaign).toMatchObject({
        id: stored.id,
        shortCode: stored.shortCode,
        diagnosticTemplate: { id: templateA },
      });
      expect(new URL(campaign.trackingUrl).pathname).toBe(`/q/${stored.shortCode}`);
      expect(campaign.qrCodeDataUrl).toMatch(PNG_DATA_URL);
    });

    it('downloads the QR code of a campaign with its code and URL', async () => {
      const stored = await storeCampaign(orgA, templateA);
      const download = await adminA.generateCampaignQR({
        ...asA(),
        campaignId: stored.id,
        size: 'small',
      });
      expect(download).toMatchObject({ shortCode: stored.shortCode });
      expect(new URL(download.trackingUrl).pathname).toBe(`/q/${stored.shortCode}`);
      expect(download.qrCode).toMatch(PNG_DATA_URL);
    });

    describe('ids no campaign or template has', () => {
      const missing = randomUUID();
      const calls: Record<string, () => Promise<unknown>> = {
        getCampaign: () => adminA.getCampaign({ ...asA(), id: missing }),
        updateCampaign: () => adminA.updateCampaign({ ...asA(), id: missing, data: { name: 'X' } }),
        deleteCampaign: () => adminA.deleteCampaign({ ...asA(), id: missing }),
        generateCampaignQR: () => adminA.generateCampaignQR({ ...asA(), campaignId: missing }),
        getCampaignStats: () => adminA.getCampaignStats({ ...asA(), campaignId: missing }),
        'createCampaign (template)': () =>
          adminA.createCampaign({ ...asA(), name: 'No template', diagnosticTemplateId: missing }),
      };

      it.each(Object.keys(calls))('%s answers NOT_FOUND and changes no campaign', async (name) => {
        await storeCampaign(orgA, templateA);
        const before = await campaignsOf(orgA);
        await expect(calls[name]()).rejects.toMatchObject({ code: 'NOT_FOUND' });
        expect(await campaignsOf(orgA)).toEqual(before);
      });
    });

    it('draws again when the code drawn is held by another organization’s campaign', async () => {
      const held = await storeCampaign(orgB, templateB);
      const free = freshCode('f');
      drawnCodes.push(held.shortCode, free);
      const created = await adminA.createCampaign({
        ...asA(),
        name: 'Seminar',
        diagnosticTemplateId: templateA,
      });
      expect(created).toMatchObject({ organizationId: orgA, shortCode: free });
      expect(drawnCodes).toEqual([]);
      const [heldNow] = await pg.select().from(qrCampaigns).where(eq(qrCampaigns.id, held.id));
      expect(heldNow).toEqual(held);
    });

    it('deletes the one campaign, and answers NOT_FOUND to a second delete', async () => {
      const kept = await storeCampaign(orgA, templateA);
      const deleted = await storeCampaign(orgA, templateA);
      await expect(adminA.deleteCampaign({ ...asA(), id: deleted.id })).resolves.toEqual({
        success: true,
      });
      const ids = (await campaignsOf(orgA)).map((campaign) => campaign.id);
      expect(ids).toContain(kept.id);
      expect(ids).not.toContain(deleted.id);
      await expect(adminA.deleteCampaign({ ...asA(), id: deleted.id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  }
);
