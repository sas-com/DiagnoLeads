/**
 * 今日 (#556) on a real PostgreSQL through the tRPC routers: the member's own next actions,
 * meetings, contacts of the day and deals that need attention, and nothing of another
 * organization (the same member is in A and B, with rows of their own in B), of a colleague, or
 * of another day. Rows that point across organizations (a hearing, a confirmed meeting or a
 * contact of one organization on the other's lead or deal) are never read. All values are
 * fictional.
 *
 * Thursday 2026-10-29 12:00 in Japan: the week runs from Monday 10-26 to Sunday 11-01.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/today-org-isolation.db.test.ts
 */
import { dealsNeedingAttention } from '@/components/features/today/today-format';
import * as schema from '@/lib/db/schema';
import {
  deals,
  leadContactLogs,
  leadHearings,
  leadTasks,
  leads,
  meetingRequests,
  organizationMembers,
  organizations,
  users,
} from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { TRPCError } from '@trpc/server';
import { inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

type Caller = ReturnType<typeof appRouter.createCaller>;
type CallerContext = Parameters<typeof appRouter.createCaller>[0];
type MyDayInput = Parameters<Caller['leadActivity']['myDay']>[0];
type MeetingsInput = Parameters<Caller['leads']['myMeetings']>[0];

// Thursday 2026-10-29 12:00 in Japan
const NOW = new Date('2026-10-29T03:00:00Z');
/** An instant given as Japan wall time ('2026-10-29T00:00:00.000') */
const jst = (local: string) => new Date(`${local}+09:00`);

/** The input as a caller can send it over HTTP: declared fields plus keys of its own choosing */
const withUnknownKeys = <T extends object>(input: T, unknownKeys: Record<string, unknown>): T =>
  Object.assign({}, input, unknownKeys);

/** 'ok', or the tRPC error code the call failed with */
async function outcome(call: Promise<unknown>): Promise<string> {
  try {
    await call;
    return 'ok';
  } catch (error) {
    return error instanceof TRPCError ? error.code : String(error);
  }
}

describe.skipIf(!url)('今日: the member’s own day, one organization at a time (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  const pg = client
    ? drizzle(client, { schema })
    : (null as unknown as ReturnType<typeof drizzle<typeof schema>>);
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organizationIds: string[] = [];
  const userIds: string[] = [];
  /** Leads and deals by the name the tests use */
  const ids: Record<string, string> = {};
  /** Names by id, so a failure reads "L1" rather than a uuid */
  const nameOf = (id: string) =>
    Object.entries(ids).find(([, value]) => value === id)?.[0] ?? id;

  let orgA: string;
  let orgB: string;
  let me: string;
  let colleague: string;
  let viewer: string;
  let meInA: Caller;
  let meInB: Caller;
  let colleagueInA: Caller;
  let viewerInA: Caller;
  let outsiderInA: Caller;

  async function createOrganization(name: string) {
    const [org] = await pg
      .insert(organizations)
      .values({ name, slug: `today-iso-${unique()}` })
      .returning({ id: organizations.id });
    organizationIds.push(org.id);
    return org.id;
  }

  type Role = NonNullable<(typeof organizationMembers.$inferInsert)['role']>;

  async function createUser(name: string, memberships: { organizationId: string; role: Role }[]) {
    const [user] = await pg
      .insert(users)
      .values({ email: `today-iso-${unique()}@example.com`, name })
      .returning();
    userIds.push(user.id);
    for (const { organizationId, role } of memberships) {
      await pg.insert(organizationMembers).values({ organizationId, userId: user.id, role });
    }
    return user;
  }

  function callerFor(user: { id: string; email: string; name: string | null }) {
    return appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId: user.id }, user },
      user,
    } as unknown as CallerContext);
  }

  async function lead(
    name: string,
    organizationId: string,
    values: Partial<typeof leads.$inferInsert> = {}
  ) {
    const [row] = await pg
      .insert(leads)
      .values({
        organizationId,
        email: `today-${unique()}@example.co.jp`,
        company: `架空商事 ${name}`,
        status: 'nurturing',
        ...values,
      })
      .returning({ id: leads.id });
    ids[name] = row.id;
    return row.id;
  }

  /** A hearing that sets the next meeting date, recorded by `by` */
  async function hearing(
    organizationId: string,
    leadId: string,
    next: string,
    by: string,
    { heldOn = '2026-10-20', rating }: { heldOn?: string; rating?: string } = {}
  ) {
    const fields: Record<string, unknown> = { nextMeetingDate: { value: next, status: 'answered' } };
    if (rating) fields.dealRating = { value: rating, status: 'answered' };
    await pg.insert(leadHearings).values({
      organizationId,
      leadId,
      heldOn,
      catalogVersion: 1,
      fields,
      createdBy: by,
    });
  }

  /** The first meeting, confirmed by `by` from the respondent's preferred dates */
  async function confirmedMeeting(
    organizationId: string,
    leadId: string,
    on: string,
    time: string,
    by: string
  ) {
    await pg.insert(meetingRequests).values({
      organizationId,
      leadId,
      candidates: [{ date: on, time }],
      confirmedOn: on,
      confirmedTime: time,
      confirmedAt: jst('2026-10-20T10:00:00.000'),
      confirmedBy: by,
    });
  }

  async function contact(
    name: string,
    values: Omit<typeof leadContactLogs.$inferInsert, 'kind'> & { kind?: string }
  ) {
    const [row] = await pg
      .insert(leadContactLogs)
      .values({ kind: 'call', ...values })
      .returning({ id: leadContactLogs.id });
    ids[name] = row.id;
  }

  async function deal(name: string, values: Omit<typeof deals.$inferInsert, 'name'>) {
    const [row] = await pg
      .insert(deals)
      .values({ name: `案件 ${name}`, ...values })
      .returning({ id: deals.id });
    ids[name] = row.id;
  }

  async function task(name: string, values: Omit<typeof leadTasks.$inferInsert, 'title'>) {
    const [row] = await pg
      .insert(leadTasks)
      .values({ title: `タスク ${name}`, ...values })
      .returning({ id: leadTasks.id });
    ids[name] = row.id;
  }

  beforeAll(async () => {
    orgA = await createOrganization('今日の分離A');
    orgB = await createOrganization('今日の分離B');
    const meUser = await createUser('営業 一郎', [
      { organizationId: orgA, role: 'member' },
      { organizationId: orgB, role: 'admin' },
    ]);
    const colleagueUser = await createUser('営業 花子', [{ organizationId: orgA, role: 'member' }]);
    const viewerUser = await createUser('親会社 三郎', [
      { organizationId: orgA, role: 'parent_viewer' },
    ]);
    const outsiderUser = await createUser('部外 四郎', []);
    me = meUser.id;
    colleague = colleagueUser.id;
    viewer = viewerUser.id;
    meInA = callerFor(meUser);
    meInB = callerFor(meUser);
    colleagueInA = callerFor(colleagueUser);
    viewerInA = callerFor(viewerUser);
    outsiderInA = callerFor(outsiderUser);

    // --- Meetings (org A) ---
    // Assigned to me: mine whoever set the date. The hearing's date with the confirmed first
    // meeting on the same day: that meeting's time
    await lead('L1', orgA, { assigneeUserId: me });
    await hearing(orgA, ids.L1, '2026-10-29', colleague, { rating: 'a' });
    await confirmedMeeting(orgA, ids.L1, '2026-10-29', '14:00', colleague);
    // Only the confirmed first meeting, on Sunday (the last day of the week)
    await lead('L2', orgA, { assigneeUserId: me });
    await confirmedMeeting(orgA, ids.L2, '2026-11-01', '10:30', colleague);
    // A passed day of this week, and next Monday: neither
    await lead('L3', orgA, { assigneeUserId: me });
    await hearing(orgA, ids.L3, '2026-10-28', me);
    await lead('L4', orgA, { assigneeUserId: me });
    await hearing(orgA, ids.L4, '2026-11-02', me);
    // Nobody assigned: the meeting belongs to whoever set the date
    await lead('L5', orgA);
    await hearing(orgA, ids.L5, '2026-10-30', me);
    await lead('L6', orgA);
    await hearing(orgA, ids.L6, '2026-10-30', colleague);
    await lead('L7', orgA);
    await confirmedMeeting(orgA, ids.L7, '2026-10-29', '09:00', me);
    // Assigned to the colleague: theirs, although I set the date
    await lead('L8', orgA, { assigneeUserId: colleague });
    await hearing(orgA, ids.L8, '2026-10-29', me);
    // A won lead keeps its meeting, as on the dashboard
    await lead('L9', orgA, { assigneeUserId: me, status: 'won' });
    await hearing(orgA, ids.L9, '2026-10-31', colleague);
    // The hearing's date is another day than the confirmed first meeting: no time
    await lead('L10', orgA, { assigneeUserId: me });
    await hearing(orgA, ids.L10, '2026-11-01', me);
    await confirmedMeeting(orgA, ids.L10, '2026-10-29', '11:00', me);
    // The latest hearing's author set the date (an older one of mine does not count)
    await lead('L11', orgA);
    await hearing(orgA, ids.L11, '2026-10-30', me, { heldOn: '2026-10-20' });
    await hearing(orgA, ids.L11, '2026-10-31', colleague, { heldOn: '2026-10-27' });
    // Today without a time: after the ones with a time (an org B first meeting gives none)
    await lead('L14', orgA, { assigneeUserId: me });
    await hearing(orgA, ids.L14, '2026-10-29', colleague);
    await confirmedMeeting(orgB, ids.L14, '2026-10-29', '15:00', me);
    // Dated in A by the colleague; a later hearing of mine is in org B
    await lead('L15', orgA);
    await hearing(orgA, ids.L15, '2026-10-30', colleague, { heldOn: '2026-10-20' });
    await hearing(orgB, ids.L15, '2026-10-31', me, { heldOn: '2026-10-27' });
    // Org B rows on org A leads nobody is assigned to: never read
    await lead('L12', orgA);
    await hearing(orgB, ids.L12, '2026-10-30', me);
    await lead('L13', orgA);
    await confirmedMeeting(orgB, ids.L13, '2026-10-29', '15:00', me);

    // --- Org B: my own meeting, contact, deal and next action there ---
    await lead('LB1', orgB, { assigneeUserId: me });
    await hearing(orgB, ids.LB1, '2026-10-29', me);

    // --- Deals ---
    // Mine: past the close date (L1 has open next actions), and no next action (L2 has none)
    await deal('D1', {
      organizationId: orgA,
      leadId: ids.L1,
      ownerUserId: me,
      stage: 'proposal',
      expectedCloseOn: '2026-10-20',
    });
    await deal('D2', {
      organizationId: orgA,
      leadId: ids.L2,
      ownerUserId: me,
      stage: 'discovery',
      expectedCloseOn: '2026-11-30',
    });
    // Mine without a mark, and closed today (never marked)
    await deal('D3', {
      organizationId: orgA,
      leadId: ids.L1,
      ownerUserId: me,
      stage: 'negotiation',
      expectedCloseOn: '2026-11-15',
    });
    await deal('D5', {
      organizationId: orgA,
      leadId: ids.L2,
      ownerUserId: me,
      stage: 'won',
      expectedCloseOn: '2026-10-01',
      closedOn: '2026-10-29',
    });
    // The colleague's, and mine in org B
    await deal('D4', {
      organizationId: orgA,
      leadId: ids.L2,
      ownerUserId: colleague,
      stage: 'proposal',
      expectedCloseOn: '2026-10-01',
    });
    await deal('DB1', {
      organizationId: orgB,
      leadId: ids.LB1,
      ownerUserId: me,
      stage: 'proposal',
      expectedCloseOn: '2026-10-01',
    });

    // --- Next actions ---
    await task('T1', { organizationId: orgA, leadId: ids.L1, assigneeId: me, dueOn: '2026-10-29' });
    // Nobody assigned to the task or the lead: whoever created it
    await task('T2', { organizationId: orgA, leadId: ids.L5, createdBy: me, dueOn: '2026-10-28' });
    await task('T3', {
      organizationId: orgA,
      leadId: ids.L1,
      assigneeId: colleague,
      dueOn: '2026-10-29',
    });
    await task('T4', { organizationId: orgA, leadId: ids.L1, assigneeId: me, dueOn: '2026-10-30' });
    await task('T6', {
      organizationId: orgA,
      leadId: ids.L1,
      assigneeId: me,
      dueOn: '2026-10-29',
      completedAt: jst('2026-10-29T09:00:00.000'),
    });
    await task('TB1', { organizationId: orgB, leadId: ids.LB1, assigneeId: me, dueOn: '2026-10-29' });

    // --- Contacts ---
    const mine = { organizationId: orgA, createdBy: me };
    // Today from 0:00 to the last moment before tomorrow (Japan)
    await contact('C1', { ...mine, leadId: ids.L1, contactedAt: jst('2026-10-29T00:00:00.000') });
    await contact('C2', {
      ...mine,
      leadId: ids.L1,
      kind: 'no_answer',
      contactedAt: jst('2026-10-29T23:59:59.999'),
    });
    await contact('C5', {
      ...mine,
      leadId: ids.L1,
      kind: 'online_meeting',
      durationMinutes: 60,
      outcome: 'advanced',
      dealId: ids.D1,
      note: '移行の範囲を確認した',
      contactedAt: jst('2026-10-29T10:00:00.000'),
    });
    // A deal of org B named on an org A record: the deal is not shown
    await contact('C6', {
      ...mine,
      leadId: ids.L2,
      kind: 'visit',
      durationMinutes: 30,
      dealId: ids.DB1,
      contactedAt: jst('2026-10-29T11:00:00.000'),
    });
    // Yesterday's last moment and tomorrow's first: not today
    await contact('C3', {
      ...mine,
      leadId: ids.L1,
      kind: 'visit',
      durationMinutes: 45,
      contactedAt: jst('2026-10-28T23:59:59.999'),
    });
    await contact('C4', {
      ...mine,
      leadId: ids.L1,
      kind: 'email',
      contactedAt: jst('2026-10-30T00:00:00.000'),
    });
    // The colleague's
    await contact('C7', {
      organizationId: orgA,
      createdBy: colleague,
      leadId: ids.L1,
      contactedAt: jst('2026-10-29T12:00:00.000'),
    });
    // Mine in org B, and an org A record on an org B lead (read in neither)
    await contact('C8', {
      organizationId: orgB,
      createdBy: me,
      leadId: ids.LB1,
      durationMinutes: 15,
      contactedAt: jst('2026-10-29T09:00:00.000'),
    });
    await contact('C9', { ...mine, leadId: ids.LB1, contactedAt: jst('2026-10-29T09:30:00.000') });
    // An org B record of mine on an org A lead (read in neither)
    await contact('C11', {
      organizationId: orgB,
      createdBy: me,
      leadId: ids.L1,
      contactedAt: jst('2026-10-29T09:45:00.000'),
    });
    // The parent organization's viewer, with a deal they may not read
    await contact('C10', {
      organizationId: orgA,
      createdBy: viewer,
      leadId: ids.L1,
      kind: 'email',
      dealId: ids.D1,
      contactedAt: jst('2026-10-29T08:00:00.000'),
    });
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => vi.useRealTimers());

  afterAll(async () => {
    if (!client) return;
    if (organizationIds.length > 0) {
      await pg.delete(organizations).where(inArray(organizations.id, organizationIds));
    }
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client.end();
  });

  describe('meetings (leads.myMeetings)', () => {
    const summary = (items: { leadId: string }[]) => items.map((item) => nameOf(item.leadId));

    it('lists my meetings from today to Sunday, soonest first, timed ones first within a day', async () => {
      const result = await meInA.leads.myMeetings({ organizationId: orgA });

      expect(summary(result.items)).toEqual(['L7', 'L1', 'L14', 'L5', 'L9', 'L2', 'L10']);
      expect(result).toMatchObject({ today: '2026-10-29', weekEnd: '2026-11-01', total: 7 });
    });

    it('gives the confirmed first meeting’s time when it is on the meeting date', async () => {
      const { items } = await meInA.leads.myMeetings({ organizationId: orgA });
      const byLead = Object.fromEntries(items.map((item) => [nameOf(item.leadId), item]));

      expect(byLead.L7).toMatchObject({
        nextMeetingDate: '2026-10-29',
        nextMeetingTime: '09:00',
        firstMeeting: true,
        unassigned: true,
      });
      // The hearing's date, with the first meeting confirmed for the same day
      expect(byLead.L1).toMatchObject({
        nextMeetingTime: '14:00',
        firstMeeting: false,
        dealRating: 'a',
      });
      expect(byLead.L2).toMatchObject({
        nextMeetingDate: '2026-11-01',
        nextMeetingTime: '10:30',
        firstMeeting: true,
        unassigned: false,
      });
      // The first meeting is on another day than the hearing's date: no time
      expect(byLead.L10).toMatchObject({
        nextMeetingDate: '2026-11-01',
        nextMeetingTime: null,
        firstMeeting: false,
      });
      expect(byLead.L9).toMatchObject({ status: 'won' });
      // A first meeting confirmed in another organization gives no time
      expect(byLead.L14).toMatchObject({ nextMeetingTime: null, firstMeeting: false });
    });

    it('gives a meeting nobody is assigned to whoever set its date, and the colleague theirs', async () => {
      const colleagues = await colleagueInA.leads.myMeetings({ organizationId: orgA });

      // L8 is assigned to the colleague (I set its date); L15, L6 and L11 were dated by them
      // (L15 and L6 on the same day without a time: by company)
      expect(summary(colleagues.items)).toEqual(['L8', 'L15', 'L6', 'L11']);
    });

    it('reads only the organization asked for, for a member of both', async () => {
      const inB = await meInB.leads.myMeetings({ organizationId: orgB });

      expect(summary(inB.items)).toEqual(['LB1']);
      expect(inB.total).toBe(1);
    });

    it('lists nothing for a viewer without meetings', async () => {
      const result = await viewerInA.leads.myMeetings({ organizationId: orgA });

      expect(result).toMatchObject({ total: 0, items: [] });
    });

    it('refuses a userId added to the input', async () => {
      const result = await outcome(
        meInA.leads.myMeetings(
          withUnknownKeys<MeetingsInput>({ organizationId: orgA }, { userId: colleague })
        )
      );

      expect(result).toBe('BAD_REQUEST');
    });
  });

  describe('contacts of the day (leadActivity.myDay)', () => {
    it('lists the contacts I recorded today in Japan, newest first, with their leads', async () => {
      const result = await meInA.leadActivity.myDay({ organizationId: orgA });

      expect(result.day).toBe('2026-10-29');
      expect(result.items.map((item) => nameOf(item.event.contactId))).toEqual([
        'C2',
        'C6',
        'C5',
        'C1',
      ]);
      expect(result.items[2]).toMatchObject({
        lead: { id: ids.L1, company: '架空商事 L1' },
        event: {
          kind: 'contact_recorded',
          contactKind: 'online_meeting',
          durationMinutes: 60,
          outcome: 'advanced',
          note: '移行の範囲を確認した',
          deal: { id: ids.D1, name: '案件 D1' },
          actor: null,
          first: false,
        },
      });
    });

    it('counts every kind, no answers included, and sums the minutes of today only', async () => {
      const result = await meInA.leadActivity.myDay({ organizationId: orgA });

      expect(result).toMatchObject({
        total: 4,
        byKind: { call: 1, email: 0, visit: 1, online_meeting: 1, no_answer: 1 },
        durationMinutes: 90,
      });
    });

    it('does not name a deal of another organization', async () => {
      const result = await meInA.leadActivity.myDay({ organizationId: orgA });
      const visit = result.items.find((item) => item.event.contactId === ids.C6);

      expect(visit?.event.deal).toBeNull();
    });

    it('reads only the organization asked for, for a member of both', async () => {
      const inB = await meInB.leadActivity.myDay({ organizationId: orgB });

      expect(inB.items.map((item) => nameOf(item.event.contactId))).toEqual(['C8']);
      expect(inB).toMatchObject({ total: 1, durationMinutes: 15 });
    });

    it('shows the colleague only their own', async () => {
      const result = await colleagueInA.leadActivity.myDay({ organizationId: orgA });

      expect(result.items.map((item) => nameOf(item.event.contactId))).toEqual(['C7']);
    });

    it('hides the deal from a viewer who may not read deals', async () => {
      const result = await viewerInA.leadActivity.myDay({ organizationId: orgA });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].event).toMatchObject({ contactId: ids.C10, deal: null });
    });

    it('refuses a userId added to the input', async () => {
      const result = await outcome(
        meInA.leadActivity.myDay(
          withUnknownKeys<MyDayInput>({ organizationId: orgA }, { userId: colleague })
        )
      );

      expect(result).toBe('BAD_REQUEST');
    });
  });

  describe('next actions (leadFollowUp.dueTasks, mine)', () => {
    it('lists the next actions I am responsible for, due today or earlier, in this organization', async () => {
      const result = await meInA.leadFollowUp.dueTasks({ organizationId: orgA, scope: 'mine' });

      expect(result.items.map((item) => nameOf(item.id))).toEqual(['T2', 'T1']);
      expect(result.counts).toEqual({ mine: 2, all: 3 });
    });

    it('reads only the organization asked for, for a member of both', async () => {
      const inB = await meInB.leadFollowUp.dueTasks({ organizationId: orgB, scope: 'mine' });

      expect(inB.items.map((item) => nameOf(item.id))).toEqual(['TB1']);
    });
  });

  describe('deals that need attention (deals.board, mine)', () => {
    const boardInput = (organizationId: string) => ({
      organizationId,
      owner: 'mine' as const,
      closedWithinDays: 0,
    });

    it('marks my deals past their close date first, then those without a next action', async () => {
      const board = await meInA.deals.board(boardInput(orgA));
      const cards = board.columns.flatMap((column) => column.deals);

      expect(cards.map((card) => nameOf(card.id)).sort()).toEqual(['D1', 'D2', 'D3', 'D5']);
      expect(
        dealsNeedingAttention(cards, board.today).map(({ deal, flags }) => [nameOf(deal.id), flags])
      ).toEqual([
        ['D1', { overdue: true, noNextAction: false }],
        ['D2', { overdue: false, noNextAction: true }],
      ]);
    });

    it('reads only the organization asked for, for a member of both', async () => {
      const board = await meInB.deals.board(boardInput(orgB));

      expect(board.columns.flatMap((column) => column.deals.map((card) => nameOf(card.id)))).toEqual([
        'DB1',
      ]);
    });

    it('refuses a viewer from the parent organization, who may not read deals', async () => {
      expect(await outcome(viewerInA.deals.board(boardInput(orgA)))).toBe('FORBIDDEN');
    });
  });

  it('takes the day in Japan: just after midnight it is already the new day', async () => {
    // 2026-10-29 00:10 in Japan is still 10-28 in UTC
    vi.setSystemTime(jst('2026-10-29T00:10:00.000'));

    const contacts = await meInA.leadActivity.myDay({ organizationId: orgA });
    const meetings = await meInA.leads.myMeetings({ organizationId: orgA });

    expect(contacts.day).toBe('2026-10-29');
    expect(contacts.items.map((item) => nameOf(item.event.contactId))).toEqual([
      'C2',
      'C6',
      'C5',
      'C1',
    ]);
    expect(meetings.today).toBe('2026-10-29');
    expect(meetings.items.map((item) => nameOf(item.leadId))).not.toContain('L3');
  });

  it('refuses every section to someone outside the organization', async () => {
    const results = await Promise.all([
      outcome(outsiderInA.leads.myMeetings({ organizationId: orgA })),
      outcome(outsiderInA.leadActivity.myDay({ organizationId: orgA })),
      outcome(outsiderInA.leadFollowUp.dueTasks({ organizationId: orgA, scope: 'mine' })),
      outcome(outsiderInA.deals.board({ organizationId: orgA, owner: 'mine' })),
    ]);

    expect(results).toEqual(['FORBIDDEN', 'FORBIDDEN', 'FORBIDDEN', 'FORBIDDEN']);
  });
});
