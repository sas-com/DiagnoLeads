/**
 * The deal in 見極め created when the first meeting of a lead is set (#854, decision
 * 2026-10-28-auto-qualification-deal) on a real PostgreSQL, through a confirmed meeting request:
 * one deal with its default values, owner, history, audit and the lead moved (with the lead's
 * audit row and one webhook call, no handoff notice); the leads that get none (an open deal, won,
 * a phase set past the initial hearing) and are confirmed all the same; a lead whose deals are all
 * lost; another time of the same day and another day; one deal when confirmations or entry points
 * run at the same time (started while another session holds the lead, so that all of them wait
 * before any goes on, whatever the timing); the lead locked before the request (no deadlock with
 * a deletion); and other organizations kept out.
 *
 * The other two entry points the same way: the agency's appointment report (one deal per lead
 * with a new appointment day, counted in the answer, webhooks in one call, the same day again,
 * a row without a day keeping the one saved, the leads locked before their handovers, the
 * answers of ensureQualificationDeals in the order given, 500 rows in one import) and the
 * meeting day of a customer search row (a lead's row saved by sales, a row turned into a lead,
 * the lead locked before the row). Every row belongs to this file's own organizations; names
 * and addresses are made up.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/diagnoleads_test \
 *     bunx vitest --run test/unit/integration/deals-auto-qualification.db.test.ts
 */
import type { Database } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import {
  agencyHandovers,
  auditLogs,
  dealHistory,
  deals,
  leadTasks,
  leads,
  meetingRequests,
  organizationMembers,
  organizations,
  prospects,
  users,
} from '@/lib/db/schema';
import {
  QUALIFICATION_DEAL_NAME,
  type QualificationDealOutcome,
  ensureQualificationDeal,
  ensureQualificationDeals,
} from '@/lib/features/deals/service';
import type { QualificationDealSource } from '@/lib/features/deals/types/pipeline';
import { jstDate } from '@/lib/features/leads/types/pipeline';
import { appRouter } from '@/server/routers/_app';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
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

/** The options of the request: two times of one day, then another day */
const OPTIONS = [
  { date: '2026-11-10', time: '10:00' },
  { date: '2026-11-10', time: '15:00' },
  { date: '2026-11-12', time: '14:00' },
];

describe.skipIf(!url)('deals created by the first meeting (PostgreSQL)', () => {
  /** Statements sent through this file's connections, to count those of one import */
  let statements = 0;
  const client = url
    ? postgres(url, {
        max: 6,
        debug: () => {
          statements += 1;
        },
      })
    : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)! as unknown as Database;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organizationIds: string[] = [];
  const userIds: string[] = [];
  let orgA: string;
  let orgB: string;
  let repId: string;
  let adminId: string;
  let assigneeId: string;
  let viewerId: string;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
  let rep: any;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
  let admin: any;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
  let viewer: any;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
  let adminB: any;

  async function createOrganization(name: string) {
    const [org] = await pg
      .insert(organizations)
      .values({ name, slug: `auto-deal-${unique()}` })
      .returning();
    organizationIds.push(org.id);
    return org.id as string;
  }

  async function callerFor(organizationId: string, role: schema.OrganizationRole, name: string) {
    const [user] = await pg
      .insert(users)
      .values({ email: `auto-deal-${unique()}@example.com`, name })
      .returning();
    userIds.push(user.id);
    await pg.insert(organizationMembers).values({ organizationId, userId: user.id, role });
    const caller = appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId: user.id }, user },
      user,
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);
    return { caller, userId: user.id as string };
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

  /** A lead with the respondent's preferred dates */
  async function leadWithRequest(
    organizationId: string,
    values: Partial<typeof leads.$inferInsert> = {}
  ) {
    const lead = await createLead(organizationId, values);
    await pg.insert(meetingRequests).values({ organizationId, leadId: lead.id, candidates: OPTIONS });
    return lead;
  }

  // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
  const confirm = (caller: any, leadId: string, index: number, organizationId = orgA) =>
    caller.meetingRequests.confirm({
      organizationId,
      leadId,
      candidateIndex: index,
      candidate: OPTIONS[index],
      sendEmail: false,
    });

  /** Another entry point setting the first meeting, in its own transaction */
  const ensure = (
    leadId: string,
    source: QualificationDealSource,
    organizationId = orgA
  ): Promise<QualificationDealOutcome> =>
    pg.transaction((tx) =>
      ensureQualificationDeal(tx, {
        organizationId,
        leadId,
        userId: repId,
        source,
        meetingOn: '2026-11-10',
      })
    );

  const dealsOf = (leadId: string) =>
    pg.select().from(deals).where(eq(deals.leadId, leadId)).orderBy(asc(deals.createdAt), asc(deals.id));
  const leadOf = async (id: string) => {
    const [lead] = await pg.select().from(leads).where(eq(leads.id, id));
    return lead;
  };
  const requestOf = async (leadId: string) => {
    const [row] = await pg.select().from(meetingRequests).where(eq(meetingRequests.leadId, leadId));
    return row;
  };
  const historyOf = (dealId: string) =>
    pg.select().from(dealHistory).where(eq(dealHistory.dealId, dealId));
  const auditOf = (resource: string, resourceId: string) =>
    pg
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.resource, resource), eq(auditLogs.resourceId, resourceId)))
      .orderBy(asc(auditLogs.createdAt));

  /** The agency's appointment report, imported by the caller */
  const importReport = (
    // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
    caller: any,
    rows: Record<string, unknown>[],
    organizationId = orgA
  ) => caller.agencyHandovers.import({ organizationId, rows });

  /** A customer search row, written by sales */
  async function prospectRow(
    values: Partial<typeof prospects.$inferInsert> = {},
    organizationId = orgA
  ) {
    const [row] = await pg
      .insert(prospects)
      .values({
        organizationId,
        contactedOn: '2026-10-20',
        entry: 'member_network',
        company: '架空商事',
        ...values,
      })
      .returning();
    return row;
  }

  /** Sales save the row as the form sends it, with the meeting day */
  const saveRow = (
    // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
    caller: any,
    row: typeof prospects.$inferSelect,
    meetingOn: string | null,
    organizationId = orgA
  ) =>
    caller.prospects.update({
      organizationId,
      id: row.id,
      contactedOn: row.contactedOn,
      entry: row.entry,
      company: row.company,
      meetingOn,
    });

  const rowOf = async (id: string) => {
    const [row] = await pg.select().from(prospects).where(eq(prospects.id, id));
    return row;
  };

  beforeAll(async () => {
    orgA = await createOrganization('自動の商談テストA');
    orgB = await createOrganization('自動の商談テストB');
    ({ caller: rep, userId: repId } = await callerFor(orgA, 'member', '営業 花子'));
    ({ caller: admin, userId: adminId } = await callerFor(orgA, 'admin', '管理 一郎'));
    ({ userId: assigneeId } = await callerFor(orgA, 'member', '担当 次郎'));
    ({ caller: viewer, userId: viewerId } = await callerFor(orgA, 'parent_viewer', '閲覧 三郎'));
    ({ caller: adminB } = await callerFor(orgB, 'admin', '別組織 四郎'));
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

  it('creates one deal in 見極め with its defaults, history and audit, moves the lead, and answers only that it did', async () => {
    const lead = await leadWithRequest(orgA, { assigneeUserId: assigneeId, targetSystem: 'as400' });

    const outcome = await confirm(rep, lead.id, 0);
    // Whether a deal was created, never the deal (#276)
    expect(outcome).toEqual({
      ok: true,
      candidate: OPTIONS[0],
      email: 'not_requested',
      dealCreated: true,
    });

    const rows = await dealsOf(lead.id);
    expect(rows).toHaveLength(1);
    const [deal] = rows;
    expect(QUALIFICATION_DEAL_NAME).toBe('現行調査');
    expect(deal).toMatchObject({
      organizationId: orgA,
      name: QUALIFICATION_DEAL_NAME,
      kind: 'survey',
      stage: 'qualification',
      probability: 10,
      amount: null,
      forecastOverride: null,
      expectedCloseOn: null,
      closedOn: null,
      lostReason: null,
      lostNote: null,
      competitor: null,
      nextStep: null,
      // The lead's, as for a deal created by hand
      targetSystem: 'as400',
      ownerUserId: assigneeId,
      previousDealId: null,
      createdBy: repId,
      updatedBy: repId,
    });

    const history = await historyOf(deal.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      stage: 'qualification',
      probability: 10,
      ownerUserId: assigneeId,
      changedFields: ['created'],
      changedBy: repId,
    });
    const audits = await auditOf('deal', deal.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: 'create', userId: repId, organizationId: orgA });
    // Where it came from and the day of the meeting: the deal has no column for it
    expect(audits[0].metadata).toEqual({
      leadId: lead.id,
      source: 'meeting_request',
      meetingOn: '2026-11-10',
    });

    const after = await leadOf(lead.id);
    expect(after).toMatchObject({
      status: 'negotiating',
      dealPhase: 'initial_hearing',
      hasNegotiated: true,
    });
    expect(after.dealPhaseReachedAt).toEqual({ initial_hearing: jstDate() });
    const leadAudits = await auditOf('lead', lead.id);
    expect(leadAudits).toHaveLength(1);
    expect(leadAudits[0]).toMatchObject({ action: 'update', userId: repId });
    expect(leadAudits[0].changes).toEqual({
      before: { status: 'new', dealPhase: null },
      after: { status: 'negotiating', dealPhase: 'initial_hearing' },
    });
    // The lead's audit row says where the deal came from too; one created by hand has no source
    expect(leadAudits[0].metadata).toEqual({ dealId: deal.id, source: 'meeting_request' });

    // The lead's webhooks in one call after the commit; still the initial hearing: no handoff
    expect(sent.emitLeadEvents).toHaveBeenCalledTimes(1);
    const [organizationId, events] = sent.emitLeadEvents.mock.calls[0];
    expect(organizationId).toBe(orgA);
    expect(events.map((event: { type: string }) => event.type).sort()).toEqual([
      'lead.status_changed',
      'lead.updated',
    ]);
    expect(sent.notifyLeadHandoff).not.toHaveBeenCalled();

    // The meeting itself as before: the next action on the day
    expect(await requestOf(lead.id)).toMatchObject({ confirmedOn: '2026-11-10', confirmedBy: repId });
    const tasks = await pg.select().from(leadTasks).where(eq(leadTasks.leadId, lead.id));
    expect(tasks).toMatchObject([{ source: 'meeting_request', dueOn: '2026-11-10' }]);
    // The lead's deals card shows it
    const listed = await rep.deals.forLead({ organizationId: orgA, leadId: lead.id });
    expect(listed.items).toMatchObject([{ id: deal.id, name: '現行調査', stage: 'qualification' }]);
  });

  it('gives the deal to the one who confirmed when the lead has no assignee who can hold leads', async () => {
    const unassigned = await leadWithRequest(orgA);
    // A parent organization's viewer cannot hold leads
    const viewerAssigned = await leadWithRequest(orgA, { assigneeUserId: viewerId });

    await confirm(rep, unassigned.id, 0);
    await confirm(admin, viewerAssigned.id, 2);

    expect((await dealsOf(unassigned.id))[0]).toMatchObject({ ownerUserId: repId, createdBy: repId });
    const [deal] = await dealsOf(viewerAssigned.id);
    expect(deal.ownerUserId).not.toBe(viewerId);
    expect(deal.ownerUserId).toBe(deal.createdBy);
    expect((await auditOf('deal', deal.id))[0].metadata).toMatchObject({ meetingOn: '2026-11-12' });
  });

  describe('leads that get no deal, confirmed all the same', () => {
    it('a lead with an open deal (one deal whatever the entry point)', async () => {
      const lead = await leadWithRequest(orgA);
      const open = await admin.deals.create({
        organizationId: orgA,
        leadId: lead.id,
        name: '移行の相談',
        kind: 'migration',
        stage: 'discovery',
      });
      sent.emitLeadEvents.mockClear();

      expect(await confirm(rep, lead.id, 0)).toMatchObject({ ok: true, dealCreated: false });
      expect((await dealsOf(lead.id)).map((deal) => deal.id)).toEqual([open.id]);
      expect(await requestOf(lead.id)).toMatchObject({ confirmedOn: '2026-11-10' });
      expect(sent.emitLeadEvents).not.toHaveBeenCalled();
    });

    it('a lead with a won deal: its next deal is created by sales', async () => {
      const lead = await leadWithRequest(orgA);
      await admin.deals.create({ organizationId: orgA, leadId: lead.id, name: '調査', stage: 'won' });

      expect(await confirm(rep, lead.id, 0)).toMatchObject({ ok: true, dealCreated: false });
      expect((await dealsOf(lead.id)).map((deal) => deal.stage)).toEqual(['won']);
      expect(await leadOf(lead.id)).toMatchObject({ status: 'won', dealPhase: 'survey_won' });
    });

    it('a lead won by hand without deals: no error, unlike a deal created by hand', async () => {
      const lead = await leadWithRequest(orgA, {
        status: 'won',
        hasNegotiated: true,
        dealPhase: 'survey_won',
      });

      expect(await confirm(rep, lead.id, 0)).toMatchObject({ ok: true, dealCreated: false });
      expect(await dealsOf(lead.id)).toHaveLength(0);
      expect(await leadOf(lead.id)).toMatchObject({ status: 'won', dealPhase: 'survey_won' });
      expect(await requestOf(lead.id)).toMatchObject({ confirmedOn: '2026-11-10' });
    });

    it('a lead without deals whose phase was set past the initial hearing: it is not taken back', async () => {
      const lead = await leadWithRequest(orgA, {
        status: 'negotiating',
        hasNegotiated: true,
        dealPhase: 'proposal',
      });

      expect(await confirm(rep, lead.id, 0)).toMatchObject({ ok: true, dealCreated: false });
      expect(await dealsOf(lead.id)).toHaveLength(0);
      expect(await leadOf(lead.id)).toMatchObject({ status: 'negotiating', dealPhase: 'proposal' });
      expect(sent.emitLeadEvents).not.toHaveBeenCalled();
    });
  });

  it('creates one for a lead whose deals are all lost, even at a later phase (its time has come again)', async () => {
    const lead = await leadWithRequest(orgA);
    const earlier = await admin.deals.create({
      organizationId: orgA,
      leadId: lead.id,
      name: '前回の調査',
      stage: 'proposal',
    });
    await admin.deals.update({
      organizationId: orgA,
      dealId: earlier.id,
      stage: 'lost',
      lostReason: 'timing',
    });
    expect(await leadOf(lead.id)).toMatchObject({ status: 'lost', dealPhase: 'proposal' });
    sent.emitLeadEvents.mockClear();

    expect(await confirm(rep, lead.id, 0)).toMatchObject({ ok: true, dealCreated: true });
    expect((await dealsOf(lead.id)).map((deal) => deal.stage)).toEqual(['lost', 'qualification']);
    // Back in 見極め; the reason of the loss stays for the objection card
    expect(await leadOf(lead.id)).toMatchObject({
      status: 'negotiating',
      dealPhase: 'initial_hearing',
      lostReason: 'timing',
    });
    expect(sent.emitLeadEvents).toHaveBeenCalledTimes(1);
  });

  it('creates none for another time of the same day, even after the deal was lost; another day creates one', async () => {
    const lead = await leadWithRequest(orgA);
    expect(await confirm(rep, lead.id, 0)).toMatchObject({ dealCreated: true });
    const [first] = await dealsOf(lead.id);
    // The meeting fell through: sales close the deal with a reason
    await rep.deals.update({
      organizationId: orgA,
      dealId: first.id,
      stage: 'lost',
      lostReason: 'timing',
    });

    // Another time of the same day, then the same option again: the lost deal stays the only one
    expect(await confirm(rep, lead.id, 1)).toMatchObject({ ok: true, dealCreated: false });
    expect(await confirm(rep, lead.id, 1)).toMatchObject({ ok: true, dealCreated: false });
    expect(await dealsOf(lead.id)).toHaveLength(1);
    expect(await requestOf(lead.id)).toMatchObject({ confirmedOn: '2026-11-10', confirmedTime: '15:00' });

    // Another day sets a new first meeting
    expect(await confirm(rep, lead.id, 2)).toMatchObject({ ok: true, dealCreated: true });
    const rows = await dealsOf(lead.id);
    expect(rows.map((deal) => deal.stage)).toEqual(['lost', 'qualification']);
    expect((await auditOf('deal', rows[1].id))[0].metadata).toEqual({
      leadId: lead.id,
      source: 'meeting_request',
      meetingOn: '2026-11-12',
    });
    // While it is open, moving the meeting again creates none
    expect(await confirm(rep, lead.id, 0)).toMatchObject({ ok: true, dealCreated: false });
    expect(await dealsOf(lead.id)).toHaveLength(2);
  });

  /**
   * Until `count` sessions wait for a lock the given backend holds, directly or behind another
   * waiting session: the second session waiting for one row waits behind the first, and
   * pg_blocking_pids names the first. Only sessions waiting behind this test's own connection
   * count, not those of other test files. Throws after 5 seconds, when the test could no longer
   * show what it means to.
   */
  async function untilBlockedBy(pid: number, count = 1) {
    for (let i = 0; i < 100; i++) {
      const [row] = await pg.execute<{ waiting: number }>(sql`
        with recursive behind(pid) as (
          select pid from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))
          union
          select s.pid from pg_stat_activity s join behind on behind.pid = any(pg_blocking_pids(s.pid))
        )
        select count(*)::int as waiting from behind`);
      if (row && row.waiting >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Fewer than ${count} sessions waited for the lock`);
  }

  const backendPid = async (tx: postgres.TransactionSql) => {
    const [row] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid`;
    return row.pid;
  };

  /**
   * Starts the steps while another session holds the lead (FOR NO KEY UPDATE, as an entry point
   * takes it), each once the steps before it wait for that lock, and lets the lead go when all
   * of them wait. So every step has started and waits before any goes on, whatever the timing.
   */
  async function whileLeadIsHeld<T>(leadId: string, steps: (() => Promise<T>)[]): Promise<T[]> {
    // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
    const holder = postgres(url!, { max: 1 });
    const started: Promise<T>[] = [];
    try {
      await holder.begin(async (tx) => {
        await tx`select id from leads where id = ${leadId} for no key update`;
        const pid = await backendPid(tx);
        for (const step of steps) {
          const running = step();
          // Read with the others below; never left unhandled while the lead is held
          running.catch(() => {});
          started.push(running);
          await untilBlockedBy(pid, started.length);
        }
      });
    } finally {
      await holder.end();
    }
    return Promise.all(started);
  }

  // One deal for one lead, whatever runs at the same time. Each test starts its sessions while
  // the lead is held, so that all of them wait before any goes on
  describe('at the same time, one deal', () => {
    it('two confirmations of one lead: the second sees the first one and its deal', async () => {
      const lead = await leadWithRequest(orgA);

      // biome-ignore lint/suspicious/noExplicitAny: tRPC outcomes
      const outcomes: any[] = await whileLeadIsHeld(lead.id, [
        () => confirm(rep, lead.id, 0),
        () => confirm(admin, lead.id, 2),
      ]);

      expect(outcomes.map((outcome) => outcome.ok)).toEqual([true, true]);
      expect(outcomes.filter((outcome) => outcome.dealCreated)).toHaveLength(1);
      expect(await dealsOf(lead.id)).toHaveLength(1);
    });

    it('a confirmation and another entry point: the lead is locked before its deals are read', async () => {
      const lead = await leadWithRequest(orgA);

      // biome-ignore lint/suspicious/noExplicitAny: tRPC outcomes
      const [confirmed, ensured]: any[] = await whileLeadIsHeld<unknown>(lead.id, [
        () => confirm(rep, lead.id, 0),
        () => ensure(lead.id, 'agency_handover'),
      ]);

      expect(confirmed).toMatchObject({ ok: true });
      // Whichever goes first creates it; the other sees it open
      expect([confirmed.dealCreated, ensured.created].filter(Boolean)).toHaveLength(1);
      expect(await dealsOf(lead.id)).toHaveLength(1);
    });

    it('two entry points: the lead is locked before its deals are read', async () => {
      const lead = await createLead(orgA);

      const outcomes = await whileLeadIsHeld(lead.id, [
        () => ensure(lead.id, 'meeting_request'),
        () => ensure(lead.id, 'agency_handover'),
      ]);

      expect(outcomes.filter((outcome) => outcome.created)).toHaveLength(1);
      expect(outcomes.filter((outcome) => !outcome.created)).toEqual([
        { created: false, skipped: 'open_deal' },
      ]);
      const rows = await dealsOf(lead.id);
      expect(rows).toHaveLength(1);
      // Both audit rows name the entry point that created it
      const [dealAudit] = await auditOf('deal', rows[0].id);
      const [leadAudit] = await auditOf('lead', lead.id);
      expect(['meeting_request', 'agency_handover']).toContain(dealAudit.metadata?.source);
      expect(leadAudit.metadata).toEqual({ dealId: rows[0].id, source: dealAudit.metadata?.source });
    });
  });

  describe('the lead is locked before the request', () => {
    const outcome = (promise: Promise<unknown>) =>
      promise.then(
        () => 'done',
        (error: { code?: string }) => error.code
      );

    it('so a lead deleted while its meeting is confirmed is not found, without a deadlock', async () => {
      const lead = await leadWithRequest(orgA);
      // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
      const other = postgres(url!, { max: 1 });
      let confirming: Promise<unknown> = Promise.resolve();
      try {
        await other.begin(async (tx) => {
          // A deletion holds the lead, then deletes its rows through the cascade. Taking the
          // request first, the confirmation would hold it and wait for the lead: a deadlock
          await tx`select id from leads where id = ${lead.id} for update`;
          confirming = outcome(confirm(rep, lead.id, 0));
          await untilBlockedBy(await backendPid(tx));
          await tx`delete from leads where id = ${lead.id}`;
        });
      } finally {
        await other.end();
      }

      expect(await confirming).toBe('NOT_FOUND');
      expect(await dealsOf(lead.id)).toHaveLength(0);
      expect(await requestOf(lead.id)).toBeUndefined();
    });
  });

  describe("the agency's appointment report", () => {
    it('creates one deal per lead with a new appointment day, counts them and sends their webhooks in one call', async () => {
      const appointed = await createLead(orgA, { assigneeUserId: assigneeId });
      const other = await createLead(orgA, { company: '架空工業' });
      const undated = await createLead(orgA);
      const withOpenDeal = await createLead(orgA);
      await admin.deals.create({
        organizationId: orgA,
        leadId: withOpenDeal.id,
        name: '移行の相談',
        stage: 'discovery',
      });
      const wonByHand = await createLead(orgA, {
        status: 'won',
        hasNegotiated: true,
        dealPhase: 'survey_won',
      });
      // The deal created by hand moved its lead past the initial hearing (a handoff)
      sent.emitLeadEvents.mockClear();
      sent.notifyLeadHandoff.mockClear();

      const outcome = await importReport(rep, [
        { email: appointed.email, appointmentOn: '2026-11-05', agencyName: '架空テレアポ' },
        { company: '架空工業', appointmentOn: '2026-11-06' },
        { email: undated.email, machineModel: 'IBM Power 9' },
        { email: withOpenDeal.email, appointmentOn: '2026-11-05' },
        { email: wonByHand.email, appointmentOn: '2026-11-05' },
      ]);

      // The handovers as before, and the deals counted, never shown (#276)
      expect(outcome).toEqual({
        results: [
          { index: 0, status: 'saved', leadId: appointed.id },
          { index: 1, status: 'saved', leadId: other.id },
          { index: 2, status: 'saved', leadId: undated.id },
          { index: 3, status: 'saved', leadId: withOpenDeal.id },
          { index: 4, status: 'saved', leadId: wonByHand.id },
        ],
        dealsCreated: 2,
      });
      const [deal] = await dealsOf(appointed.id);
      expect(deal).toMatchObject({
        name: QUALIFICATION_DEAL_NAME,
        kind: 'survey',
        stage: 'qualification',
        probability: 10,
        ownerUserId: assigneeId,
        createdBy: repId,
      });
      expect((await auditOf('deal', deal.id))[0].metadata).toEqual({
        leadId: appointed.id,
        source: 'agency_handover',
        meetingOn: '2026-11-05',
      });
      expect((await auditOf('lead', appointed.id))[0].metadata).toEqual({
        dealId: deal.id,
        source: 'agency_handover',
      });
      expect(await leadOf(appointed.id)).toMatchObject({
        status: 'negotiating',
        dealPhase: 'initial_hearing',
        hasNegotiated: true,
      });
      expect((await dealsOf(other.id)).map((row) => row.stage)).toEqual(['qualification']);
      expect(await dealsOf(undated.id)).toHaveLength(0);
      expect((await dealsOf(withOpenDeal.id)).map((row) => row.stage)).toEqual(['discovery']);
      expect(await dealsOf(wonByHand.id)).toHaveLength(0);

      // The two leads' webhooks in one call after the commit; no handoff in 見極め
      expect(sent.emitLeadEvents).toHaveBeenCalledTimes(1);
      const [organizationId, events] = sent.emitLeadEvents.mock.calls[0];
      expect(organizationId).toBe(orgA);
      expect(
        events.map((event: { type: string; lead: { id: string } }) => `${event.type} ${event.lead.id}`).sort()
      ).toEqual(
        [
          `lead.status_changed ${appointed.id}`,
          `lead.status_changed ${other.id}`,
          `lead.updated ${appointed.id}`,
          `lead.updated ${other.id}`,
        ].sort()
      );
      expect(sent.notifyLeadHandoff).not.toHaveBeenCalled();
    });

    it('creates none for the same day imported again, even after the deal was lost; another day creates one', async () => {
      const lead = await createLead(orgA);
      expect(await importReport(rep, [{ email: lead.email, appointmentOn: '2026-11-05' }])).toMatchObject({
        dealsCreated: 1,
      });
      const [first] = await dealsOf(lead.id);
      // The meeting fell through: sales close the deal with a reason
      await rep.deals.update({ organizationId: orgA, dealId: first.id, stage: 'lost', lostReason: 'timing' });
      sent.emitLeadEvents.mockClear();

      expect(await importReport(rep, [{ email: lead.email, appointmentOn: '2026-11-05', note: '再送' }])).toMatchObject({
        results: [{ status: 'saved' }],
        dealsCreated: 0,
      });
      expect(await dealsOf(lead.id)).toHaveLength(1);
      expect(sent.emitLeadEvents).not.toHaveBeenCalled();

      expect(await importReport(rep, [{ email: lead.email, appointmentOn: '2026-11-19' }])).toMatchObject({
        dealsCreated: 1,
      });
      const rows = await dealsOf(lead.id);
      expect(rows.map((row) => row.stage)).toEqual(['lost', 'qualification']);
      expect((await auditOf('deal', rows[1].id))[0].metadata).toMatchObject({ meetingOn: '2026-11-19' });
      const [handover] = await pg.select().from(agencyHandovers).where(eq(agencyHandovers.leadId, lead.id));
      expect(handover.appointmentOn).toBe('2026-11-19');
    });

    it('keeps the appointment day when a report leaves it empty, so the same day later creates none after the deal was lost', async () => {
      const lead = await createLead(orgA);
      const handoverOf = async () => {
        const [handover] = await pg
          .select()
          .from(agencyHandovers)
          .where(eq(agencyHandovers.leadId, lead.id));
        return handover;
      };
      expect(await importReport(rep, [{ email: lead.email, appointmentOn: '2026-11-05' }])).toMatchObject({
        dealsCreated: 1,
      });
      const [first] = await dealsOf(lead.id);
      await rep.deals.update({ organizationId: orgA, dealId: first.id, stage: 'lost', lostReason: 'timing' });

      // A report without the day (its column not mapped, or the day not read): the rest is replaced
      expect(await importReport(rep, [{ email: lead.email, machineModel: 'IBM Power 10' }])).toMatchObject({
        results: [{ status: 'saved' }],
        dealsCreated: 0,
      });
      expect(await handoverOf()).toMatchObject({ appointmentOn: '2026-11-05', machineModel: 'IBM Power 10' });

      // The same day again is no new first meeting: the lost deal stays the only one
      expect(await importReport(rep, [{ email: lead.email, appointmentOn: '2026-11-05' }])).toMatchObject({
        results: [{ status: 'saved' }],
        dealsCreated: 0,
      });
      expect((await dealsOf(lead.id)).map((deal) => deal.stage)).toEqual(['lost']);
      expect(await handoverOf()).toMatchObject({ appointmentOn: '2026-11-05', machineModel: null });
    });

    it('creates none in another organization, nor for those who cannot import', async () => {
      const lead = await createLead(orgA);

      // The same address imported in another organization finds none of this one's leads
      expect(await importReport(adminB, [{ email: lead.email, appointmentOn: '2026-11-05' }], orgB)).toEqual({
        results: [{ index: 0, status: 'unmatched' }],
        dealsCreated: 0,
      });
      await expect(
        importReport(viewer, [{ email: lead.email, appointmentOn: '2026-11-05' }])
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(await dealsOf(lead.id)).toHaveLength(0);
      expect(await leadOf(lead.id)).toMatchObject({ status: 'new', dealPhase: null });
    });

    it('answers each lead of one call in the order given, created, skipped or not found', async () => {
      const first = await createLead(orgA);
      const second = await createLead(orgA);
      // The lead locked last is given first, so the order of the answers is not that of the lock
      const [low, high] = [first, second].sort((a, b) => a.id.localeCompare(b.id));
      await admin.deals.create({ organizationId: orgA, leadId: low.id, name: '移行の相談', stage: 'discovery' });
      const foreign = await createLead(orgB);

      const outcomes = await pg.transaction((tx) =>
        ensureQualificationDeals(tx, {
          organizationId: orgA,
          userId: repId,
          source: 'agency_handover',
          meetings: [
            { leadId: high.id, meetingOn: '2026-11-05' },
            { leadId: foreign.id, meetingOn: '2026-11-05' },
            { leadId: low.id, meetingOn: '2026-11-05' },
          ],
        })
      );

      const [created] = await dealsOf(high.id);
      expect(outcomes).toEqual([
        {
          created: true,
          dealId: created.id,
          lead: expect.objectContaining({ after: expect.objectContaining({ id: high.id }) }),
        },
        { created: false, skipped: 'lead_not_found' },
        { created: false, skipped: 'open_deal' },
      ]);
      expect((await auditOf('deal', created.id))[0].metadata).toEqual({
        leadId: high.id,
        source: 'agency_handover',
        meetingOn: '2026-11-05',
      });
      expect(await dealsOf(foreign.id)).toHaveLength(0);
      expect((await dealsOf(low.id)).map((deal) => deal.stage)).toEqual(['discovery']);
    });

    it('imports 500 rows with a deal each in one transaction, within the time of a function', async () => {
      const values = Array.from({ length: 500 }, (_, i) => ({
        organizationId: orgA,
        email: `bulk-${i}-${unique()}@example.co.jp`,
        name: '山田 花子',
        company: '架空商事',
      }));
      const created = await pg.insert(leads).values(values).returning({ id: leads.id, email: leads.email });
      sent.emitLeadEvents.mockClear();

      statements = 0;
      const started = performance.now();
      const outcome = await importReport(
        rep,
        created.map((lead) => ({ email: lead.email, appointmentOn: '2026-11-05' }))
      );
      const seconds = (performance.now() - started) / 1000;
      const sentStatements = statements;
      console.info(
        `importHandovers: 500 rows, 500 deals, ${sentStatements} statements in ${seconds.toFixed(2)} s`
      );

      expect(outcome.dealsCreated).toBe(500);
      const [{ count }] = await pg
        .select({ count: sql<number>`count(*)::int` })
        .from(deals)
        .where(inArray(deals.leadId, created.map((lead) => lead.id)));
      expect(count).toBe(500);
      // One call; the events past its limit are dropped and reported by the webhooks feature
      expect(sent.emitLeadEvents).toHaveBeenCalledTimes(1);
      expect(sent.emitLeadEvents.mock.calls[0][1]).toHaveLength(1000);
      // About two statements a row (its handover, its lead) and a few for all the deals, not one
      // per step of each deal (some 5,500): in production every statement waits for the network,
      // and the import holds the leads until it ends. Far below the 30 seconds of a function
      // (vercel.json) on a local database
      expect(sentStatements).toBeLessThan(1100);
      expect(seconds).toBeLessThan(20);
    }, 60_000);
  });

  describe('the meeting day of a customer search row', () => {
    it("creates one deal when sales set the meeting day of a lead's row; the same day again creates none, even after it was lost; another day does", async () => {
      const lead = await createLead(orgA, { assigneeUserId: assigneeId });
      const row = await prospectRow({ leadId: lead.id });

      expect(await saveRow(admin, row, '2026-11-10')).toEqual({ id: row.id, dealCreated: true });
      const [deal] = await dealsOf(lead.id);
      expect(deal).toMatchObject({ stage: 'qualification', ownerUserId: assigneeId });
      expect((await auditOf('deal', deal.id))[0].metadata).toEqual({
        leadId: lead.id,
        source: 'prospect',
        meetingOn: '2026-11-10',
      });
      expect(await rowOf(row.id)).toMatchObject({ meetingOn: '2026-11-10', leadId: lead.id });
      expect(sent.emitLeadEvents).toHaveBeenCalledTimes(1);

      await admin.deals.update({ organizationId: orgA, dealId: deal.id, stage: 'lost', lostReason: 'timing' });
      expect(await saveRow(admin, row, '2026-11-10')).toEqual({ id: row.id, dealCreated: false });
      // Clearing the day creates none either
      expect(await saveRow(admin, row, null)).toEqual({ id: row.id, dealCreated: false });
      expect(await dealsOf(lead.id)).toHaveLength(1);

      expect(await saveRow(admin, row, '2026-11-17')).toEqual({ id: row.id, dealCreated: true });
      expect((await dealsOf(lead.id)).map((row) => row.stage)).toEqual(['lost', 'qualification']);
    });

    it('creates none for a row that is not a lead yet; turning it into a lead does, with the day of the row', async () => {
      const row = await prospectRow({ company: '架空精機' });
      expect(await saveRow(admin, row, '2026-11-10')).toEqual({ id: row.id, dealCreated: false });
      expect(await rowOf(row.id)).toMatchObject({ meetingOn: '2026-11-10', leadId: null });
      sent.emitLeadEvents.mockClear();

      const converted = await admin.prospects.convertToLead({
        organizationId: orgA,
        id: row.id,
        email: `convert-${unique()}@example.co.jp`,
      });
      expect(converted).toMatchObject({ linkedExisting: false, dealCreated: true });
      const [deal] = await dealsOf(converted.leadId);
      // The row has no sales person: the deal is the one's who turned it into a lead
      expect(deal).toMatchObject({ stage: 'qualification', ownerUserId: adminId, createdBy: adminId });
      expect((await auditOf('deal', deal.id))[0].metadata).toEqual({
        leadId: converted.leadId,
        source: 'prospect',
        meetingOn: '2026-11-10',
      });
      expect(await leadOf(converted.leadId)).toMatchObject({ status: 'negotiating', dealPhase: 'initial_hearing' });
      // The new lead, then the deal's change of it
      expect(sent.emitLeadEvents.mock.calls.map((call) => call[1].map((event: { type: string }) => event.type))).toEqual([
        ['lead.created'],
        expect.arrayContaining(['lead.status_changed', 'lead.updated']),
      ]);
    });

    it('links a row with a meeting day to an existing lead and creates its deal; a row without one creates none', async () => {
      const existing = await createLead(orgA);
      const dated = await prospectRow({ meetingOn: '2026-11-12' });
      expect(
        await admin.prospects.convertToLead({ organizationId: orgA, id: dated.id, email: existing.email })
      ).toEqual({ leadId: existing.id, linkedExisting: true, dealCreated: true });
      expect((await dealsOf(existing.id)).map((row) => row.stage)).toEqual(['qualification']);

      // Another row of the same lead: its open deal stays the only one
      const again = await prospectRow({ meetingOn: '2026-11-20' });
      expect(
        await admin.prospects.convertToLead({ organizationId: orgA, id: again.id, email: existing.email })
      ).toMatchObject({ linkedExisting: true, dealCreated: false });

      const undated = await prospectRow();
      const plain = await admin.prospects.convertToLead({
        organizationId: orgA,
        id: undated.id,
        email: `plain-${unique()}@example.co.jp`,
      });
      expect(plain).toMatchObject({ dealCreated: false });
      expect(await dealsOf(plain.leadId)).toHaveLength(0);
      expect(await dealsOf(existing.id)).toHaveLength(1);
    });

    it('creates none for those who cannot change the row, nor across organizations', async () => {
      const lead = await createLead(orgA);
      const row = await prospectRow({ leadId: lead.id, createdBy: repId });

      // A member does not change a lead's row, a parent organization's viewer no row at all
      await expect(saveRow(rep, row, '2026-11-10')).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(saveRow(viewer, row, '2026-11-10')).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(saveRow(adminB, row, '2026-11-10', orgB)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      const unlinked = await prospectRow({ meetingOn: '2026-11-10' });
      await expect(
        adminB.prospects.convertToLead({ organizationId: orgB, id: unlinked.id, email: lead.email })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      expect(await dealsOf(lead.id)).toHaveLength(0);
      expect(await rowOf(row.id)).toMatchObject({ meetingOn: null });
      expect(await rowOf(unlinked.id)).toMatchObject({ leadId: null });
    });

    it("locks the lead before the row: a lead deleted while its row is saved is not saved, without a deadlock", async () => {
      const lead = await createLead(orgA);
      const row = await prospectRow({ leadId: lead.id });
      // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
      const other = postgres(url!, { max: 1 });
      let saving: Promise<unknown> = Promise.resolve();
      try {
        await other.begin(async (tx) => {
          // A deletion holds the lead, then clears the row's lead through the foreign key. Taking
          // the row first, the save would hold it and wait for the lead: a deadlock
          await tx`select id from leads where id = ${lead.id} for update`;
          saving = saveRow(admin, row, '2026-11-10').then(
            () => 'done',
            (error: { code?: string }) => error.code
          );
          await untilBlockedBy(await backendPid(tx));
          await tx`delete from leads where id = ${lead.id}`;
        });
      } finally {
        await other.end();
      }

      expect(await saving).toBe('CONFLICT');
      expect(await rowOf(row.id)).toMatchObject({ leadId: null, meetingOn: null });
      expect(await dealsOf(lead.id)).toHaveLength(0);
    });
  });

  describe('the entry points at the same time, one deal', () => {
    it('an import and a confirmation of one lead', async () => {
      const lead = await leadWithRequest(orgA);

      // biome-ignore lint/suspicious/noExplicitAny: tRPC outcomes
      const [imported, confirmed]: any[] = await whileLeadIsHeld<unknown>(lead.id, [
        () => importReport(rep, [{ email: lead.email, appointmentOn: '2026-11-05' }]),
        () => confirm(admin, lead.id, 0),
      ]);

      expect(imported.results).toEqual([{ index: 0, status: 'saved', leadId: lead.id }]);
      expect(confirmed).toMatchObject({ ok: true });
      expect(imported.dealsCreated + Number(confirmed.dealCreated)).toBe(1);
      expect(await dealsOf(lead.id)).toHaveLength(1);
    });

    it("a customer search row's meeting day and a confirmation of its lead", async () => {
      const lead = await leadWithRequest(orgA);
      const row = await prospectRow({ leadId: lead.id });

      // biome-ignore lint/suspicious/noExplicitAny: tRPC outcomes
      const [saved, confirmed]: any[] = await whileLeadIsHeld<unknown>(lead.id, [
        () => saveRow(admin, row, '2026-11-10'),
        () => confirm(rep, lead.id, 2),
      ]);

      expect(confirmed).toMatchObject({ ok: true });
      expect(Number(saved.dealCreated) + Number(confirmed.dealCreated)).toBe(1);
      expect(await dealsOf(lead.id)).toHaveLength(1);
    });

    it('two imports of the same leads listed in opposite orders: no deadlock, one deal each', async () => {
      const first = await createLead(orgA);
      const second = await createLead(orgA);
      const [low, high] = [first, second].sort((a, b) => a.id.localeCompare(b.id));
      const rows = [
        { email: low.email, appointmentOn: '2026-11-05' },
        { email: high.email, appointmentOn: '2026-11-05' },
      ];

      // Both wait for the first lead in the order of ids, whatever the order of their rows
      // biome-ignore lint/suspicious/noExplicitAny: tRPC outcomes
      const outcomes: any[] = await whileLeadIsHeld(low.id, [
        () => importReport(rep, rows),
        () => importReport(admin, [...rows].reverse()),
      ]);

      expect(outcomes.map((outcome) => outcome.dealsCreated).sort()).toEqual([0, 2]);
      expect(await dealsOf(low.id)).toHaveLength(1);
      expect(await dealsOf(high.id)).toHaveLength(1);
    });

    it('a lead deleted while a report is imported is not found, every row of it, without a deadlock', async () => {
      const lead = await createLead(orgA);
      // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
      const other = postgres(url!, { max: 1 });
      let importing: Promise<unknown> = Promise.resolve();
      try {
        await other.begin(async (tx) => {
          // A deletion holds the lead, then deletes its handover through the cascade
          await tx`select id from leads where id = ${lead.id} for update`;
          // The lead twice: the earlier row is replaced by the later one, which is not saved
          importing = importReport(rep, [
            { email: lead.email, appointmentOn: '2026-11-04' },
            { email: lead.email, appointmentOn: '2026-11-05' },
          ]);
          importing.catch(() => {});
          await untilBlockedBy(await backendPid(tx));
          await tx`delete from leads where id = ${lead.id}`;
        });
      } finally {
        await other.end();
      }

      expect(await importing).toEqual({
        results: [
          { index: 0, status: 'unmatched' },
          { index: 1, status: 'unmatched' },
        ],
        dealsCreated: 0,
      });
      expect(await dealsOf(lead.id)).toHaveLength(0);
    });
  });

  describe('other organizations and roles', () => {
    it('creates no deal for a lead of another organization', async () => {
      const lead = await leadWithRequest(orgA);

      await expect(confirm(adminB, lead.id, 0, orgB)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(await ensure(lead.id, 'prospect', orgB)).toEqual({
        created: false,
        skipped: 'lead_not_found',
      });
      expect(await dealsOf(lead.id)).toHaveLength(0);
      expect(await requestOf(lead.id)).toMatchObject({ confirmedOn: null });
      expect(await leadOf(lead.id)).toMatchObject({ status: 'new', dealPhase: null });
    });

    it('creates no deal for those who cannot confirm, and shows the deal only to its organization', async () => {
      const lead = await leadWithRequest(orgA);
      await expect(confirm(viewer, lead.id, 0)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(await dealsOf(lead.id)).toHaveLength(0);

      await confirm(rep, lead.id, 0);
      const [deal] = await dealsOf(lead.id);
      expect(deal.organizationId).toBe(orgA);
      await expect(
        adminB.deals.forLead({ organizationId: orgB, leadId: lead.id })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        adminB.deals.get({ organizationId: orgB, dealId: deal.id })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});
