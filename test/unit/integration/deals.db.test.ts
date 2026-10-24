/**
 * Deals (#435) through the routers on a real PostgreSQL: defaults, the history and audit rows,
 * how a deal moves its lead forward (with the lead's audit row, webhooks and the handoff
 * notice), the board's totals and filters, permissions and organization isolation, and two deals
 * of one lead changed at the same time.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/diagnoleads_test \
 *     bunx vitest --run test/unit/integration/deals.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import {
  auditLogs,
  dealHistory,
  deals,
  leadTasks,
  leads,
  organizationMembers,
  organizations,
  users,
} from '@/lib/db/schema';
import { jstDate } from '@/lib/features/leads/types/pipeline';
import { appRouter } from '@/server/routers/_app';
import { and, asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));
const sent = vi.hoisted(() => ({ emitLeadEvents: vi.fn(), notifyLeadHandoff: vi.fn() }));
vi.mock('@/lib/features/webhooks/services/lead-events', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  emitLeadEvents: sent.emitLeadEvents,
}));
vi.mock('@/lib/features/lead-handoff/notify', () => ({
  notifyLeadHandoff: sent.notifyLeadHandoff.mockResolvedValue({ notified: 0 }),
}));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('deals (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 6 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organizationIds: string[] = [];
  const userIds: string[] = [];
  let orgA: string;
  let orgB: string;
  let adminAId: string;
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
      .values({ name, slug: `deals-${unique()}` })
      .returning();
    organizationIds.push(org.id);
    return org.id;
  }

  async function callerFor(organizationId: string, role: string, name: string) {
    const [user] = await pg
      .insert(users)
      .values({ email: `deals-${unique()}@example.com`, name })
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

  async function createLead(
    organizationId: string,
    values: Partial<typeof leads.$inferInsert> = {}
  ) {
    const [lead] = await pg
      .insert(leads)
      .values({
        organizationId,
        email: `lead-${unique()}@example.co.jp`,
        name: '山田 花子',
        company: '架空商事',
        ...values,
      })
      .returning();
    return lead;
  }

  const leadOf = async (id: string) => {
    const [lead] = await pg.select().from(leads).where(eq(leads.id, id));
    return lead;
  };
  const historyOf = (dealId: string) =>
    pg
      .select()
      .from(dealHistory)
      .where(eq(dealHistory.dealId, dealId))
      .orderBy(asc(dealHistory.changedAt), asc(dealHistory.id));
  const auditOf = (resource: string, resourceId: string) =>
    pg
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.resource, resource), eq(auditLogs.resourceId, resourceId)))
      .orderBy(asc(auditLogs.createdAt));

  beforeAll(async () => {
    orgA = await createOrganization('商談テストA');
    orgB = await createOrganization('商談テストB');
    ({ caller: adminA, userId: adminAId } = await callerFor(orgA, 'admin', '管理 一郎'));
    ({ caller: memberA, userId: memberAId } = await callerFor(orgA, 'member', '営業 花子'));
    ({ caller: viewerA, userId: viewerAId } = await callerFor(orgA, 'parent_viewer', '閲覧 三郎'));
    ({ caller: adminB, userId: adminBId } = await callerFor(orgB, 'admin', '別組織 四郎'));
  });

  beforeEach(() => {
    sent.emitLeadEvents.mockClear();
    sent.notifyLeadHandoff.mockClear();
  });

  afterAll(async () => {
    for (const id of organizationIds) {
      await pg.delete(organizations).where(eq(organizations.id, id));
    }
    for (const id of userIds) await pg.delete(users).where(eq(users.id, id));
    await client?.end();
  });

  describe('create', () => {
    it('starts a survey at the first stage, owned by the lead assignee, and records it', async () => {
      const lead = await createLead(orgA, { assigneeUserId: memberAId, targetSystem: 'as400' });
      const deal = await adminA.deals.create({
        organizationId: orgA,
        leadId: lead.id,
        name: 'AS/400 現行調査',
        amount: 3_000_000,
      });
      expect(deal).toMatchObject({
        kind: 'survey',
        stage: 'qualification',
        probability: 10,
        amount: 3_000_000,
        weightedAmount: 300_000,
        forecastCategory: 'pipeline',
        ownerUserId: memberAId,
        ownerName: '営業 花子',
        targetSystem: 'as400',
        closedOn: null,
      });

      const history = await historyOf(deal.id);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        stage: 'qualification',
        amount: 3_000_000,
        probability: 10,
        changedFields: ['created'],
        changedBy: adminAId,
      });
      const [audit] = await auditOf('deal', deal.id);
      expect(audit).toMatchObject({ action: 'create', userId: adminAId });
      expect(audit.metadata).toEqual({ leadId: lead.id });
    });

    it('moves the lead forward with its own audit row and webhooks', async () => {
      const lead = await createLead(orgA);
      const deal = await memberA.deals.create({
        organizationId: orgA,
        leadId: lead.id,
        name: 'Access 移行',
        kind: 'migration',
        stage: 'proposal',
      });
      expect(deal.probability).toBe(40);
      // The creator owns it when the lead has no assignee
      expect(deal.ownerUserId).toBe(memberAId);

      const after = await leadOf(lead.id);
      expect(after).toMatchObject({
        status: 'negotiating',
        dealPhase: 'proposal',
        hasNegotiated: true,
      });
      expect(after.dealPhaseReachedAt).toEqual({ proposal: jstDate() });

      const [leadAudit] = await auditOf('lead', lead.id);
      expect(leadAudit.changes).toEqual({
        before: { status: 'new', dealPhase: null },
        after: { status: 'negotiating', dealPhase: 'proposal' },
      });
      expect(leadAudit.metadata).toEqual({ dealId: deal.id });

      expect(sent.emitLeadEvents).toHaveBeenCalledTimes(1);
      const [organizationId, events] = sent.emitLeadEvents.mock.calls[0];
      expect(organizationId).toBe(orgA);
      expect(events.map((event: { type: string }) => event.type).sort()).toEqual([
        'lead.status_changed',
        'lead.updated',
      ]);
      // Past the initial hearing for the first time: the handoff sheet goes out (#86)
      expect(sent.notifyLeadHandoff).toHaveBeenCalledTimes(1);
    });

    it('rejects a lost deal without a reason and owners who cannot hold leads', async () => {
      const lead = await createLead(orgA);
      const base = { organizationId: orgA, leadId: lead.id, name: '調査' };
      await expect(adminA.deals.create({ ...base, stage: 'lost' })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
      await expect(adminA.deals.create({ ...base, ownerUserId: adminBId })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
      await expect(
        adminA.deals.create({ ...base, ownerUserId: viewerAId })
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(await pg.select().from(deals).where(eq(deals.leadId, lead.id))).toHaveLength(0);
    });

    it('keeps other organizations and read-only viewers out', async () => {
      const lead = await createLead(orgA);
      await expect(
        adminB.deals.create({ organizationId: orgB, leadId: lead.id, name: '調査' })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        viewerA.deals.create({ organizationId: orgA, leadId: lead.id, name: '調査' })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  describe('update', () => {
    it('resets the probability on a stage change and records the history', async () => {
      const lead = await createLead(orgA);
      const created = await adminA.deals.create({
        organizationId: orgA,
        leadId: lead.id,
        name: '調査',
        amount: 2_000_000,
      });
      const moved = await adminA.deals.update({
        organizationId: orgA,
        dealId: created.id,
        stage: 'negotiation',
      });
      expect(moved).toMatchObject({ stage: 'negotiation', probability: 70 });
      expect(moved.forecastCategory).toBe('commit');
      expect(moved.stageChangedAt.getTime()).toBeGreaterThanOrEqual(
        created.stageChangedAt.getTime()
      );

      const tuned = await adminA.deals.update({
        organizationId: orgA,
        dealId: created.id,
        probability: 55,
        nextStep: '見積を送る',
      });
      expect(tuned).toMatchObject({ probability: 55, forecastCategory: 'best_case' });

      // The next step alone is not a forecast value: no history row, but an audit row
      await adminA.deals.update({ organizationId: orgA, dealId: created.id, nextStep: '電話' });
      const history = await historyOf(created.id);
      expect(history.map((row) => row.changedFields)).toEqual([
        ['created'],
        ['stage', 'probability'],
        ['probability'],
      ]);
      const audits = await auditOf('deal', created.id);
      expect(audits.map((row) => row.action)).toEqual(['create', 'update', 'update', 'update']);
      // Free text is recorded as changed, never as text (it may name people)
      expect(audits[2].changes).toEqual({ before: { probability: 70 }, after: { probability: 55 } });
      expect(audits[2].metadata).toEqual({ leadId: lead.id, changedText: ['nextStep'] });
      expect(audits[3].changes).toEqual({ before: {}, after: {} });
      expect(JSON.stringify(audits)).not.toContain('見積を送る');
    });

    it('closes won deals on today and reopens them without the close day', async () => {
      const lead = await createLead(orgA);
      const deal = await adminA.deals.create({ organizationId: orgA, leadId: lead.id, name: '調査' });
      const won = await adminA.deals.update({ organizationId: orgA, dealId: deal.id, stage: 'won' });
      expect(won).toMatchObject({ stage: 'won', probability: 100, closedOn: jstDate() });
      expect(won.forecastCategory).toBe('closed');
      expect(await leadOf(lead.id)).toMatchObject({ status: 'won', dealPhase: 'survey_won' });

      const reopened = await adminA.deals.update({
        organizationId: orgA,
        dealId: deal.id,
        stage: 'proposal',
      });
      expect(reopened).toMatchObject({ stage: 'proposal', closedOn: null, probability: 40 });
      // The lead never moves back
      expect(await leadOf(lead.id)).toMatchObject({ status: 'won', dealPhase: 'survey_won' });
    });

    it('needs a lost reason, gives it to the lead, and clears it on reopening', async () => {
      const lead = await createLead(orgA);
      const deal = await adminA.deals.create({ organizationId: orgA, leadId: lead.id, name: '調査' });
      await expect(
        adminA.deals.update({ organizationId: orgA, dealId: deal.id, stage: 'lost' })
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

      const lost = await adminA.deals.update({
        organizationId: orgA,
        dealId: deal.id,
        stage: 'lost',
        lostReason: 'competitor',
        lostNote: '他社が安かった',
        competitor: '架空システムズ',
      });
      expect(lost).toMatchObject({ stage: 'lost', lostReason: 'competitor', closedOn: jstDate() });
      expect(await leadOf(lead.id)).toMatchObject({ status: 'lost', lostReason: 'competitor' });
      const [, lostAudit] = await auditOf('deal', deal.id);
      expect(lostAudit.metadata).toEqual({ leadId: lead.id, changedText: ['lostNote'] });
      expect(JSON.stringify(lostAudit.changes)).not.toContain('他社が安かった');

      const reopened = await adminA.deals.update({
        organizationId: orgA,
        dealId: deal.id,
        stage: 'discovery',
      });
      expect(reopened).toMatchObject({
        lostReason: null,
        lostNote: null,
        competitor: '架空システムズ',
      });
      expect(await leadOf(lead.id)).toMatchObject({
        status: 'negotiating',
        dealPhase: 'simple_diagnosis',
      });
    });

    it('keeps a lead won when its other deal is lost', async () => {
      const lead = await createLead(orgA);
      const survey = await adminA.deals.create({
        organizationId: orgA,
        leadId: lead.id,
        name: '調査',
        stage: 'won',
      });
      const migration = await adminA.deals.create({
        organizationId: orgA,
        leadId: lead.id,
        name: '移行',
        kind: 'migration',
        previousDealId: survey.id,
      });
      await adminA.deals.update({
        organizationId: orgA,
        dealId: migration.id,
        stage: 'lost',
        lostReason: 'budget',
      });
      expect(await leadOf(lead.id)).toMatchObject({ status: 'won', dealPhase: 'survey_won' });

      const detail = await adminA.deals.get({ organizationId: orgA, dealId: survey.id });
      expect(detail.nextDeals).toEqual([
        { id: migration.id, name: '移行', kind: 'migration', stage: 'lost' },
      ]);
    });

    it('rejects a deal following itself or a deal of another organization', async () => {
      const lead = await createLead(orgA);
      const deal = await adminA.deals.create({ organizationId: orgA, leadId: lead.id, name: '調査' });
      await expect(
        adminA.deals.update({ organizationId: orgA, dealId: deal.id, previousDealId: deal.id })
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

      const leadB = await createLead(orgB);
      const dealB = await adminB.deals.create({ organizationId: orgB, leadId: leadB.id, name: '調査' });
      await expect(
        adminA.deals.update({ organizationId: orgA, dealId: deal.id, previousDealId: dealB.id })
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(
        adminB.deals.update({ organizationId: orgB, dealId: deal.id, stage: 'won' })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        viewerA.deals.update({ organizationId: orgA, dealId: deal.id, stage: 'won' })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('links two deals to each other at the same time', async () => {
      const [leadA, leadB] = [await createLead(orgA), await createLead(orgA)];
      const a = await adminA.deals.create({ organizationId: orgA, leadId: leadA.id, name: 'A' });
      const b = await adminA.deals.create({ organizationId: orgA, leadId: leadB.id, name: 'B' });
      await Promise.all([
        adminA.deals.update({ organizationId: orgA, dealId: a.id, previousDealId: b.id }),
        memberA.deals.update({ organizationId: orgA, dealId: b.id, previousDealId: a.id }),
      ]);
      const rows = await pg.select().from(deals).where(eq(deals.organizationId, orgA));
      expect(rows.find((row) => row.id === a.id)?.previousDealId).toBe(b.id);
      expect(rows.find((row) => row.id === b.id)?.previousDealId).toBe(a.id);
    });

    it('moves the lead right when two of its deals change at the same time', async () => {
      const lead = await createLead(orgA);
      const first = await adminA.deals.create({ organizationId: orgA, leadId: lead.id, name: '調査' });
      const second = await adminA.deals.create({
        organizationId: orgA,
        leadId: lead.id,
        name: '移行',
        kind: 'migration',
      });
      await Promise.all([
        adminA.deals.update({
          organizationId: orgA,
          dealId: first.id,
          stage: 'lost',
          lostReason: 'timing',
        }),
        memberA.deals.update({
          organizationId: orgA,
          dealId: second.id,
          stage: 'lost',
          lostReason: 'budget',
        }),
      ]);
      const after = await leadOf(lead.id);
      expect(after.status).toBe('lost');
      expect(['timing', 'budget']).toContain(after.lostReason);
    });
  });

  describe('board', () => {
    let boardOrg: string;
    // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
    let owner: any;
    let ownerId: string;
    // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
    let other: any;
    let otherId: string;

    beforeAll(async () => {
      boardOrg = await createOrganization('商談ボード');
      ({ caller: owner, userId: ownerId } = await callerFor(boardOrg, 'admin', 'ボード 一郎'));
      ({ caller: other, userId: otherId } = await callerFor(boardOrg, 'member', 'ボード 二郎'));
      const lead = await createLead(boardOrg, { company: '架空製作所' });
      const leadWithTask = await createLead(boardOrg, { company: '架空工業' });
      await pg.insert(leadTasks).values({
        organizationId: boardOrg,
        leadId: leadWithTask.id,
        title: '見積の確認',
        dueOn: jstDate(),
      });
      const add = (
        values: Record<string, unknown>,
        // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
        caller: any = owner,
        leadId = lead.id
      ) => caller.deals.create({ organizationId: boardOrg, leadId, ...values });
      await add({ name: 'A', stage: 'proposal', amount: 1_000_000, expectedCloseOn: '2026-11-10' });
      await add({ name: 'B', stage: 'proposal', amount: 3_000_000, expectedCloseOn: '2026-12-20' });
      await add(
        { name: 'C', stage: 'negotiation', amount: 5_000_000, kind: 'migration' },
        other,
        leadWithTask.id
      );
      await add({ name: 'D', stage: 'won', amount: 2_000_000 });
      await add({ name: 'E', stage: 'qualification' });
    });

    const names = (board: { columns: { stage: string; deals: { name: string }[] }[] }) =>
      Object.fromEntries(board.columns.map((c) => [c.stage, c.deals.map((d) => d.name)]));

    it('totals each stage and lists its deals', async () => {
      const board = await owner.deals.board({ organizationId: boardOrg });
      expect(names(board)).toEqual({
        qualification: ['E'],
        discovery: [],
        proposal: ['A', 'B'],
        negotiation: ['C'],
        won: ['D'],
        lost: [],
      });
      const proposal = board.columns.find((c: { stage: string }) => c.stage === 'proposal');
      expect(proposal).toMatchObject({ count: 2, amount: 4_000_000, weightedAmount: 1_600_000 });
      const negotiation = board.columns.find((c: { stage: string }) => c.stage === 'negotiation');
      expect(negotiation).toMatchObject({ count: 1, amount: 5_000_000, weightedAmount: 3_500_000 });
      expect(negotiation.deals[0]).toMatchObject({ company: '架空工業', hasOpenTask: true });
      expect(proposal.deals[0]).toMatchObject({ company: '架空製作所', hasOpenTask: false });
      expect(board).toMatchObject({ truncated: false, canEdit: true, canDelete: true });
    });

    it('filters by owner, kind and close period', async () => {
      const mine = await other.deals.board({ organizationId: boardOrg, owner: 'mine' });
      expect(names(mine).negotiation).toEqual(['C']);
      expect(names(mine).proposal).toEqual([]);
      const byMember = await owner.deals.board({ organizationId: boardOrg, owner: otherId });
      expect(names(byMember)).toEqual(names(mine));
      const migrations = await owner.deals.board({ organizationId: boardOrg, kinds: ['migration'] });
      expect(names(migrations).negotiation).toEqual(['C']);
      expect(names(migrations).won).toEqual([]);

      // A period leaves out open deals without a close date
      const november = await owner.deals.board({
        organizationId: boardOrg,
        closeFrom: '2026-11-01',
        closeTo: '2026-11-30',
      });
      expect(names(november)).toMatchObject({ qualification: [], proposal: ['A'], negotiation: [] });
      expect(november.columns.find((c: { stage: string }) => c.stage === 'proposal').count).toBe(1);
      expect(ownerId).toBeTruthy();
    });

    it('drops closed deals after the chosen number of days and keeps other organizations out', async () => {
      await pg
        .update(deals)
        .set({ closedOn: '2026-01-01' })
        .where(and(eq(deals.organizationId, boardOrg), eq(deals.name, 'D')));
      const board = await owner.deals.board({ organizationId: boardOrg });
      expect(names(board).won).toEqual([]);
      expect(board.columns.find((c: { stage: string }) => c.stage === 'won').count).toBe(0);

      const outside = await adminB.deals.board({ organizationId: orgB });
      const outsideNames = outside.columns.flatMap((c: { deals: { name: string }[] }) =>
        c.deals.map((d) => d.name)
      );
      expect(outsideNames).not.toContain('A');
      await expect(adminB.deals.board({ organizationId: boardOrg })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('lets read-only viewers read but not change', async () => {
      const board = await viewerA.deals.board({ organizationId: orgA });
      expect(board).toMatchObject({ canEdit: false, canDelete: false });
      const memberBoard = await memberA.deals.board({ organizationId: orgA });
      expect(memberBoard).toMatchObject({ canEdit: true, canDelete: false });
    });
  });

  describe('forLead, get and delete', () => {
    it('lists the deals of a lead oldest first and hides other organizations', async () => {
      const lead = await createLead(orgA);
      const first = await adminA.deals.create({ organizationId: orgA, leadId: lead.id, name: '一' });
      const second = await adminA.deals.create({ organizationId: orgA, leadId: lead.id, name: '二' });
      const listed = await viewerA.deals.forLead({ organizationId: orgA, leadId: lead.id });
      expect(listed.items.map((d: { id: string }) => d.id)).toEqual([first.id, second.id]);
      expect(listed.canEdit).toBe(false);
      await expect(
        adminB.deals.forLead({ organizationId: orgB, leadId: lead.id })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        adminB.deals.get({ organizationId: orgB, dealId: first.id })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('returns the history newest first with who changed it', async () => {
      const lead = await createLead(orgA);
      const deal = await adminA.deals.create({ organizationId: orgA, leadId: lead.id, name: '調査' });
      await memberA.deals.update({ organizationId: orgA, dealId: deal.id, amount: 1_500_000 });
      const detail = await viewerA.deals.get({ organizationId: orgA, dealId: deal.id });
      expect(detail.lead).toMatchObject({ id: lead.id, company: '架空商事' });
      expect(detail.history.map((h: { changedFields: string[] }) => h.changedFields)).toEqual([
        ['amount'],
        ['created'],
      ]);
      expect(detail.history[0]).toMatchObject({ amount: 1_500_000, changedByName: '営業 花子' });
    });

    it('lets owners and admins delete, records it and leaves the lead as it is', async () => {
      const lead = await createLead(orgA);
      const deal = await adminA.deals.create({
        organizationId: orgA,
        leadId: lead.id,
        name: '調査',
        stage: 'won',
        amount: 900_000,
      });
      const before = await leadOf(lead.id);
      await expect(
        memberA.deals.delete({ organizationId: orgA, dealId: deal.id })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        adminB.deals.delete({ organizationId: orgB, dealId: deal.id })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      await adminA.deals.delete({ organizationId: orgA, dealId: deal.id });
      expect(await pg.select().from(deals).where(eq(deals.id, deal.id))).toHaveLength(0);
      expect(await historyOf(deal.id)).toHaveLength(0);
      const audits = await auditOf('deal', deal.id);
      expect(audits.at(-1)).toMatchObject({ action: 'delete' });
      expect(audits.at(-1)?.changes).toEqual({
        before: { name: '調査', kind: 'survey', stage: 'won', amount: 900_000 },
      });
      const after = await leadOf(lead.id);
      expect(after.status).toBe(before.status);
      expect(after.dealPhase).toBe(before.dealPhase);
    });
  });
});
