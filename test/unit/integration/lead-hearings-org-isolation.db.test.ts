/**
 * Organization isolation of lead hearings (#356) on a real PostgreSQL: an admin of organization
 * B passes the ids of A's lead, hearing and diagnosis submission, and A's own field keys. Reads
 * are NOT_FOUND, writes leave A's rows as they were, and each organization's hearing settings
 * (hidden fields, own fields, version) stay its own. All values are fictional.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/lead-hearings-org-isolation.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import {
  diagnosticSubmissions,
  leadHearings,
  leads,
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

const OWN_FIELD = {
  id: 'isoa0001',
  label: '組織Aだけの項目',
  type: 'text' as const,
  section: 'requirements' as const,
  options: [],
};

describe.skipIf(!url)('lead hearings: organization isolation (PostgreSQL)', () => {
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
  let leadA: string;
  let leadB: string;
  let submissionA: string;
  let hearingA: { id: string; updatedAt: Date };

  async function callerFor(organizationId: string) {
    const [user] = await pg
      .insert(users)
      .values({ email: `hearing-iso-${unique()}@example.com`, name: 'テスト 太郎' })
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

  const hearingRowOf = async (id: string) =>
    (await pg.select().from(leadHearings).where(eq(leadHearings.id, id)))[0];
  const settingsOf = async (organizationId: string) =>
    (
      await pg
        .select({ settings: organizations.settings })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
    )[0]?.settings;

  beforeAll(async () => {
    const created = await pg
      .insert(organizations)
      .values([
        { name: 'ヒアリング切り分けA', slug: `hearing-iso-a-${unique()}` },
        { name: 'ヒアリング切り分けB', slug: `hearing-iso-b-${unique()}` },
      ])
      .returning({ id: organizations.id });
    orgA = created[0].id;
    orgB = created[1].id;
    adminA = await callerFor(orgA);
    adminB = await callerFor(orgB);
    const [a, b] = await pg
      .insert(leads)
      .values([
        { organizationId: orgA, email: `iso-a-${unique()}@example.co.jp` },
        { organizationId: orgB, email: `iso-b-${unique()}@example.co.jp` },
      ])
      .returning({ id: leads.id });
    leadA = a.id;
    leadB = b.id;
    const [submission] = await pg
      .insert(diagnosticSubmissions)
      .values({
        organizationId: orgA,
        leadId: leadA,
        leadCreated: true,
        diagnosticKey: 'ax-migration',
        diagnosticVersion: 2,
        answers: { platform: 'as400', timeline: 'within_1y' },
        result: { challenges: { primary: 'people', selected: ['people'] } },
      })
      .returning({ id: diagnosticSubmissions.id });
    submissionA = submission.id;

    // A asks one field of its own and hides another; its hearing records both kinds of value
    await adminA.leadHearings.updateCatalogSettings({
      organizationId: orgA,
      settings: { hidden: ['machineModel'], required: null, order: {}, customFields: [OWN_FIELD] },
      expectedVersion: 0,
    });
    const created2 = await adminA.leadHearings.create({
      organizationId: orgA,
      leadId: leadA,
      heldOn: '2026-10-20',
    });
    hearingA = await adminA.leadHearings.update({
      organizationId: orgA,
      id: created2.id,
      heldOn: '2026-10-20',
      fields: {
        targetSystem: { value: 'as400', status: 'done', source: null },
        'custom:isoa0001': { value: 'A だけの答え', status: 'done', source: null },
      },
      expectedUpdatedAt: created2.updatedAt,
    });
  });

  afterAll(async () => {
    if (orgA) await pg.delete(organizations).where(inArray(organizations.id, [orgA, orgB]));
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  it("refuses B's admin when it names organization A itself", async () => {
    await expect(
      adminB.leadHearings.get({ organizationId: orgA, id: hearingA.id })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it("reads nothing of A by its ids (listByLead, get, summary, prefillSources)", async () => {
    await expect(
      adminB.leadHearings.listByLead({ organizationId: orgB, leadId: leadA })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      adminB.leadHearings.get({ organizationId: orgB, id: hearingA.id })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      adminB.leadHearings.summary({ organizationId: orgB, id: hearingA.id })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      adminB.leadHearings.prefillSources({ organizationId: orgB, leadId: leadA })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it("changes and deletes nothing of A by its ids (update, delete)", async () => {
    const before = await hearingRowOf(hearingA.id);
    await expect(
      adminB.leadHearings.update({
        organizationId: orgB,
        id: hearingA.id,
        heldOn: '2026-10-21',
        fields: {},
        expectedUpdatedAt: hearingA.updatedAt,
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      adminB.leadHearings.delete({ organizationId: orgB, id: hearingA.id })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await hearingRowOf(hearingA.id)).toEqual(before);
  });

  it("creates nothing on A's lead, and never starts B's hearing from A's submission (create)", async () => {
    await expect(
      adminB.leadHearings.create({ organizationId: orgB, leadId: leadA, heldOn: '2026-10-21' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      adminB.leadHearings.create({
        organizationId: orgB,
        leadId: leadB,
        heldOn: '2026-10-21',
        submissionId: submissionA,
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await pg.select().from(leadHearings).where(eq(leadHearings.leadId, leadA))).toHaveLength(
      1
    );
  });

  it("keeps each organization's hearing settings its own (catalogSettings, updateCatalogSettings)", async () => {
    // B reads its own defaults, not A's hidden field or own field
    expect((await adminB.leadHearings.catalogSettings({ organizationId: orgB })).settings).toEqual(
      { hidden: [], required: null, order: {}, customFields: [], version: 0 }
    );

    // B saves its settings: A's are unchanged, version included
    const aBefore = await settingsOf(orgA);
    await adminB.leadHearings.updateCatalogSettings({
      organizationId: orgB,
      settings: { hidden: ['targetSystem'], required: null, order: {}, customFields: [] },
      expectedVersion: 0,
    });
    expect(await settingsOf(orgA)).toEqual(aBefore);
    expect((await adminA.leadHearings.catalogSettings({ organizationId: orgA })).settings).toMatchObject({
      hidden: ['machineModel'],
      customFields: [OWN_FIELD],
      version: 1,
    });
    // A's version does not count B's save: a stale A screen is refused on A's version only
    await expect(
      adminA.leadHearings.updateCatalogSettings({
        organizationId: orgA,
        settings: { hidden: [], required: null, order: {}, customFields: [OWN_FIELD] },
        expectedVersion: 2,
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it("does not let B record a value for A's own field", async () => {
    const hearing = await adminB.leadHearings.create({
      organizationId: orgB,
      leadId: leadB,
      heldOn: '2026-10-22',
    });
    await expect(
      adminB.leadHearings.update({
        organizationId: orgB,
        id: hearing.id,
        heldOn: '2026-10-22',
        fields: { 'custom:isoa0001': { value: 'B からの書き込み', status: 'done', source: null } },
        expectedUpdatedAt: hearing.updatedAt,
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    // B's own hidden field (targetSystem) applies to B only: A's hearing still shows its value
    const { summary } = await adminA.leadHearings.summary({
      organizationId: orgA,
      id: hearingA.id,
    });
    const keys = summary.sections.flatMap((section: { items: { key: string }[] }) =>
      section.items.map((item) => item.key)
    );
    expect(keys).toEqual(expect.arrayContaining(['targetSystem', 'custom:isoa0001']));
  });
});
