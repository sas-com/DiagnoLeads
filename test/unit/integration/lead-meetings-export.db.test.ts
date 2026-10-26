/**
 * Latest hearing in the lead list, the dashboard's meetings and KPI (#137), and the server
 * export (#173) on a real PostgreSQL: which hearing is "latest", the filters and sort, the
 * organization boundary, the KPI math, the 5,000-row cap and the audit row.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_list137 \
 *     bunx vitest --run test/unit/integration/lead-meetings-export.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import {
  auditLogs,
  leadHearings,
  leads,
  organizationMembers,
  organizations,
  users,
} from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

// Thursday 2026-10-15 12:00 JST: the week is Monday 10-12 to Sunday 10-18
const NOW = new Date('2026-10-15T03:00:00Z');

describe.skipIf(!url)('lead meetings and export (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organizationIds: string[] = [];
  const userIds: string[] = [];

  let orgA: string;
  let orgB: string;
  let orgKpi: string;
  let orgExport: string;
  type Member = { id: string; email: string; name: string | null };
  let adminA: Member;
  let salesA: Member;
  let adminB: Member;
  let adminKpi: Member;
  let adminExport: Member;
  const ids: Record<string, string> = {};

  async function createOrganization(name: string) {
    const [org] = await pg
      .insert(organizations)
      .values({ name, slug: `meet-${unique()}` })
      .returning();
    organizationIds.push(org.id);
    return org.id;
  }

  async function createMember(organizationId: string, name: string): Promise<Member> {
    const [user] = await pg
      .insert(users)
      .values({ email: `meet-${unique()}@example.com`, name })
      .returning();
    userIds.push(user.id);
    await pg.insert(organizationMembers).values({ organizationId, userId: user.id, role: 'admin' });
    return { id: user.id, email: user.email, name: user.name };
  }

  function callerFor(member: Member) {
    const user = { id: member.id, email: member.email, name: member.name };
    return appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId: member.id }, user },
      user,
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);
  }

  async function insertLead(organizationId: string, values: Partial<typeof leads.$inferInsert>) {
    const [row] = await pg
      .insert(leads)
      .values({ organizationId, email: `lead-${unique()}@example.com`, status: 'new', ...values })
      .returning();
    return row.id;
  }

  async function hearing(
    organizationId: string,
    leadId: string,
    heldOn: string,
    outcome: { next?: string; rating?: string } = {},
    createdAt?: Date
  ) {
    const fields: Record<string, unknown> = {};
    if (outcome.next) fields.nextMeetingDate = { value: outcome.next, status: 'answered' };
    if (outcome.rating) fields.dealRating = { value: outcome.rating, status: 'answered' };
    await pg.insert(leadHearings).values({
      organizationId,
      leadId,
      heldOn,
      catalogVersion: 1,
      fields,
      ...(createdAt ? { createdAt, updatedAt: createdAt } : {}),
    });
  }

  beforeAll(async () => {
    orgA = await createOrganization('次回日程テストA株式会社');
    orgB = await createOrganization('次回日程テストB株式会社');
    orgKpi = await createOrganization('決定率テスト株式会社');
    orgExport = await createOrganization('書き出しテスト株式会社');
    adminA = await createMember(orgA, '管理 一郎');
    salesA = await createMember(orgA, '営業 花子');
    adminB = await createMember(orgB, '他社 三郎');
    adminKpi = await createMember(orgKpi, '集計 四郎');
    adminExport = await createMember(orgExport, '出力 五郎');

    // Org A
    // latest: same held_on as another hearing but created later -> its values win
    ids.latest = await insertLead(orgA, { company: '最新株式会社', assigneeUserId: salesA.id });
    await hearing(orgA, ids.latest, '2026-10-01', { next: '2026-10-10', rating: 'b' });
    await hearing(
      orgA,
      ids.latest,
      '2026-10-08',
      { next: '2026-10-20', rating: 'a' },
      new Date('2026-10-08T01:00:00Z')
    );
    await hearing(
      orgA,
      ids.latest,
      '2026-10-08',
      { next: '2026-10-30', rating: 'c' },
      new Date('2026-10-08T02:00:00Z')
    );
    ids.overdueWeek = await insertLead(orgA, { company: '超過株式会社' }); // 10-14: overdue, this week
    await hearing(orgA, ids.overdueWeek, '2026-10-07', { next: '2026-10-14', rating: 'a' });
    ids.today = await insertLead(orgA, { company: '今日株式会社' }); // 10-15: today, not overdue
    await hearing(orgA, ids.today, '2026-10-08', { next: '2026-10-15' });
    ids.week = await insertLead(orgA, { company: '今週株式会社', assigneeUserId: salesA.id }); // 10-18
    await hearing(orgA, ids.week, '2026-10-09', { next: '2026-10-18', rating: 'b' });
    // Passed dates on closed leads: never "overdue"
    ids.won = await insertLead(orgA, { company: '受注済み株式会社', status: 'won' });
    await hearing(orgA, ids.won, '2026-09-20', { next: '2026-10-01' });
    ids.lost = await insertLead(orgA, { company: '失注株式会社', status: 'lost' });
    await hearing(orgA, ids.lost, '2026-09-21', { next: '2026-10-02' });
    ids.noHearing = await insertLead(orgA, { company: 'ヒアリングなし株式会社' });
    ids.noDate = await insertLead(orgA, { company: '日程なし株式会社' });
    await hearing(orgA, ids.noDate, '2026-10-09', { rating: 'c' });
    // An old date replaced by a newer hearing without one: not overdue any more
    ids.replaced = await insertLead(orgA, { company: '更新済み株式会社' });
    await hearing(orgA, ids.replaced, '2026-09-20', { next: '2026-10-05', rating: 'a' });
    await hearing(orgA, ids.replaced, '2026-10-05', {});
    // A broken value is ignored
    ids.broken = await insertLead(orgA, { company: '壊れた値株式会社' });
    await hearing(orgA, ids.broken, '2026-10-09', { next: '10月20日', rating: 'z' });
    // A row of another organization pointing at an org A lead is never read
    await hearing(orgB, ids.noHearing, '2026-10-12', { next: '2026-10-13', rating: 'a' });

    // Org B: a meeting this week that org A must not see
    ids.other = await insertLead(orgB, { company: '他社株式会社' });
    await hearing(orgB, ids.other, '2026-10-01', { next: '2026-10-14', rating: 'a' });

    // KPI org, period of 7 days = 10-09 .. 10-15
    const k1 = await insertLead(orgKpi, { company: 'K1' }); // first in period, with next -> both
    await hearing(orgKpi, k1, '2026-10-10', { next: '2026-10-24' });
    const k2 = await insertLead(orgKpi, { company: 'K2' }); // first in period without, later with
    await hearing(orgKpi, k2, '2026-10-12', {});
    await hearing(orgKpi, k2, '2026-10-13', { next: '2026-10-27' });
    const k3 = await insertLead(orgKpi, { company: 'K3' }); // first before the period: out
    await hearing(orgKpi, k3, '2026-10-01', {});
    await hearing(orgKpi, k3, '2026-10-10', { next: '2026-10-20' });
    const k4 = await insertLead(orgKpi, { company: 'K4' }); // first on the last day, with next
    await hearing(orgKpi, k4, '2026-10-15', { next: '2026-10-21' });
    const k5 = await insertLead(orgKpi, { company: 'K5' }); // first on the period's first day, no next
    await hearing(orgKpi, k5, '2026-10-09', {});
    const k6 = await insertLead(orgKpi, { company: 'K6' }); // held in the future: out
    await hearing(orgKpi, k6, '2026-10-20', { next: '2026-10-30' });
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

  const companies = async (input: Record<string, unknown>) => {
    const result = await callerFor(adminA).leads.list({ organizationId: orgA, limit: 100, ...input });
    return result.items.map((lead: { company: string | null }) => lead.company);
  };

  describe('latest hearing (#137)', () => {
    it('reads the latest hearing (held_on, then created_at) of the same organization', async () => {
      const result = await callerFor(adminA).leads.list({ organizationId: orgA, limit: 100 });
      const byId = new Map(
        result.items.map(
          (lead: { id: string; nextMeetingDate: string | null; dealRating: string | null }) =>
            [lead.id, lead] as const
        )
      ) as Map<string, { nextMeetingDate: string | null; dealRating: string | null }>;
      expect(byId.get(ids.latest)).toMatchObject({ nextMeetingDate: '2026-10-30', dealRating: 'c' });
      expect(byId.get(ids.replaced)).toMatchObject({ nextMeetingDate: null, dealRating: null });
      expect(byId.get(ids.broken)).toMatchObject({ nextMeetingDate: null, dealRating: null });
      // The other organization's row is ignored
      expect(byId.get(ids.noHearing)).toMatchObject({ nextMeetingDate: null, dealRating: null });

      const lead = await callerFor(adminA).leads.get({ organizationId: orgA, id: ids.overdueWeek });
      expect(lead).toMatchObject({ nextMeetingDate: '2026-10-14', dealRating: 'a' });
    });

    it('filters by next meeting within the organization', async () => {
      expect((await companies({ nextMeeting: 'has' })).sort()).toEqual(
        ['今日株式会社', '今週株式会社', '最新株式会社', '超過株式会社', '受注済み株式会社', '失注株式会社'].sort()
      );
      expect((await companies({ nextMeeting: 'none' })).sort()).toEqual(
        ['ヒアリングなし株式会社', '日程なし株式会社', '更新済み株式会社', '壊れた値株式会社'].sort()
      );
      expect(await companies({ nextMeeting: 'overdue' })).toEqual(['超過株式会社']);
      expect(
        await companies({ nextMeeting: 'thisWeek', sortBy: 'nextMeetingDate', sortOrder: 'asc' })
      ).toEqual(['超過株式会社', '今日株式会社', '今週株式会社']);
    });

    it('filters by rating and sorts with the empty ones last', async () => {
      expect((await companies({ dealRating: ['a'] })).sort()).toEqual(['超過株式会社']);
      expect((await companies({ dealRating: ['b', 'c'] })).sort()).toEqual(
        ['今週株式会社', '日程なし株式会社', '最新株式会社'].sort()
      );
      const byDate = await companies({ sortBy: 'nextMeetingDate', sortOrder: 'asc' });
      expect(byDate.slice(0, 6)).toEqual([
        '受注済み株式会社',
        '失注株式会社',
        '超過株式会社',
        '今日株式会社',
        '今週株式会社',
        '最新株式会社',
      ]);
      const byDateDesc = await companies({ sortBy: 'nextMeetingDate', sortOrder: 'desc' });
      expect(byDateDesc.slice(0, 4)).toEqual(['最新株式会社', '今週株式会社', '今日株式会社', '超過株式会社']);
      const byRating = await companies({ sortBy: 'dealRating', sortOrder: 'asc' });
      expect(byRating.slice(0, 4)).toEqual(['超過株式会社', '今週株式会社', expect.any(String), expect.any(String)]);
      expect(byRating.slice(2, 4).sort()).toEqual(['日程なし株式会社', '最新株式会社'].sort());
    });

    it('never shows another organization’s leads', async () => {
      const result = await callerFor(adminB).leads.list({
        organizationId: orgB,
        nextMeeting: 'thisWeek',
      });
      expect(result.items.map((lead: { id: string }) => lead.id)).toEqual([ids.other]);
      // Org B's member cannot read org A
      await expect(
        callerFor(adminB).leads.list({ organizationId: orgA, nextMeeting: 'has' })
      ).rejects.toThrow();
    });
  });

  describe('dashboard (#137)', () => {
    it('lists this week’s meetings earliest first, with assignee and rating', async () => {
      const result = await callerFor(adminA).leads.weekMeetings({ organizationId: orgA });
      expect(result).toMatchObject({
        weekStart: '2026-10-12',
        weekEnd: '2026-10-18',
        today: '2026-10-15',
        total: 3,
      });
      expect(result.items).toEqual([
        {
          leadId: ids.overdueWeek,
          name: null,
          company: '超過株式会社',
          status: 'new',
          nextMeetingDate: '2026-10-14',
          dealRating: 'a',
          assignee: null,
        },
        {
          leadId: ids.today,
          name: null,
          company: '今日株式会社',
          status: 'new',
          nextMeetingDate: '2026-10-15',
          dealRating: null,
          assignee: null,
        },
        {
          leadId: ids.week,
          name: null,
          company: '今週株式会社',
          status: 'new',
          nextMeetingDate: '2026-10-18',
          dealRating: 'b',
          assignee: { id: salesA.id, name: '営業 花子', email: salesA.email },
        },
      ]);
    });

    it('computes the next meeting rate of first meetings in the period', async () => {
      const result = await callerFor(adminKpi).leads.nextMeetingRate({
        organizationId: orgKpi,
        days: 7,
      });
      // First meetings in 10-09..10-15: K1 (next), K2 (none at first), K4 (next), K5 (none)
      expect(result).toEqual({
        from: '2026-10-09',
        to: '2026-10-15',
        firstMeetings: 4,
        withNextMeeting: 2,
        rate: 0.5,
      });
      // 30 days also include K3's first meeting (10-01, none)
      const month = await callerFor(adminKpi).leads.nextMeetingRate({
        organizationId: orgKpi,
        days: 30,
      });
      expect(month).toMatchObject({ firstMeetings: 5, withNextMeeting: 2, rate: 0.4 });
    });

    it('has no rate without first meetings', async () => {
      const result = await callerFor(adminExport).leads.nextMeetingRate({
        organizationId: orgExport,
        days: 7,
      });
      expect(result).toMatchObject({ firstMeetings: 0, withNextMeeting: 0, rate: null });
    });
  });

  describe('export (#173)', () => {
    it('writes the matching leads in the list order and logs it without personal data', async () => {
      const result = await callerFor(adminA).leads.export({
        organizationId: orgA,
        format: 'json',
        nextMeeting: 'thisWeek',
        search: '株式会社',
        sortBy: 'nextMeetingDate',
        sortOrder: 'asc',
      });
      expect(result).toMatchObject({ rowCount: 3, total: 3, capped: false });
      const rows = JSON.parse(result.content);
      expect(rows.map((row: { company: string }) => row.company)).toEqual([
        '超過株式会社',
        '今日株式会社',
        '今週株式会社',
      ]);
      expect(rows[2]).toMatchObject({ assignee: '営業 花子', dealRating: 'b' });

      const [log] = await pg
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.organizationId, orgA), eq(auditLogs.action, 'export')));
      expect(log).toMatchObject({
        userId: adminA.id,
        resource: 'lead',
        resourceId: null,
        metadata: {
          format: 'json',
          rowCount: 3,
          total: 3,
          capped: false,
          sortBy: 'nextMeetingDate',
          sortOrder: 'asc',
          filters: { nextMeeting: 'thisWeek', search: true },
        },
      });
      expect(JSON.stringify(log.metadata)).not.toContain('株式会社');
    });

    it('stops at 5,000 rows and says how many matched', async () => {
      const values = Array.from({ length: 5003 }, (_, i) => ({
        organizationId: orgExport,
        email: `bulk-${i}-${unique()}@example.com`,
        status: 'new',
        score: i % 100,
      }));
      for (let i = 0; i < values.length; i += 1000) {
        await pg.insert(leads).values(values.slice(i, i + 1000));
      }
      const result = await callerFor(adminExport).leads.export({
        organizationId: orgExport,
        format: 'csv',
        sortBy: 'score',
        sortOrder: 'desc',
      });
      expect(result).toMatchObject({ rowCount: 5000, total: 5003, capped: true, maxRows: 5000 });
      const lines = result.content.trimEnd().split('\r\n');
      expect(lines).toHaveLength(5001);
      // Highest scores first
      expect(lines[1].split(',')[7]).toBe('99');

      const logs = await pg
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.organizationId, orgExport), eq(auditLogs.action, 'export')));
      expect(logs).toHaveLength(1);
      expect(logs[0].metadata).toMatchObject({ format: 'csv', rowCount: 5000, total: 5003, capped: true });
    });

    it('does not export another organization', async () => {
      await expect(
        callerFor(adminB).leads.export({ organizationId: orgA, format: 'csv' })
      ).rejects.toThrow();
      const logs = await pg
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.organizationId, orgA), eq(auditLogs.userId, adminB.id)));
      expect(logs).toHaveLength(0);
    });
  });
});
