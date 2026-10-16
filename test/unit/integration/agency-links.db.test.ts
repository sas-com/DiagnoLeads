/**
 * Agency links (#147) on a real PostgreSQL: a diagnosis answered through an issued link records
 * the agency on the new lead, and the list counts the leads of each link.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/agency-links.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import {
  agencyLinks,
  diagnosticSubmissions,
  leads,
  organizationMembers,
  organizations,
  users,
} from '@/lib/db/schema';
import { generateAgencyCode } from '@/lib/features/agency-links/types/schemas';
import {
  type AxMigrationSubmissionInput,
  submitAxMigrationDiagnosis,
} from '@/lib/features/diagnostics/ax-migration/submission-service';
import { appRouter } from '@/server/routers/_app';
import { as400Answers } from '@/test/fixtures/ax-migration';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('agency links (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const db = pg as unknown as Parameters<typeof submitAxMigrationDiagnosis>[0];
  const now = new Date('2026-10-16T01:00:00Z');
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let organizationId: string;
  let otherOrganizationId: string;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let caller: any;

  const input = (
    tracking: AxMigrationSubmissionInput['tracking'],
    email = `agency-${unique()}@example.co.jp`
  ): AxMigrationSubmissionInput => ({
    answers: as400Answers,
    contact: { company: '三田製作所', name: '山田 太郎', email },
    privacyConsent: true,
    consultationRequested: false,
    tracking,
    locale: 'ja',
  });

  const createLink = async (
    orgId: string,
    values: Partial<typeof agencyLinks.$inferInsert> = {}
  ) => {
    const [link] = await pg
      .insert(agencyLinks)
      .values({
        organizationId: orgId,
        code: generateAgencyCode(),
        agencyName: 'テスト代行',
        kind: 'telemarketing_agency',
        ...values,
      })
      .returning();
    return link;
  };

  const leadOf = async (leadId: string) => {
    const lead = await pg.query.leads.findFirst({ where: eq(leads.id, leadId) });
    if (!lead) throw new Error('lead not found');
    return lead;
  };

  beforeAll(async () => {
    const created = await pg
      .insert(organizations)
      .values([
        { name: '代行リンクテスト', slug: `agency-${unique()}` },
        { name: '代行リンク別組織', slug: `agency-other-${unique()}` },
      ])
      .returning({ id: organizations.id });
    organizationId = created[0].id;
    otherOrganizationId = created[1].id;
    const [user] = await pg
      .insert(users)
      .values({ email: `agency-admin-${unique()}@example.com`, name: 'テスト 管理者' })
      .returning();
    await pg.insert(organizationMembers).values({ organizationId, userId: user.id, role: 'admin' });
    caller = appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId: user.id }, user },
      user,
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);
  });

  afterAll(async () => {
    if (organizationId) {
      await pg.delete(organizations).where(eq(organizations.id, organizationId));
      await pg.delete(organizations).where(eq(organizations.id, otherOrganizationId));
    }
    await client?.end();
  });

  it('records the agency of an active link on the new lead, over the UTM parameters', async () => {
    const link = await createLink(organizationId, { campaign: '11月リスト' });

    const outcome = await submitAxMigrationDiagnosis(
      db,
      organizationId,
      input({ agency: link.code.toUpperCase(), ref: 'partner-x', utmMedium: 'cpc' }),
      now
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(await leadOf(outcome.leadId)).toMatchObject({
      inflowSource: 'telemarketing_agency',
      agencyName: 'テスト代行',
      agencyLinkId: link.id,
      referrerName: null,
    });
    const submission = await pg.query.diagnosticSubmissions.findFirst({
      where: eq(diagnosticSubmissions.id, outcome.submissionId),
    });
    expect(submission?.tracking).toMatchObject({ agency: link.code.toUpperCase() });
  });

  it('uses the kind of the link (referral agency)', async () => {
    const link = await createLink(organizationId, {
      agencyName: '紹介代行',
      kind: 'referral_agency',
    });
    const outcome = await submitAxMigrationDiagnosis(
      db,
      organizationId,
      input({ agency: link.code }),
      now
    );
    if (!outcome.ok) throw new Error('submission failed');
    expect(await leadOf(outcome.leadId)).toMatchObject({
      inflowSource: 'referral_agency',
      agencyName: '紹介代行',
      agencyLinkId: link.id,
    });
  });

  it('attributes nothing for a disabled link, keeping the code in the tracking', async () => {
    const link = await createLink(organizationId, { disabledAt: now });
    const outcome = await submitAxMigrationDiagnosis(
      db,
      organizationId,
      input({ agency: link.code, utmMedium: 'cpc' }),
      now
    );
    if (!outcome.ok) throw new Error('submission failed');
    expect(await leadOf(outcome.leadId)).toMatchObject({
      inflowSource: 'advertising',
      agencyName: null,
      agencyLinkId: null,
    });
  });

  it.each([
    ['a link of another organization', async () => (await createLink(otherOrganizationId)).code],
    ['an unknown code', async () => generateAgencyCode()],
    ['a malformed code', async () => "x' OR 1=1 --"],
  ])('attributes nothing for %s', async (_label, codeOf) => {
    const outcome = await submitAxMigrationDiagnosis(
      db,
      organizationId,
      input({ agency: await codeOf() }),
      now
    );
    if (!outcome.ok) throw new Error('submission failed');
    expect(await leadOf(outcome.leadId)).toMatchObject({
      inflowSource: 'lp_organic',
      agencyName: null,
      agencyLinkId: null,
    });
  });

  it('never changes an existing lead from the public form', async () => {
    const email = `existing-${unique()}@example.co.jp`;
    const [existing] = await pg
      .insert(leads)
      .values({ organizationId, email, name: '登録済み', inflowSource: 'existing_customer' })
      .returning();
    const link = await createLink(organizationId);

    const outcome = await submitAxMigrationDiagnosis(
      db,
      organizationId,
      input({ agency: link.code }, email),
      now
    );
    if (!outcome.ok) throw new Error('submission failed');
    expect(outcome.leadId).toBe(existing.id);
    expect(await leadOf(existing.id)).toMatchObject({
      inflowSource: 'existing_customer',
      agencyName: null,
      agencyLinkId: null,
    });
  });

  it('lists the links of the organization with their lead counts, and disables them', async () => {
    const created = await caller.agencyLinks.create({
      organizationId,
      agencyName: '一覧テスト代行',
      kind: 'telemarketing_agency',
      campaign: '',
    });
    for (let i = 0; i < 2; i++) {
      await submitAxMigrationDiagnosis(db, organizationId, input({ agency: created.code }), now);
    }

    const listed = await caller.agencyLinks.list({ organizationId });
    const row = listed.links.find((link: { id: string }) => link.id === created.id);
    expect(row).toMatchObject({ agencyName: '一覧テスト代行', campaign: null, leadCount: 2 });
    expect(listed.canManage).toBe(true);
    // Links of the other organization never appear
    const otherLink = await createLink(otherOrganizationId);
    const again = await caller.agencyLinks.list({ organizationId });
    expect(again.links.some((link: { id: string }) => link.id === otherLink.id)).toBe(false);

    await caller.agencyLinks.setActive({ organizationId, id: created.id, active: false });
    const disabled = await caller.agencyLinks.list({ organizationId });
    expect(
      disabled.links.find((link: { id: string }) => link.id === created.id).disabledAt
    ).not.toBeNull();

    await expect(
      caller.agencyLinks.setActive({ organizationId, id: otherLink.id, active: false })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
