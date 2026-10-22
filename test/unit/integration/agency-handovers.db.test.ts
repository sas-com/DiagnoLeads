/**
 * Agency handovers (#152) on a real PostgreSQL: importing the agency's report (finding leads by
 * email address or company name, rows without a lead or with several, replacing a handover),
 * the hearing prefill from it, and who may import. All values are made up.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/agency-handovers.db.test.ts
 */
import type { Database } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import { leads, organizationMembers, organizations, users } from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('agency handovers (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)! as unknown as Database;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const orgIds: string[] = [];
  const userIds: string[] = [];
  let org: string;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
  const callers: Record<'member' | 'viewer' | 'other', any> = {} as never;

  async function caller(organizationId: string, role: string) {
    const [user] = await pg
      .insert(users)
      .values({ email: `handover-${role}-${unique()}@example.com`, name: '営業 花子' })
      .returning();
    userIds.push(user.id);
    await pg.insert(organizationMembers).values({ organizationId, userId: user.id, role });
    return appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId: user.id }, user },
      user,
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);
  }

  const lead = async (values: Partial<typeof leads.$inferInsert>, organizationId = org) => {
    const [row] = await pg
      .insert(leads)
      .values({ organizationId, email: `handover-${unique()}@example.co.jp`, ...values })
      .returning();
    return row;
  };

  beforeAll(async () => {
    for (const name of ['引き継ぎ取り込みテスト', '別組織']) {
      const [row] = await pg.insert(organizations).values({ name, slug: `handover-${unique()}` }).returning();
      orgIds.push(row.id);
    }
    org = orgIds[0];
    callers.member = await caller(org, 'member');
    callers.viewer = await caller(org, 'parent_viewer');
    callers.other = await caller(orgIds[1], 'member');
  });

  afterAll(async () => {
    for (const id of orgIds) await pg.delete(organizations).where(eq(organizations.id, id));
    await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  it('finds leads by email or company, reports the rest and replaces on a later import', async () => {
    const byEmail = await lead({ email: `yamada-${unique()}@example.co.jp`, company: '架空商事' });
    const byCompany = await lead({ company: `架空工業-${unique()}` });
    const twinName = `架空物産-${unique()}`;
    await lead({ company: twinName });
    await lead({ company: twinName });
    // Same address in another organization: never found from here
    const foreign = await lead({ email: `foreign-${unique()}@example.co.jp` }, orgIds[1]);

    const { results } = await callers.member.agencyHandovers.import({
      organizationId: org,
      rows: [
        { email: byEmail.email.toUpperCase(), machineModel: 'IBM Power 9', machineModelConfirmed: true, interestLevel: 'high', contactName: '山田 太郎', contactPhone: '03-0000-0000' },
        { company: ` ${byCompany.company} `, decisionMakerPresent: 'no', refusalReason: '予算がない' },
        { company: twinName },
        { email: 'nobody@example.co.jp' },
        { email: foreign.email },
        { machineModel: 'no key' },
        // An address that is not one: found by the company name
        { email: 'not-an-address', company: byCompany.company, machineModel: 'ACOS-4' },
      ],
    });
    expect(results.map((r: { status: string }) => r.status)).toEqual([
      'saved',
      // The same lead again further down: that row wins
      'replaced',
      'ambiguous',
      'unmatched',
      'unmatched',
      'invalid',
      'saved',
    ]);
    expect(
      (await callers.member.agencyHandovers.get({ organizationId: org, leadId: byCompany.id })).handover
    ).toMatchObject({ machineModel: 'ACOS-4' });

    const got = await callers.member.agencyHandovers.get({ organizationId: org, leadId: byEmail.id });
    expect(got.handover).toMatchObject({
      machineModel: 'IBM Power 9',
      machineModelConfirmed: true,
      interestLevel: 'high',
      contactName: '山田 太郎',
      contactPhone: '03-0000-0000',
      importedByName: '営業 花子',
    });

    // A later report replaces the handover
    await callers.member.agencyHandovers.import({
      organizationId: org,
      rows: [{ email: byEmail.email, machineModel: 'IBM Power 10' }],
    });
    expect(
      (await callers.member.agencyHandovers.get({ organizationId: org, leadId: byEmail.id })).handover
    ).toMatchObject({ machineModel: 'IBM Power 10', interestLevel: null, contactName: null });
    expect(
      (await callers.other.agencyHandovers.get({ organizationId: orgIds[1], leadId: foreign.id })).handover
    ).toBeNull();
  });

  it('prefills a new hearing from the handover, not confirmed until the meeting', async () => {
    const target = await lead({ company: `架空精機-${unique()}` });
    await callers.member.agencyHandovers.import({
      organizationId: org,
      rows: [
        {
          company: target.company,
          machineModel: 'ACOS-2',
          hardwareSupportEnd: '2028-03',
          retirementPlan: '2027-09',
          decisionMakerPresent: 'yes',
        },
      ],
    });
    const hearing = await callers.member.leadHearings.create({
      organizationId: org,
      leadId: target.id,
      heldOn: '2026-11-05',
    });
    expect(hearing.fields).toMatchObject({
      machineModel: { value: 'ACOS-2', status: 'not_yet', source: 'agency' },
      hardwareSupportEnd: { value: '2028-03', source: 'agency' },
      earliestRetirement: { value: '2027-09', source: 'agency' },
      decisionMakerPresent: { value: 'yes', source: 'agency' },
    });
  });

  it('rejects a date that does not exist, saving nothing of the report', async () => {
    const target = await lead({ company: `架空電機-${unique()}` });
    await expect(
      callers.member.agencyHandovers.import({
        organizationId: org,
        rows: [{ company: target.company, appointmentOn: '2026-02-31' }],
      })
    ).resolves.toMatchObject({ results: [{ status: 'invalid' }] });
    expect((await callers.member.agencyHandovers.get({ organizationId: org, leadId: target.id })).handover).toBeNull();
  });

  it('keeps the contact person from viewers of a parent organization', async () => {
    const target = await lead({ company: `架空化学-${unique()}` });
    await callers.member.agencyHandovers.import({
      organizationId: org,
      rows: [{ company: target.company, contactName: '山田 太郎', contactPhone: '03-0000-0000', machineModel: 'IBM i' }],
    });
    expect((await callers.viewer.agencyHandovers.get({ organizationId: org, leadId: target.id })).handover).toMatchObject({
      contactName: null,
      contactPhone: null,
      machineModel: 'IBM i',
    });
  });

  it('lets only members who edit leads import, and keeps other organizations out', async () => {
    await expect(
      callers.viewer.agencyHandovers.import({ organizationId: org, rows: [{ company: 'x' }] })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const foreign = await lead({}, orgIds[1]);
    await expect(
      callers.member.agencyHandovers.get({ organizationId: org, leadId: foreign.id })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
