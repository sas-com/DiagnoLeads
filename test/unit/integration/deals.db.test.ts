/**
 * Deals (#435) through the routers on a real PostgreSQL: defaults, the history and audit rows,
 * how deals set their lead's status and deal phase (with the lead's audit row, webhooks and the
 * handoff notice, and whether a change handed the lead off, #720), computed again on every change
 * and deletion, and refused by hand (#444), the board's totals and filters, the lead's next
 * action on the board and the next step no longer written (#853), permissions and organization
 * isolation, and two deals of one lead changed at the same time.
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
import type { DealCard } from '@/lib/features/deals/service';
import { handedOffOn } from '@/lib/features/lead-handoff/handoff';
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

// REST API v2 reads the module's db and its own auth (#444): the test's database and organization
const v2 = vi.hoisted(() => ({
  db: null as unknown,
  auth: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  get db() {
    return v2.db;
  },
}));
vi.mock('@/lib/api/v2-auth', () => ({ getAuthenticatedOrganization: v2.auth }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('deals (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 6 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  v2.db = pg;
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

  async function callerFor(organizationId: string, role: schema.OrganizationRole, name: string) {
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
      });
      expect(tuned).toMatchObject({ probability: 55, forecastCategory: 'best_case' });

      // The competitor alone is not a forecast value: no history row, but an audit row
      await adminA.deals.update({
        organizationId: orgA,
        dealId: created.id,
        competitor: '架空システムズ',
      });
      const history = await historyOf(created.id);
      expect(history.map((row) => row.changedFields)).toEqual([
        ['created'],
        ['stage', 'probability'],
        ['probability'],
      ]);
      const audits = await auditOf('deal', created.id);
      expect(audits.map((row) => row.action)).toEqual(['create', 'update', 'update', 'update']);
      expect(audits[2].changes).toEqual({ before: { probability: 70 }, after: { probability: 55 } });
      expect(audits[2].metadata).toEqual({ leadId: lead.id });
      expect(audits[3].changes).toEqual({
        before: { competitor: null },
        after: { competitor: '架空システムズ' },
      });
    });

    it('records the details of a loss as changed, never as text (they may name people)', async () => {
      const lead = await createLead(orgA);
      const created = await adminA.deals.create({ organizationId: orgA, leadId: lead.id, name: '調査' });
      await adminA.deals.update({
        organizationId: orgA,
        dealId: created.id,
        stage: 'lost',
        lostReason: 'budget',
        lostNote: '山田様の稟議が通らなかった',
      });
      // The details alone: no history row, but an audit row saying only that they changed
      await adminA.deals.update({ organizationId: orgA, dealId: created.id, lostNote: '来期に再提案' });
      expect((await historyOf(created.id)).map((row) => row.changedFields)).toEqual([
        ['created'],
        ['stage', 'probability'],
      ]);
      const audits = await auditOf('deal', created.id);
      expect(audits.map((row) => row.action)).toEqual(['create', 'update', 'update']);
      expect(audits[1].metadata).toEqual({ leadId: lead.id, changedText: ['lostNote'] });
      expect(audits[2].changes).toEqual({ before: {}, after: {} });
      expect(audits[2].metadata).toEqual({ leadId: lead.id, changedText: ['lostNote'] });
      expect(JSON.stringify(audits)).not.toContain('山田様');
      expect(JSON.stringify(audits)).not.toContain('来期');
    });

    it('takes a next step sent but never writes it, and keeps one written before (#853)', async () => {
      const rowOf = async (id: string) => (await pg.select().from(deals).where(eq(deals.id, id)))[0];
      const lead = await createLead(orgA);
      // A screen opened before the change sends one with each new deal: not refused
      const created = await adminA.deals.create({
        organizationId: orgA,
        leadId: lead.id,
        name: '調査',
        nextStep: '見積を送る',
      });
      expect(created.nextStep).toBeNull();
      expect((await rowOf(created.id)).nextStep).toBeNull();
      const old = await memberA.deals.create({
        organizationId: orgA,
        leadId: lead.id,
        name: '移行',
        nextStep: null,
      });
      expect((await rowOf(old.id)).nextStep).toBeNull();

      // One written before #853 is neither overwritten nor cleared by a change
      await pg.update(deals).set({ nextStep: '稟議を待つ' }).where(eq(deals.id, created.id));
      const changed = await adminA.deals.update({
        organizationId: orgA,
        dealId: created.id,
        amount: 1_000_000,
        nextStep: '電話',
      });
      expect(changed).toMatchObject({ amount: 1_000_000, nextStep: '稟議を待つ' });
      const cleared = await memberA.deals.update({
        organizationId: orgA,
        dealId: created.id,
        nextStep: null,
      });
      expect(cleared.nextStep).toBe('稟議を待つ');
      expect((await rowOf(created.id)).nextStep).toBe('稟議を待つ');
      // The deal page still reads it, as a note
      const detail = await adminA.deals.get({ organizationId: orgA, dealId: created.id });
      expect(detail.nextStep).toBe('稟議を待つ');

      // The audit has the amount alone: no changed text, no row for the next step alone
      const audits = await auditOf('deal', created.id);
      expect(audits.map((row) => row.action)).toEqual(['create', 'update']);
      expect(audits[1].changes).toEqual({ before: { amount: null }, after: { amount: 1_000_000 } });
      expect(audits[1].metadata).toEqual({ leadId: lead.id });
      expect(JSON.stringify(audits)).not.toMatch(/見積を送る|電話/);
    });

    it('answers whether it handed the lead off: only the first time it leaves the initial hearing (#720)', async () => {
      const lead = await createLead(orgA);
      const deal = await adminA.deals.create({ organizationId: orgA, leadId: lead.id, name: '調査' });
      expect(sent.notifyLeadHandoff).not.toHaveBeenCalled();

      const first = await memberA.deals.update({
        organizationId: orgA,
        dealId: deal.id,
        stage: 'discovery',
      });
      // The screens offer no undo then: moving back takes back neither the sheet nor the day
      expect(first).toMatchObject({ stage: 'discovery', probability: 20, handedOff: true });
      expect(sent.notifyLeadHandoff).toHaveBeenCalledTimes(1);
      expect(handedOffOn((await leadOf(lead.id)).dealPhaseReachedAt)).toBe(jstDate());

      const back = await memberA.deals.update({
        organizationId: orgA,
        dealId: deal.id,
        stage: 'qualification',
      });
      expect(back.handedOff).toBe(false);
      expect(await leadOf(lead.id)).toMatchObject({ dealPhase: 'initial_hearing' });
      const again = await memberA.deals.update({
        organizationId: orgA,
        dealId: deal.id,
        stage: 'discovery',
      });
      expect(again.handedOff).toBe(false);
      // A change that leaves the lead as it is
      const tuned = await memberA.deals.update({
        organizationId: orgA,
        dealId: deal.id,
        competitor: '架空システムズ',
      });
      expect(tuned.handedOff).toBe(false);
      expect(sent.notifyLeadHandoff).toHaveBeenCalledTimes(1);
    });

    it('records the SQL decision sent with the move, and warns of a move out of 見極め without one (#801)', async () => {
      const lead = await createLead(orgA);
      const deal = await adminA.deals.create({ organizationId: orgA, leadId: lead.id, name: '調査' });

      // Let through without a decision (imports and integrations go on), with a warning
      const skipped = await memberA.deals.update({
        organizationId: orgA,
        dealId: deal.id,
        stage: 'discovery',
      });
      expect(skipped).toMatchObject({ stage: 'discovery', sqlUndecided: true });
      expect((await leadOf(lead.id)).sqlDecision).toBeNull();
      // Not warned again for a move between the later stages
      const later = await memberA.deals.update({
        organizationId: orgA,
        dealId: deal.id,
        stage: 'proposal',
      });
      expect(later.sqlUndecided).toBe(false);

      await memberA.deals.update({ organizationId: orgA, dealId: deal.id, stage: 'qualification' });
      sent.emitLeadEvents.mockClear();
      const decided = await memberA.deals.update({
        organizationId: orgA,
        dealId: deal.id,
        stage: 'discovery',
        sqlDecision: 'qualified',
      });
      expect(decided.sqlUndecided).toBe(false);
      const after = await leadOf(lead.id);
      expect(after).toMatchObject({ sqlDecision: 'qualified' });
      expect(after.sqlDecidedAt).toBeInstanceOf(Date);
      const leadAudits = await auditOf('lead', lead.id);
      expect(leadAudits.at(-1)).toMatchObject({
        userId: memberAId,
        changes: { before: { sqlDecision: null }, after: { sqlDecision: 'qualified' } },
        metadata: { dealId: deal.id },
      });
      expect(sent.emitLeadEvents).toHaveBeenCalledTimes(1);

      // A decision the lead has is not rewritten: the same one, or another one sent from a board
      // read before it was made (it is changed on the lead's page)
      const decidedAt = after.sqlDecidedAt;
      await memberA.deals.update({ organizationId: orgA, dealId: deal.id, sqlDecision: 'qualified' });
      await memberA.deals.update({
        organizationId: orgA,
        dealId: deal.id,
        sqlDecision: 'not_qualified',
      });
      expect(await leadOf(lead.id)).toMatchObject({ sqlDecision: 'qualified', sqlDecidedAt: decidedAt });
    });

    it('warns of a win out of 見極め without a decision, not of a reopening, and records one without a move (#801)', async () => {
      const lead = await createLead(orgA);
      const deal = await adminA.deals.create({ organizationId: orgA, leadId: lead.id, name: '調査' });
      const won = await memberA.deals.update({ organizationId: orgA, dealId: deal.id, stage: 'won' });
      expect(won.sqlUndecided).toBe(true);

      await memberA.deals.update({
        organizationId: orgA,
        dealId: deal.id,
        stage: 'lost',
        lostReason: 'timing',
      });
      const reopened = await memberA.deals.update({
        organizationId: orgA,
        dealId: deal.id,
        stage: 'discovery',
      });
      expect(reopened.sqlUndecided).toBe(false);

      const recorded = await memberA.deals.update({
        organizationId: orgA,
        dealId: deal.id,
        sqlDecision: 'qualified',
      });
      expect(recorded).toMatchObject({ stage: 'discovery', sqlUndecided: false });
      expect((await leadOf(lead.id)).sqlDecision).toBe('qualified');
    });

    it('records 不適格 with the loss out of 見極め (#801)', async () => {
      const lead = await createLead(orgA);
      const deal = await adminA.deals.create({ organizationId: orgA, leadId: lead.id, name: '調査' });
      const lost = await memberA.deals.update({
        organizationId: orgA,
        dealId: deal.id,
        stage: 'lost',
        lostReason: 'no_need',
        sqlDecision: 'not_qualified',
      });
      expect(lost.sqlUndecided).toBe(false);
      expect(await leadOf(lead.id)).toMatchObject({
        sqlDecision: 'not_qualified',
        status: 'lost',
        lostReason: 'no_need',
      });
      await expect(
        adminB.deals.update({ organizationId: orgB, dealId: deal.id, sqlDecision: 'qualified' })
      ).rejects.toThrow();
      expect((await leadOf(lead.id)).sqlDecision).toBe('not_qualified');
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
      // The lead follows its deal back (#444)
      expect(await leadOf(lead.id)).toMatchObject({ status: 'negotiating', dealPhase: 'proposal' });
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

  // A lead with deals takes its status and deal phase from them, both ways (#444)
  describe('lead set from its deals', () => {
    it('moves the lead back when its won deal is reopened or deleted', async () => {
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
        stage: 'proposal',
        previousDealId: survey.id,
      });
      expect(await leadOf(lead.id)).toMatchObject({ status: 'won', dealPhase: 'survey_won' });

      await adminA.deals.update({ organizationId: orgA, dealId: survey.id, stage: 'negotiation' });
      expect(await leadOf(lead.id)).toMatchObject({ status: 'negotiating', dealPhase: 'proposal' });

      await adminA.deals.update({ organizationId: orgA, dealId: survey.id, stage: 'won' });
      sent.emitLeadEvents.mockClear();
      await adminA.deals.delete({ organizationId: orgA, dealId: survey.id });
      const after = await leadOf(lead.id);
      expect(after).toMatchObject({ status: 'negotiating', dealPhase: 'proposal' });
      // The first day of each phase stays
      expect(after.dealPhaseReachedAt).toHaveProperty('survey_won');
      // The lead's own audit row and webhooks, as for a change
      const leadAudit = await auditOf('lead', lead.id);
      expect(leadAudit.at(-1)?.metadata).toMatchObject({ dealId: survey.id });
      expect(sent.emitLeadEvents).toHaveBeenCalled();
      expect(migration.id).toBeTruthy();
    });

    it('refuses to change the status or phase of a lead with deals by hand', async () => {
      const lead = await createLead(orgA);
      await adminA.deals.create({ organizationId: orgA, leadId: lead.id, name: '調査' });
      const before = await leadOf(lead.id);
      expect(before).toMatchObject({ status: 'negotiating', dealPhase: 'initial_hearing' });

      await expect(
        memberA.leads.update({ organizationId: orgA, id: lead.id, status: 'won' })
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(
        memberA.leads.update({ organizationId: orgA, id: lead.id, dealPhase: 'proposal' })
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(await leadOf(lead.id)).toMatchObject({
        status: 'negotiating',
        dealPhase: 'initial_hearing',
      });

      // The other fields, and the values it already has, still save
      await memberA.leads.update({
        organizationId: orgA,
        id: lead.id,
        company: '架空商事（新社名）',
        status: 'negotiating',
        dealPhase: 'initial_hearing',
      });
      expect((await leadOf(lead.id)).company).toBe('架空商事（新社名）');

      // The lead page and the list say the lead has deals
      expect(await memberA.leads.get({ organizationId: orgA, id: lead.id })).toMatchObject({
        hasDeals: true,
      });
    });

    it('changes the status in bulk only of the leads without deals', async () => {
      const withDeal = await createLead(orgA);
      await adminA.deals.create({ organizationId: orgA, leadId: withDeal.id, name: '調査' });
      const without = await createLead(orgA);

      const result = await memberA.leads.bulkUpdateStatus({
        organizationId: orgA,
        ids: [withDeal.id, without.id],
        status: 'nurturing',
      });
      expect(result).toEqual({ success: true, updatedCount: 1, skippedWithDeals: 1 });
      expect((await leadOf(withDeal.id)).status).toBe('negotiating');
      expect((await leadOf(without.id)).status).toBe('nurturing');
    });

    it('lets a lead without deals be changed by hand, as before', async () => {
      const lead = await createLead(orgA);
      expect(await memberA.leads.get({ organizationId: orgA, id: lead.id })).toMatchObject({
        hasDeals: false,
      });
      await memberA.leads.update({ organizationId: orgA, id: lead.id, status: 'nurturing' });
      expect((await leadOf(lead.id)).status).toBe('nurturing');
    });

    it('keeps the lead when its last deal is deleted, and lets it be changed by hand again', async () => {
      const lead = await createLead(orgA);
      const deal = await adminA.deals.create({
        organizationId: orgA,
        leadId: lead.id,
        name: '調査',
        stage: 'proposal',
      });
      await adminA.deals.delete({ organizationId: orgA, dealId: deal.id });
      expect(await leadOf(lead.id)).toMatchObject({ status: 'negotiating', dealPhase: 'proposal' });

      await memberA.leads.update({ organizationId: orgA, id: lead.id, status: 'nurturing' });
      expect((await leadOf(lead.id)).status).toBe('nurturing');
      const listed = await memberA.leads.list({ organizationId: orgA, search: lead.email });
      expect(listed.items.find((item: { id: string }) => item.id === lead.id)).toMatchObject({
        hasDeals: false,
      });
    });

    it('asks for the win as a won deal before an open deal of a lead won by hand', async () => {
      const lead = await createLead(orgA, {
        status: 'won',
        hasNegotiated: true,
        dealPhase: 'survey_won',
      });
      await expect(
        adminA.deals.create({ organizationId: orgA, leadId: lead.id, name: '移行', kind: 'migration' })
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(await pg.select().from(deals).where(eq(deals.leadId, lead.id))).toHaveLength(0);

      // Once the win is a deal, the next deal keeps the lead won
      await adminA.deals.create({ organizationId: orgA, leadId: lead.id, name: '調査', stage: 'won' });
      await adminA.deals.create({
        organizationId: orgA,
        leadId: lead.id,
        name: '移行',
        kind: 'migration',
      });
      expect(await leadOf(lead.id)).toMatchObject({ status: 'won', dealPhase: 'survey_won' });
    });

    it('refuses the status of a lead with deals through REST API v2 too', async () => {
      const { PATCH } = await import('@/app/api/v2/leads/[id]/route');
      const { NextRequest } = await import('next/server');
      const patch = (leadId: string, body: unknown) =>
        PATCH(
          new NextRequest(`http://localhost/api/v2/leads/${leadId}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
            headers: { 'content-type': 'application/json' },
          }),
          { params: Promise.resolve({ id: leadId }) }
        );
      v2.auth.mockResolvedValue({ organizationId: orgA, userId: memberAId });

      const lead = await createLead(orgA);
      await adminA.deals.create({ organizationId: orgA, leadId: lead.id, name: '調査' });
      expect((await patch(lead.id, { status: 'won' })).status).toBe(409);
      expect((await leadOf(lead.id)).status).toBe('negotiating');
      // The same status and the other fields still save
      expect((await patch(lead.id, { status: 'negotiating', company: '新社名' })).status).toBe(200);
      expect((await leadOf(lead.id)).company).toBe('新社名');

      // A lead of another organization is not found, whatever its deals
      v2.auth.mockResolvedValue({ organizationId: orgB, userId: adminBId });
      expect((await patch(lead.id, { status: 'won' })).status).toBe(404);
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

    it("keeps a parent organization's viewers out and tells members what they may do", async () => {
      // Amounts and the pipeline are for the organization's own sales (owner decision 2026-10-24)
      await expect(viewerA.deals.board({ organizationId: orgA })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      const memberBoard = await memberA.deals.board({ organizationId: orgA });
      expect(memberBoard).toMatchObject({ canEdit: true, canDelete: false });
    });
  });

  describe("board: the lead's next action (#853)", () => {
    let org: string;
    // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
    let admin: any;

    beforeAll(async () => {
      org = await createOrganization('商談ボードの次の行動');
      ({ caller: admin } = await callerFor(org, 'admin', '次の行動 一郎'));
    });

    const addTasks = (
      leadId: string,
      tasks: Partial<typeof leadTasks.$inferInsert>[],
      organizationId = org
    ) =>
      pg
        .insert(leadTasks)
        .values(tasks.map((task) => ({ organizationId, leadId, dueOn: '2026-11-01', ...task })))
        .returning();
    const addDeal = (leadId: string, name: string, stage = 'proposal') =>
      admin.deals.create({ organizationId: org, leadId, name, stage });
    const cardsOf = async (): Promise<Record<string, DealCard>> => {
      const board = await admin.deals.board({ organizationId: org });
      const cards: DealCard[] = board.columns.flatMap((column: { deals: DealCard[] }) => column.deals);
      return Object.fromEntries(cards.map((card) => [card.name, card]));
    };
    /** The first open task of the lead's list on the lead and deal pages */
    const firstOfList = async (leadId: string) => {
      const list = await admin.leadFollowUp.tasks({ organizationId: org, leadId });
      return list.items.find((task: { done: boolean }) => !task.done)?.id ?? null;
    };

    it("shows the lead's open task due first, takeaways too, from the value that marks a lead without one", async () => {
      const mixed = await createLead(org, { company: '架空工業' });
      const [, takeaway, first] = await addTasks(mixed.id, [
        // Done: never the next action, even when due first
        { title: '済んだ電話', dueOn: '2026-10-01', completedAt: new Date('2026-10-02T00:00:00Z') },
        {
          title: '持ち帰りの回答',
          kind: 'takeaway',
          dueOn: '2026-10-20',
          createdAt: new Date('2026-10-10T02:00:00Z'),
        },
        // Due the same day and created first
        { title: '見積を送る', dueOn: '2026-10-20', createdAt: new Date('2026-10-10T01:00:00Z') },
        { title: '定例', dueOn: '2026-11-15' },
      ]);
      const takeawayOnly = await createLead(org, { company: '架空製作所' });
      await addTasks(takeawayOnly.id, [
        { title: '保守費用の内訳', kind: 'takeaway', dueOn: '2026-12-01' },
      ]);
      const doneOnly = await createLead(org, { company: '架空商会' });
      await addTasks(doneOnly.id, [{ title: '済んだ訪問', completedAt: new Date() }]);
      const none = await createLead(org, { company: '架空物産' });
      // A row naming the lead with another organization's id (the foreign keys let it be)
      const foreign = await createLead(org, { company: '架空電機' });
      await addTasks(foreign.id, [{ title: '別の組織の行', dueOn: '2026-10-01' }], orgB);
      const fromHearing = await createLead(org, { company: '架空通信' });
      await addTasks(fromHearing.id, [{ title: null, source: 'hearing', dueOn: '2026-10-25' }]);
      const tied = await createLead(org, { company: '架空化学' });
      const ties = await addTasks(
        tied.id,
        ['同時の一', '同時の二'].map((title) => ({
          title,
          dueOn: '2026-10-22',
          createdAt: new Date('2026-10-10T00:00:00Z'),
        }))
      );

      await addDeal(mixed.id, 'mixed');
      await addDeal(mixed.id, 'mixed-won', 'won');
      await addDeal(takeawayOnly.id, 'takeaway');
      await addDeal(doneOnly.id, 'done');
      await addDeal(none.id, 'none');
      await addDeal(foreign.id, 'foreign');
      await addDeal(fromHearing.id, 'hearing');
      await addDeal(tied.id, 'tied');

      const cards = await cardsOf();
      // The day itself as a string, as the lead's tasks are read
      expect(cards.mixed.nextTask).toEqual({
        id: first.id,
        title: '見積を送る',
        dueOn: '2026-10-20',
        kind: 'next_action',
        source: 'manual',
      });
      // The first open task of the lead's list, and the same for every deal of the lead
      expect(await firstOfList(mixed.id)).toBe(first.id);
      expect(cards['mixed-won'].nextTask?.id).toBe(first.id);
      expect(cards.takeaway.nextTask).toMatchObject({
        title: '保守費用の内訳',
        kind: 'takeaway',
        dueOn: '2026-12-01',
      });
      expect(cards.hearing.nextTask).toMatchObject({
        title: null,
        source: 'hearing',
        kind: 'next_action',
      });
      expect(await firstOfList(fromHearing.id)).toBe(cards.hearing.nextTask?.id);
      // The same due day and creation: always the same one
      expect(cards.tied.nextTask?.id).toBe(ties.map((task) => task.id).sort()[0]);
      for (const name of ['done', 'none', 'foreign']) {
        expect(cards[name]).toMatchObject({ nextTask: null, hasOpenTask: false });
      }
      // The mark for having none and the next action shown come from one value
      for (const card of Object.values(cards)) {
        expect(card.hasOpenTask).toBe(card.nextTask !== null);
      }

      // Done, the next one in the list takes its place: the takeaway due the same day
      await admin.leadFollowUp.updateTask({ organizationId: org, id: first.id, done: true });
      const after = await cardsOf();
      expect(after.mixed.nextTask).toMatchObject({ id: takeaway.id, kind: 'takeaway' });
      expect(await firstOfList(mixed.id)).toBe(takeaway.id);
    });
  });

  describe('forLead, get and delete', () => {
    it('lists the deals of a lead oldest first and hides other organizations', async () => {
      const lead = await createLead(orgA);
      const first = await adminA.deals.create({ organizationId: orgA, leadId: lead.id, name: '一' });
      const second = await adminA.deals.create({ organizationId: orgA, leadId: lead.id, name: '二' });
      const listed = await memberA.deals.forLead({ organizationId: orgA, leadId: lead.id });
      expect(listed.items.map((d: { id: string }) => d.id)).toEqual([first.id, second.id]);
      expect(listed).toMatchObject({ canEdit: true, canDelete: false });
      await expect(
        viewerA.deals.forLead({ organizationId: orgA, leadId: lead.id })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        viewerA.deals.get({ organizationId: orgA, dealId: first.id })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
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
      const detail = await memberA.deals.get({ organizationId: orgA, dealId: deal.id });
      expect(detail.lead).toMatchObject({ id: lead.id, company: '架空商事' });
      expect(detail.history.map((h: { changedFields: string[] }) => h.changedFields)).toEqual([
        ['amount'],
        ['created'],
      ]);
      expect(detail.history[0]).toMatchObject({ amount: 1_500_000, changedByName: '営業 花子' });
    });

    it('lets owners and admins delete, records it and leaves the lead as it is', async () => {
      // The last deal of the lead: nothing is left to set the lead from
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
