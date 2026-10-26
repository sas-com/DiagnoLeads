/**
 * The breakdown of the QR campaigns (#700, owner decision of 2026-10-26) against PostgreSQL:
 * analytics.getQrCampaignBreakdown counts, for every campaign of the organization in one query,
 * the answers whose tracking carries the campaign's short code, in the campaign's organization,
 * from the campaign's creation, test answers left out:
 * - existingLeadAnswers: the answers that matched a lead already there (既存リードの再回答)
 * - interestedNewLeads / consultationNewLeads: the leads those answers created that are 関心あり
 *   (the lead list's MQL level, an MQL date included) and that asked for a consultation (the
 *   list's 相談申込 filter)
 * Another organization's answers with the same code, and its leads, never count; a member of one
 * organization cannot read another's.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/qr-campaign-breakdown.db.test.ts
 */
import type { Database } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import {
  diagnosticSubmissions,
  diagnosticTemplates,
  leads,
  organizationMembers,
  organizations,
  qrCampaigns,
  users,
} from '@/lib/db/schema';
import type { QrCampaignBreakdown } from '@/lib/features/analytics/types/schemas';
import {
  type AxMigrationSubmissionInput,
  submitAxMigrationDiagnosis,
} from '@/lib/features/diagnostics/ax-migration/submission-service';
import { appRouter } from '@/server/routers/_app';
import { as400Answers } from '@/test/fixtures/ax-migration';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/lib/db/client', () => ({
  get db() {
    return deps.db;
  },
}));
vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

type Caller = ReturnType<typeof appRouter.createCaller>;

describe.skipIf(!url)('QR campaign breakdown (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)! as unknown as Database;
  deps.db = pg;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  /** Letters and digits only, so the codes are unique per run and can be short codes */
  const randomPart = (length: number) => {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  };
  const CREATED = new Date('2026-10-20T00:00:00Z');
  const AFTER = new Date('2026-10-22T03:00:00Z');
  const organizationIds: string[] = [];
  const userIds: string[] = [];
  const templates = new Map<string, string>();
  let orgA: string;
  let orgB: string;
  let callerOfA: Caller;
  /** A's campaign with every kind of answer, and its code */
  let fair: { id: string; code: string };
  /** A's campaign no answer reaches */
  let quiet: { id: string; code: string };
  /** B's campaign, answered in B */
  let partner: { id: string; code: string };

  async function createOrganization(name: string) {
    const [org] = await pg
      .insert(organizations)
      .values({ name, slug: `qr-breakdown-${unique()}` })
      .returning({ id: organizations.id });
    organizationIds.push(org.id);
    const [template] = await pg
      .insert(diagnosticTemplates)
      .values({ organizationId: org.id, name: 'Template', slug: `t-${unique()}`, title: 'Template' })
      .returning({ id: diagnosticTemplates.id });
    templates.set(org.id, template.id);
    return org.id;
  }

  async function createCampaign(organizationId: string) {
    const code = `Qb${randomPart(8)}`;
    const [row] = await pg
      .insert(qrCampaigns)
      .values({
        organizationId,
        // biome-ignore lint/style/noNonNullAssertion: created with the organization
        diagnosticTemplateId: templates.get(organizationId)!,
        name: 'Campaign',
        shortCode: code,
        trackingUrl: `https://example.com/q/${code}`,
        createdAt: CREATED,
      })
      .returning({ id: qrCampaigns.id });
    return { id: row.id, code };
  }

  async function createLead(organizationId: string, values: Partial<typeof leads.$inferInsert> = {}) {
    const [row] = await pg
      .insert(leads)
      .values({ organizationId, email: `qrb-${unique()}@example.co.jp`, ...values })
      .returning({ id: leads.id });
    return row.id;
  }

  /** A stored answer, shaped as the submissions write it (tracking keeps the code as `qr`) */
  async function answer(
    organizationId: string,
    values: {
      leadId: string | null;
      leadCreated: boolean;
      qr: string;
      isTest?: boolean;
      createdAt?: Date;
    }
  ) {
    await pg.insert(diagnosticSubmissions).values({
      organizationId,
      leadId: values.leadId,
      leadCreated: values.leadCreated,
      diagnosticKey: 'ax-migration',
      diagnosticVersion: 1,
      answers: {},
      result: {},
      tracking: { utmSource: 'qrcode', utmMedium: 'offline', qr: values.qr },
      isTest: values.isTest ?? false,
      createdAt: values.createdAt ?? AFTER,
    });
  }

  /** A new lead from the code: the lead and the answer that created it */
  async function newLeadFrom(
    organizationId: string,
    qr: string,
    lead: Partial<typeof leads.$inferInsert> = {}
  ) {
    const leadId = await createLead(organizationId, lead);
    await answer(organizationId, { leadId, leadCreated: true, qr });
    return leadId;
  }

  async function memberCaller(organizationId: string): Promise<Caller> {
    const [user] = await pg
      .insert(users)
      .values({ email: `qr-breakdown-${unique()}@example.com`, name: 'member' })
      .returning();
    userIds.push(user.id);
    await pg.insert(organizationMembers).values({ organizationId, userId: user.id, role: 'member' });
    // The session as Better Auth gives it to the router
    const authUser = {
      id: user.id,
      email: user.email,
      name: user.name ?? 'member',
      emailVerified: false,
      image: null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
    return appRouter.createCaller({
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
  }

  const breakdownOf = (rows: QrCampaignBreakdown[], campaignId: string) =>
    rows.find((row) => row.campaignId === campaignId);

  const ax = (level: string) => ({ axMigration: { mql: { level } } });

  beforeAll(async () => {
    orgA = await createOrganization('QR内訳A');
    orgB = await createOrganization('QR内訳B');
    fair = await createCampaign(orgA);
    quiet = await createCampaign(orgA);
    partner = await createCampaign(orgB);
    callerOfA = await memberCaller(orgA);

    // A's new leads from the fair's code
    // 関心あり by the diagnosis, and asked for a consultation
    await newLeadFrom(orgA, fair.code, {
      responses: ax('interest'),
      conversionPoint: 'consultation',
    });
    // 関心あり by an MQL date set by hand (the list counts it as 関心あり, the diagnosis says 適合)
    await newLeadFrom(orgA, fair.code, {
      responses: ax('fit'),
      mqlQualifiedAt: new Date('2026-10-23T00:00:00Z'),
    });
    // 適合 only, from the diagnosis
    await newLeadFrom(orgA, fair.code, { responses: ax('fit'), conversionPoint: 'web_diagnosis' });
    // Asked for a consultation, not MQL
    await newLeadFrom(orgA, fair.code, { responses: ax('none'), conversionPoint: 'consultation' });

    // Two answers of A's leads that were there before: re-answers, not new leads
    const existing = await createLead(orgA, {
      responses: ax('interest'),
      conversionPoint: 'consultation',
    });
    await answer(orgA, { leadId: existing, leadCreated: false, qr: fair.code });
    await answer(orgA, { leadId: existing, leadCreated: false, qr: fair.code });

    // Never counted for the fair
    // a test answer (the builder's preview), of a new and of an existing lead
    const tested = await createLead(orgA, { responses: ax('interest'), conversionPoint: 'consultation' });
    await answer(orgA, { leadId: tested, leadCreated: true, qr: fair.code, isTest: true });
    await answer(orgA, { leadId: existing, leadCreated: false, qr: fair.code, isTest: true });
    // an answer before the campaign was created
    const earlier = await createLead(orgA, { responses: ax('interest') });
    await answer(orgA, {
      leadId: earlier,
      leadCreated: true,
      qr: fair.code,
      createdAt: new Date('2026-10-19T23:59:59Z'),
    });
    await answer(orgA, {
      leadId: existing,
      leadCreated: false,
      qr: fair.code,
      createdAt: new Date('2026-10-19T23:59:59Z'),
    });
    // the code in another case: another code
    await newLeadFrom(orgA, fair.code.toUpperCase(), {
      responses: ax('interest'),
      conversionPoint: 'consultation',
    });
    // a lead whose answer has no code
    const plain = await createLead(orgA, { responses: ax('interest'), conversionPoint: 'consultation' });
    await pg.insert(diagnosticSubmissions).values({
      organizationId: orgA,
      leadId: plain,
      leadCreated: true,
      diagnosticKey: 'ax-migration',
      diagnosticVersion: 1,
      answers: {},
      result: {},
      tracking: { utmSource: 'qrcode' },
      createdAt: AFTER,
    });

    // B's answers with A's code, of B's new and existing leads: never A's
    await newLeadFrom(orgB, fair.code, { responses: ax('interest'), conversionPoint: 'consultation' });
    const existingOfB = await createLead(orgB, { responses: ax('interest') });
    await answer(orgB, { leadId: existingOfB, leadCreated: false, qr: fair.code });
    // An answer of A linked to B's lead (data that disagrees): the lead is not A's to count
    await answer(orgA, { leadId: existingOfB, leadCreated: true, qr: quiet.code });

    // B's own campaign, answered in B
    await newLeadFrom(orgB, partner.code, { responses: ax('interest'), conversionPoint: 'consultation' });
    await answer(orgB, { leadId: existingOfB, leadCreated: false, qr: partner.code });
  });

  afterAll(async () => {
    if (organizationIds.length > 0) {
      await pg.delete(organizations).where(inArray(organizations.id, organizationIds));
    }
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  it("counts the fair's re-answers of existing leads, and its new leads that are 関心あり and that asked for a consultation", async () => {
    const rows = await callerOfA.analytics.getQrCampaignBreakdown({ organizationId: orgA });
    expect(breakdownOf(rows, fair.id)).toEqual({
      campaignId: fair.id,
      existingLeadAnswers: 2,
      interestedNewLeads: 2,
      consultationNewLeads: 2,
    });
  });

  it("answers only the organization's own campaigns, without B's answers with A's code", async () => {
    const rows = await callerOfA.analytics.getQrCampaignBreakdown({ organizationId: orgA });
    const campaignsOfA = await pg
      .select({ id: qrCampaigns.id })
      .from(qrCampaigns)
      .where(eq(qrCampaigns.organizationId, orgA));
    const idsOfA = campaignsOfA.map((campaign) => campaign.id);
    expect(rows.map((row) => row.campaignId)).toEqual(expect.arrayContaining([fair.id, quiet.id]));
    for (const row of rows) expect(idsOfA).toContain(row.campaignId);
    expect(breakdownOf(rows, partner.id)).toBeUndefined();
  });

  it("counts no lead of another organization, even through an answer of the organization", async () => {
    const rows = await callerOfA.analytics.getQrCampaignBreakdown({ organizationId: orgA });
    // The answer is a new lead's (lead_created), but the lead is B's: nothing to count as A's
    expect(breakdownOf(rows, quiet.id)).toEqual({
      campaignId: quiet.id,
      existingLeadAnswers: 0,
      interestedNewLeads: 0,
      consultationNewLeads: 0,
    });
  });

  it("gives B its own campaign's counts, from B's answers only", async () => {
    const callerOfB = await memberCaller(orgB);
    const rows = await callerOfB.analytics.getQrCampaignBreakdown({ organizationId: orgB });
    expect(rows).toEqual([
      {
        campaignId: partner.id,
        existingLeadAnswers: 1,
        interestedNewLeads: 1,
        consultationNewLeads: 1,
      },
    ]);
  });

  it("refuses a member of A who asks for B's campaigns", async () => {
    await expect(
      callerOfA.analytics.getQrCampaignBreakdown({ organizationId: orgB })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('counts the answers the AX diagnosis stores: a new lead with a consultation, then the same person again', async () => {
    const campaign = await createCampaign(orgA);
    const email = `Qrb-${unique()}@Example.co.jp`;
    const input = (consultationRequested: boolean): AxMigrationSubmissionInput => ({
      answers: as400Answers,
      contact: { company: '架空製作所', name: '試験 太郎', email },
      privacyConsent: true,
      consultationRequested,
      tracking: { utmSource: 'qrcode', utmMedium: 'offline', qr: campaign.code },
      locale: 'ja',
    });
    const first = await submitAxMigrationDiagnosis(pg, orgA, input(true), AFTER);
    const again = await submitAxMigrationDiagnosis(pg, orgA, input(false), AFTER);
    expect([first.ok && first.leadCreated, again.ok && again.leadCreated]).toEqual([true, false]);

    const rows = await callerOfA.analytics.getQrCampaignBreakdown({ organizationId: orgA });
    expect(breakdownOf(rows, campaign.id)).toMatchObject({
      existingLeadAnswers: 1,
      consultationNewLeads: 1,
    });
    // The new lead itself is counted on the campaign row, not here
    const [row] = await pg
      .select({ completionCount: qrCampaigns.completionCount })
      .from(qrCampaigns)
      .where(eq(qrCampaigns.id, campaign.id));
    expect(row.completionCount).toBe(1);
  });

  it('drops a deleted lead from the new leads it was, and keeps the re-answers of a deleted lead', async () => {
    const campaign = await createCampaign(orgA);
    const gone = await newLeadFrom(orgA, campaign.code, {
      responses: ax('interest'),
      conversionPoint: 'consultation',
    });
    const leaving = await createLead(orgA);
    await answer(orgA, { leadId: leaving, leadCreated: false, qr: campaign.code });
    await pg.delete(leads).where(inArray(leads.id, [gone, leaving]));

    const rows = await callerOfA.analytics.getQrCampaignBreakdown({ organizationId: orgA });
    expect(breakdownOf(rows, campaign.id)).toEqual({
      campaignId: campaign.id,
      existingLeadAnswers: 1,
      interestedNewLeads: 0,
      consultationNewLeads: 0,
    });
  });
});
