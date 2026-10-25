/**
 * Sales targets and the forecast (#437) through the routers on a real PostgreSQL: who may set
 * targets and for whom, the fiscal year setting, the figures per owner by forecast category,
 * the targets against them, the open deals left before the period or without a close date, the
 * week's changes from the deal history, and organization isolation.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/diagnoleads_test \
 *     bunx vitest --run test/unit/integration/sales-forecast.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import {
  auditLogs,
  dealHistory,
  deals,
  leads,
  organizationMembers,
  organizations,
  salesTargets,
  users,
} from '@/lib/db/schema';
import { jstDate } from '@/lib/features/leads/types/pipeline';
import { appRouter } from '@/server/routers/_app';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/features/webhooks/services/lead-events', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  emitLeadEvents: vi.fn(),
}));
vi.mock('@/lib/features/lead-handoff/notify', () => ({
  notifyLeadHandoff: vi.fn().mockResolvedValue({ notified: 0 }),
}));

const url = process.env.TEST_DATABASE_URL;
const DAY_MS = 24 * 60 * 60 * 1000;

describe.skipIf(!url)('sales targets and forecast (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 4 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organizationIds: string[] = [];
  const userIds: string[] = [];
  const today = jstDate();
  const thisMonth = `${today.slice(0, 7)}-01`;
  let orgA: string;
  let orgB: string;
  let memberAId: string;
  let viewerAId: string;
  let adminBId: string;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
  let adminA: any;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
  let memberA: any;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
  let viewerA: any;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
  let adminB: any;

  async function createOrganization(name: string) {
    const [org] = await pg
      .insert(organizations)
      .values({ name, slug: `forecast-${unique()}` })
      .returning();
    organizationIds.push(org.id);
    return org.id;
  }

  async function callerFor(organizationId: string, role: string, name: string) {
    const [user] = await pg
      .insert(users)
      .values({ email: `forecast-${unique()}@example.com`, name })
      .returning();
    userIds.push(user.id);
    await pg.insert(organizationMembers).values({ organizationId, userId: user.id, role });
    const caller = appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId: user.id }, user },
      user,
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);
    return { caller, userId: user.id };
  }

  async function createLead(organizationId: string) {
    const [lead] = await pg
      .insert(leads)
      .values({ organizationId, email: `lead-${unique()}@example.co.jp`, company: '架空商事' })
      .returning();
    return lead.id;
  }

  beforeAll(async () => {
    orgA = await createOrganization('予測テストA');
    orgB = await createOrganization('予測テストB');
    ({ caller: adminA } = await callerFor(orgA, 'admin', '管理 一郎'));
    ({ caller: memberA, userId: memberAId } = await callerFor(orgA, 'member', '営業 花子'));
    ({ caller: viewerA, userId: viewerAId } = await callerFor(orgA, 'parent_viewer', '閲覧 三郎'));
    ({ caller: adminB, userId: adminBId } = await callerFor(orgB, 'admin', '別組織 四郎'));
  });

  afterAll(async () => {
    for (const id of organizationIds) {
      await pg.delete(organizations).where(eq(organizations.id, id));
    }
    for (const id of userIds) await pg.delete(users).where(eq(users.id, id));
    await client?.end();
  });

  describe('targets', () => {
    it('lets owners and admins set the organization and member targets, and members read theirs', async () => {
      await adminA.salesTargets.save({
        organizationId: orgA,
        entries: [
          { userId: null, month: thisMonth, amount: 20_000_000 },
          { userId: memberAId, month: thisMonth, amount: 8_000_000 },
        ],
      });
      const read = await memberA.salesTargets.get({ organizationId: orgA });
      expect(read.canEdit).toBe(false);
      expect(read.months).toHaveLength(12);
      expect(read.months).toContain(thisMonth);
      expect(read.targets).toEqual(
        expect.arrayContaining([
          { userId: null, month: thisMonth, amount: 20_000_000 },
          { userId: memberAId, month: thisMonth, amount: 8_000_000 },
        ])
      );
      // The member list is for those who set targets
      expect(read.members).toEqual([]);
      const managerRead = await adminA.salesTargets.get({ organizationId: orgA });
      expect(managerRead.canEdit).toBe(true);
      expect(managerRead.members.map((m: { displayName: string }) => m.displayName)).toContain(
        '営業 花子'
      );
    });

    it('replaces a target, removes one with null and keeps one row per month', async () => {
      await adminA.salesTargets.save({
        organizationId: orgA,
        entries: [{ userId: memberAId, month: thisMonth, amount: 9_000_000 }],
      });
      const rows = await pg
        .select()
        .from(salesTargets)
        .where(and(eq(salesTargets.organizationId, orgA), eq(salesTargets.userId, memberAId)));
      expect(rows.map((row) => row.amount)).toEqual([9_000_000]);

      const result = await adminA.salesTargets.save({
        organizationId: orgA,
        entries: [{ userId: memberAId, month: '2001-01-01', amount: null }],
      });
      expect(result).toEqual({ saved: 0, removed: 0 });
    });

    it('refuses members, other organizations and people who cannot hold leads', async () => {
      await expect(
        memberA.salesTargets.save({
          organizationId: orgA,
          entries: [{ userId: null, month: thisMonth, amount: 1 }],
        })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      for (const userId of [adminBId, viewerAId]) {
        await expect(
          adminA.salesTargets.save({
            organizationId: orgA,
            entries: [{ userId, month: thisMonth, amount: 1 }],
          })
        ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      }
      await expect(
        adminA.salesTargets.save({
          organizationId: orgA,
          entries: [{ userId: null, month: `${today.slice(0, 7)}-15`, amount: 1 }],
        })
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      const outside = await adminB.salesTargets.get({ organizationId: orgB });
      expect(outside.targets).toEqual([]);
    });

    it('refuses viewers, and admins of another organization', async () => {
      const entries = [{ userId: null, month: thisMonth, amount: 1 }];
      for (const call of [
        () => viewerA.salesTargets.save({ organizationId: orgA, entries }),
        () => viewerA.salesTargets.setFiscalYearStart({ organizationId: orgA, month: 1 }),
        () => adminB.salesTargets.save({ organizationId: orgA, entries }),
        () => adminB.salesTargets.setFiscalYearStart({ organizationId: orgA, month: 1 }),
        () => adminB.salesTargets.get({ organizationId: orgA }),
        // A parent organization's viewer may not read the deals, the forecast or the targets
        () => viewerA.salesTargets.get({ organizationId: orgA }),
        () => viewerA.salesForecast.get({ organizationId: orgA }),
      ]) {
        await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
      }
      const read = await adminA.salesTargets.get({ organizationId: orgA });
      expect(read.fiscalYearStartMonth).toBe(4);
      expect(read.targets).not.toContainEqual({ userId: null, month: thisMonth, amount: 1 });
    });

    it('refuses a month sent twice and a year out of range', async () => {
      for (const entries of [
        [
          { userId: null, month: thisMonth, amount: 1 },
          { userId: null, month: thisMonth, amount: 2 },
        ],
        [{ userId: null, month: '0000-01-01', amount: 1 }],
        [{ userId: null, month: '9999-12-01', amount: 1 }],
      ]) {
        await expect(
          adminA.salesTargets.save({ organizationId: orgA, entries })
        ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      }
    });

    it('lets the target of someone who left be removed, not set, and names them without email', async () => {
      const { userId: leftId } = await callerFor(orgA, 'member', '退職 次郎');
      await adminA.salesTargets.save({
        organizationId: orgA,
        entries: [{ userId: leftId, month: thisMonth, amount: 5_000_000 }],
      });
      await pg
        .delete(organizationMembers)
        .where(
          and(eq(organizationMembers.organizationId, orgA), eq(organizationMembers.userId, leftId))
        );

      const read = await adminA.salesTargets.get({ organizationId: orgA });
      expect(read.members.map((member: { userId: string }) => member.userId)).not.toContain(leftId);
      expect(read.formerMembers).toEqual([{ userId: leftId, displayName: '退職 次郎' }]);
      await expect(
        adminA.salesTargets.save({
          organizationId: orgA,
          entries: [{ userId: leftId, month: thisMonth, amount: 6_000_000 }],
        })
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(
        await adminA.salesTargets.save({
          organizationId: orgA,
          entries: [{ userId: leftId, month: thisMonth, amount: null }],
        })
      ).toEqual({ saved: 0, removed: 1 });
      expect((await adminA.salesTargets.get({ organizationId: orgA })).formerMembers).toEqual([]);
    });

    it("shows a member the organization's and their own targets only", async () => {
      const org = await createOrganization('目標の見え方');
      const { caller: manager } = await callerFor(org, 'owner', '目標 社長');
      const { caller: rep, userId: repId } = await callerFor(org, 'member', '目標 一郎');
      const { userId: otherId } = await callerFor(org, 'member', '目標 二郎');
      await manager.salesTargets.save({
        organizationId: org,
        entries: [
          { userId: null, month: thisMonth, amount: 20_000_000 },
          { userId: repId, month: thisMonth, amount: 5_000_000 },
          { userId: otherId, month: thisMonth, amount: 7_000_000 },
        ],
      });

      const targets = await rep.salesTargets.get({ organizationId: org });
      expect(targets.targets).toEqual(
        expect.arrayContaining([
          { userId: null, month: thisMonth, amount: 20_000_000 },
          { userId: repId, month: thisMonth, amount: 5_000_000 },
        ])
      );
      expect(targets.targets).toHaveLength(2);

      const forecast = await rep.salesForecast.get({ organizationId: org, period: 'thisMonth' });
      const rowOf = (id: string) =>
        forecast.owners.find((row: { ownerUserId: string }) => row.ownerUserId === id);
      expect(rowOf(repId)).toMatchObject({ target: 5_000_000, targetHidden: false });
      expect(rowOf(otherId)).toMatchObject({ target: null, gap: null, targetHidden: true });
      expect(forecast.total.target).toBe(20_000_000);

      const managed = await manager.salesForecast.get({ organizationId: org, period: 'thisMonth' });
      expect(
        managed.owners.find((row: { ownerUserId: string }) => row.ownerUserId === otherId)
      ).toMatchObject({ target: 7_000_000, targetHidden: false });
    });

    it('records each change of the targets and of the fiscal year start in the audit log', async () => {
      const org = await createOrganization('監査の記録');
      const { caller, userId: ownerId } = await callerFor(org, 'owner', '監査 一郎');
      const { userId: repId } = await callerFor(org, 'member', '監査 花子');
      const auditRows = (resource: string) =>
        pg
          .select()
          .from(auditLogs)
          .where(and(eq(auditLogs.organizationId, org), eq(auditLogs.resource, resource)));

      await caller.salesTargets.save({
        organizationId: org,
        entries: [
          { userId: null, month: thisMonth, amount: 10_000_000 },
          { userId: repId, month: thisMonth, amount: 4_000_000 },
        ],
      });
      // An entry equal to what is stored is left alone
      expect(
        await caller.salesTargets.save({
          organizationId: org,
          entries: [
            { userId: null, month: thisMonth, amount: 10_000_000 },
            { userId: repId, month: thisMonth, amount: 3_000_000 },
          ],
        })
      ).toEqual({ saved: 1, removed: 0 });
      await caller.salesTargets.save({
        organizationId: org,
        entries: [{ userId: repId, month: thisMonth, amount: 3_000_000 }],
      });

      const targetRows = await auditRows('sales_target');
      expect(targetRows).toHaveLength(2);
      expect(targetRows).toContainEqual(
        expect.objectContaining({
          userId: ownerId,
          action: 'update',
          resourceId: org,
          changes: {
            before: [{ userId: repId, month: thisMonth, amount: 4_000_000 }],
            after: [{ userId: repId, month: thisMonth, amount: 3_000_000 }],
          },
        })
      );

      await caller.salesTargets.setFiscalYearStart({ organizationId: org, month: 1 });
      await caller.salesTargets.setFiscalYearStart({ organizationId: org, month: 1 });
      const startRows = await auditRows('organization');
      expect(startRows).toHaveLength(1);
      expect(startRows[0]).toMatchObject({
        userId: ownerId,
        changes: { before: { fiscalYearStartMonth: 4 }, after: { fiscalYearStartMonth: 1 } },
      });
    });

    it('writes nothing when the fiscal year start sent is the one in effect', async () => {
      const org = await createOrganization('期の始まりの据え置き');
      const { caller } = await callerFor(org, 'owner', '据置 一郎');
      const longAgo = new Date('2020-01-01T00:00:00Z');
      const age = () =>
        pg.update(organizations).set({ updatedAt: longAgo }).where(eq(organizations.id, org));
      const read = async () =>
        (await pg.select().from(organizations).where(eq(organizations.id, org)))[0];

      // April is in effect without a setting: sending it stores nothing
      await age();
      await caller.salesTargets.setFiscalYearStart({ organizationId: org, month: 4 });
      const untouched = await read();
      expect(untouched.settings).toEqual({});
      expect(untouched.updatedAt).toEqual(longAgo);

      await caller.salesTargets.setFiscalYearStart({ organizationId: org, month: 1 });
      await age();
      await caller.salesTargets.setFiscalYearStart({ organizationId: org, month: 1 });
      const kept = await read();
      expect(kept.settings).toEqual({ salesForecast: { fiscalYearStartMonth: 1 } });
      expect(kept.updatedAt).toEqual(longAgo);

      // Only the change from April to January is audited
      const audit = await pg
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.organizationId, org), eq(auditLogs.resource, 'organization')));
      expect(audit.map((row) => row.changes)).toEqual([
        { before: { fiscalYearStartMonth: 4 }, after: { fiscalYearStartMonth: 1 } },
      ]);
    });

    it('moves the fiscal year to the month the owner sets', async () => {
      await expect(
        memberA.salesTargets.setFiscalYearStart({ organizationId: orgA, month: 1 })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      const org = await createOrganization('期の始まり');
      const { caller } = await callerFor(org, 'owner', '期 一郎');
      expect((await caller.salesTargets.get({ organizationId: org })).fiscalYearStartMonth).toBe(4);
      await caller.salesTargets.setFiscalYearStart({ organizationId: org, month: 1 });
      const read = await caller.salesTargets.get({ organizationId: org });
      expect(read.fiscalYearStartMonth).toBe(1);
      expect(read.months[0]).toBe(`${today.slice(0, 4)}-01-01`);
      // Other settings of the organization are kept
      const [row] = await pg.select().from(organizations).where(eq(organizations.id, org));
      expect(row.settings).toMatchObject({ salesForecast: { fiscalYearStartMonth: 1 } });
    });
  });

  describe('forecast', () => {
    let forecastOrg: string;
    // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
    let owner: any;
    // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
    let rep: any;
    let repId: string;

    beforeAll(async () => {
      forecastOrg = await createOrganization('予測の集計');
      ({ caller: owner } = await callerFor(forecastOrg, 'owner', '予測 社長'));
      ({ caller: rep, userId: repId } = await callerFor(forecastOrg, 'member', '予測 営業'));
      const leadId = await createLead(forecastOrg);
      const add = (values: Record<string, unknown>) =>
        rep.deals.create({ organizationId: forecastOrg, leadId, ...values });
      const won = await add({ name: '受注', stage: 'negotiation', amount: 2_000_000 });
      await rep.deals.update({ organizationId: forecastOrg, dealId: won.id, stage: 'won' });
      await add({ name: 'コミット', stage: 'negotiation', amount: 3_000_000, expectedCloseOn: today });
      await add({ name: 'ベスト', stage: 'proposal', amount: 1_000_000, expectedCloseOn: today });
      await add({ name: '見込み', stage: 'qualification', amount: 5_000_000, expectedCloseOn: today });
      await add({
        name: '除外',
        stage: 'negotiation',
        amount: 9_000_000,
        expectedCloseOn: today,
        forecastOverride: 'omitted',
      });
      await add({ name: '金額未定', stage: 'proposal', expectedCloseOn: today });
      await add({
        name: '強気',
        stage: 'qualification',
        amount: 700_000,
        expectedCloseOn: today,
        forecastOverride: 'commit',
      });
      await add({ name: '担当なし', stage: 'proposal', amount: 400_000, expectedCloseOn: today, ownerUserId: null });
      await add({ name: '去年のまま', stage: 'proposal', amount: 600_000, expectedCloseOn: '2020-01-31' });
      // The expected close date is optional: these are in no period
      await add({ name: '日付未定', stage: 'proposal', amount: 800_000 });
      await add({ name: '日付も金額も未定', stage: 'qualification' });
      await owner.salesTargets.save({
        organizationId: forecastOrg,
        entries: [{ userId: repId, month: thisMonth, amount: 10_000_000 }],
      });
    });

    it('sums each owner by forecast category against the targets', async () => {
      const forecast = await owner.salesForecast.get({ organizationId: forecastOrg, period: 'thisMonth' });
      expect(forecast.range.months).toEqual([thisMonth]);
      const repRow = forecast.owners.find((row: { ownerUserId: string }) => row.ownerUserId === repId);
      expect(repRow).toMatchObject({
        ownerName: '予測 営業',
        won: 2_000_000,
        commit: 3_700_000,
        bestCase: 1_000_000,
        pipeline: 5_000_000,
        // 3M x 70% + 1M x 40% + 5M x 10% + 0.7M x 10%; the omitted deal is left out
        weighted: 3_070_000,
        openCount: 6,
        noAmountCount: 1,
        target: 10_000_000,
        forecast: 5_700_000,
        achievement: 0.2,
        gap: 4_300_000,
      });
      const nobody = forecast.owners.at(-1);
      expect(nobody).toMatchObject({ ownerUserId: null, bestCase: 400_000, target: null });
      expect(forecast.total).toMatchObject({ won: 2_000_000, commit: 3_700_000, bestCase: 1_400_000 });
      // No organization-wide target: the members' targets are summed
      expect(forecast.total.target).toBe(10_000_000);
      expect(forecast.overdue).toEqual({ count: 1, amount: 600_000 });
      // Open deals without a close date are counted apart; the won one without a date is not
      expect(forecast.undated).toEqual({ count: 2, amount: 800_000 });
      expect(forecast.canEditTargets).toBe(true);
    });

    it('lets members read and keeps other organizations out', async () => {
      await adminB.deals.create({
        organizationId: orgB,
        leadId: await createLead(orgB),
        name: '別組織の日付未定',
        stage: 'proposal',
        amount: 300_000,
      });
      const mine = await rep.salesForecast.get({ organizationId: forecastOrg });
      expect(mine.canEditTargets).toBe(false);
      expect(mine.period).toBe('thisQuarter');
      // The deals outside the figures are the organization's, as the owner sees them
      expect(mine.overdue).toEqual({ count: 1, amount: 600_000 });
      expect(mine.undated).toEqual({ count: 2, amount: 800_000 });
      await expect(
        adminB.salesForecast.get({ organizationId: forecastOrg })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      const outside = await adminB.salesForecast.get({ organizationId: orgB, period: 'thisMonth' });
      expect(outside.owners).toEqual([]);
      expect(outside.total.won).toBe(0);
      expect(outside.undated).toEqual({ count: 1, amount: 300_000 });
    });

    it("compares the week's deals with how they stood a week ago", async () => {
      const leadId = await createLead(forecastOrg);
      const old = await rep.deals.create({
        organizationId: forecastOrg,
        leadId,
        name: '先週からの商談',
        stage: 'proposal',
        amount: 1_000_000,
        expectedCloseOn: today,
      });
      // As if it had been created eight days ago
      const eightDaysAgo = new Date(Date.now() - 8 * DAY_MS);
      await pg.update(dealHistory).set({ changedAt: eightDaysAgo }).where(eq(dealHistory.dealId, old.id));
      await pg.update(deals).set({ createdAt: eightDaysAgo }).where(eq(deals.id, old.id));
      await rep.deals.update({
        organizationId: forecastOrg,
        dealId: old.id,
        stage: 'negotiation',
        amount: 1_500_000,
        expectedCloseOn: '2099-12-31',
      });

      const forecast = await owner.salesForecast.get({ organizationId: forecastOrg, period: 'thisMonth' });
      const ids = (group: { deals: { id: string }[] }) => group.deals.map((deal) => deal.id);
      expect(ids(forecast.changes.groups.advanced)).toEqual([old.id]);
      expect(ids(forecast.changes.groups.slipped)).toEqual([old.id]);
      expect(ids(forecast.changes.groups.created)).not.toContain(old.id);
      // Everything else was created within the week
      expect(forecast.changes.groups.created.count).toBeGreaterThanOrEqual(9);
      expect(forecast.changes.groups.won.count).toBe(1);
      expect(forecast.changes.amountDelta).toBe(500_000);
    });
  });
});
