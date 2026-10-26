/**
 * Visits and online meetings in the contact records (#554) through the routers on a real
 * PostgreSQL: the time, duration, outcome and deal of a record, where it is shown (the lead,
 * its activity and the deal page) and to whom, what is refused, and what happens when the deal
 * or the lead goes away.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_test \
 *     bunx vitest --run test/unit/integration/lead-contact-activities.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import {
  auditLogs,
  leadContactLogs,
  leads,
  organizationMembers,
  organizations,
  users,
} from '@/lib/db/schema';
import { getDashboardSummary } from '@/lib/features/analytics/dashboard';
import { appRouter } from '@/server/routers/_app';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

const HOUR_MS = 60 * 60 * 1000;

describe.skipIf(!url)('visits and online meetings in the contact records (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organizationIds: string[] = [];
  let orgA: string;
  let userA: string;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let adminA: any;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let viewerA: any;

  async function createOrganization(name: string) {
    const [org] = await pg
      .insert(organizations)
      .values({ name, slug: `activity-${unique()}` })
      .returning();
    organizationIds.push(org.id);
    return org.id;
  }

  async function callerFor(organizationId: string, role: schema.OrganizationRole) {
    const [user] = await pg
      .insert(users)
      .values({ email: `activity-${unique()}@example.com`, name: 'テスト 営業' })
      .returning();
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
    return lead.id;
  }

  const createDeal = async (organizationId: string, leadId: string, name: string) =>
    adminA.deals.create({ organizationId, leadId, name }) as Promise<{ id: string }>;

  const contactRow = async (id: string) =>
    (await pg.select().from(leadContactLogs).where(eq(leadContactLogs.id, id)))[0];

  const auditOf = (id: string) =>
    pg
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.resource, 'lead_contact'), eq(auditLogs.resourceId, id)));

  beforeAll(async () => {
    orgA = await createOrganization('活動テストA');
    const a = await callerFor(orgA, 'admin');
    adminA = a.caller;
    userA = a.userId;
    viewerA = (await callerFor(orgA, 'parent_viewer')).caller;
  });

  afterAll(async () => {
    for (const id of organizationIds) {
      await pg.delete(organizations).where(eq(organizations.id, id));
    }
    await client?.end();
  });

  it('records a visit at a past time with its duration, outcome and deal, on the lead and the deal page', async () => {
    const leadId = await createLead(orgA);
    const deal = await createDeal(orgA, leadId, '現行システムの調査');
    const heldAt = new Date(Date.now() - 2 * 24 * HOUR_MS);

    const visit = await adminA.leadFollowUp.recordContact({
      organizationId: orgA,
      leadId,
      kind: 'visit',
      contactedAt: heldAt,
      durationMinutes: 90,
      outcome: 'advanced',
      dealId: deal.id,
      note: '  現行の帳票を見せてもらった  ',
    });
    expect(visit).toMatchObject({ kind: 'visit', durationMinutes: 90, outcome: 'advanced' });
    expect(visit.contactedAt.getTime()).toBe(heldAt.getTime());
    expect(await contactRow(visit.id)).toMatchObject({
      dealId: deal.id,
      note: '現行の帳票を見せてもらった',
      createdBy: userA,
    });

    // The lead page: the first contact is the visit's time, not when it was entered
    const summary = await viewerA.leadFollowUp.contacts({ organizationId: orgA, leadId });
    expect(summary.firstContactAt?.getTime()).toBe(heldAt.getTime());
    expect(summary.recent[0]).toMatchObject({
      kind: 'visit',
      durationMinutes: 90,
      outcome: 'advanced',
    });
    expect(summary.recent[0]).not.toHaveProperty('dealId');

    // The activity names the deal to those who may read deals, never to the parent organization
    const activityOf = async (caller: typeof adminA) =>
      (
        await caller.leadActivity.list({
          organizationId: orgA,
          leadId,
          types: ['contact_recorded'],
          limit: 10,
        })
      ).items;
    expect(await activityOf(adminA)).toEqual([
      expect.objectContaining({
        contactKind: 'visit',
        durationMinutes: 90,
        outcome: 'advanced',
        deal: { id: deal.id, name: '現行システムの調査' },
        first: true,
        actor: { id: userA, name: 'テスト 営業' },
      }),
    ]);
    expect(await activityOf(viewerA)).toEqual([
      expect.objectContaining({ contactKind: 'visit', deal: null }),
    ]);

    // The deal page lists the deal's records only
    await adminA.leadFollowUp.recordContact({ organizationId: orgA, leadId, kind: 'call' });
    const page = await adminA.leadActivity.forDeal({ organizationId: orgA, dealId: deal.id });
    expect(page).toMatchObject({ total: 1, canEdit: true });
    // Every record of the page is of this deal, so none names it
    expect(page.items[0].deal).toBeNull();
    expect(page.items.map((e: { contactId: string }) => e.contactId)).toEqual([visit.id]);
    // Another organization's deal: lead-contacts-org-isolation.db.test.ts
    await expect(
      viewerA.leadActivity.forDeal({ organizationId: orgA, dealId: deal.id })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    // The audit row keeps what was recorded, but not the note's text
    const [audit] = await auditOf(visit.id);
    expect(audit.changes).toEqual({
      after: {
        kind: 'visit',
        contactedAt: heldAt.toISOString(),
        durationMinutes: 90,
        outcome: 'advanced',
        dealId: deal.id,
        hasNote: true,
      },
    });
    await adminA.leadFollowUp.deleteContact({ organizationId: orgA, id: visit.id });
    const rows = await auditOf(visit.id);
    expect(rows.map((row) => row.action).sort()).toEqual(['create', 'delete']);
    expect(JSON.stringify(rows.map((row) => row.changes))).not.toContain('帳票');
  });

  it('refuses the deal of another lead, a time in the future and details of a no answer', async () => {
    const leadId = await createLead(orgA);
    const otherLeadId = await createLead(orgA, { name: '別のリード' });
    const dealOfOtherLead = await createDeal(orgA, otherLeadId, '別のリードの商談');
    const base = { organizationId: orgA, leadId, kind: 'online_meeting' as const };

    // Another organization's deal: lead-contacts-org-isolation.db.test.ts
    await expect(
      adminA.leadFollowUp.recordContact({ ...base, dealId: dealOfOtherLead.id })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      adminA.leadFollowUp.recordContact({ ...base, contactedAt: new Date(Date.now() + HOUR_MS) })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      adminA.leadFollowUp.recordContact({
        ...base,
        contactedAt: new Date('1999-12-31T00:00:00+09:00'),
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      adminA.leadFollowUp.recordContact({ ...base, kind: 'no_answer', durationMinutes: 5 })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      adminA.leadFollowUp.recordContact({ ...base, durationMinutes: 24 * 60 + 1 })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(
      await pg.select().from(leadContactLogs).where(eq(leadContactLogs.leadId, leadId))
    ).toHaveLength(0);

    // A screen whose clock runs a minute ahead records now, never a time in the future
    const before = Date.now();
    const ahead = await adminA.leadFollowUp.recordContact({
      ...base,
      contactedAt: new Date(before + 60 * 1000),
    });
    expect(ahead.contactedAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(ahead.contactedAt.getTime()).toBeGreaterThanOrEqual(before);

    // The database holds the same rules
    await expect(
      pg.insert(leadContactLogs).values({
        organizationId: orgA,
        leadId,
        kind: 'no_answer',
        outcome: 'no_change',
      })
    ).rejects.toThrow();
    await expect(
      pg.insert(leadContactLogs).values({ organizationId: orgA, leadId, kind: 'meeting' })
    ).rejects.toThrow();
  });

  it('keeps the records of a deleted deal without the deal, and ends the wait for the first contact', async () => {
    const waitingNames = async () =>
      (await getDashboardSummary(pg, orgA, 7)).pendingConsultations.map((row) => row.name);
    const leadId = await createLead(orgA, {
      name: 'オンライン商談で連絡',
      conversionPoint: 'consultation',
    });
    const waiting = await createLead(orgA, { name: '不通だけ', conversionPoint: 'consultation' });
    const deal = await createDeal(orgA, leadId, '消す商談');
    expect(await waitingNames()).toEqual(expect.arrayContaining(['オンライン商談で連絡', '不通だけ']));

    // An online meeting reached the person: the request is not waiting any more. "No answer" is
    // still waiting (#136)
    const meeting = await adminA.leadFollowUp.recordContact({
      organizationId: orgA,
      leadId,
      kind: 'online_meeting',
      durationMinutes: 30,
      outcome: 'no_change',
      dealId: deal.id,
    });
    await adminA.leadFollowUp.recordContact({ organizationId: orgA, leadId: waiting, kind: 'no_answer' });
    const names = await waitingNames();
    expect(names).toContain('不通だけ');
    expect(names).not.toContain('オンライン商談で連絡');

    await adminA.deals.delete({ organizationId: orgA, dealId: deal.id });
    expect(await contactRow(meeting.id)).toMatchObject({ dealId: null, durationMinutes: 30 });
  });

  describe('a deal or a lead deleted while a contact is recorded', () => {
    async function untilBlockedBy(pid: number) {
      for (let i = 0; i < 60; i++) {
        const [row] = await pg.execute<{ waiting: number }>(
          sql`select count(*)::int as waiting from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))`
        );
        if (row && row.waiting > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    const backendPid = async (tx: postgres.TransactionSql) => {
      const [row] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid`;
      return row.pid;
    };

    const outcome = (promise: Promise<unknown>) =>
      promise.then(
        () => 'done',
        (error: { code?: string }) => error.code
      );

    it('refuses the contact of a deal deleted meanwhile, rather than a database error', async () => {
      const leadId = await createLead(orgA);
      const deal = await createDeal(orgA, leadId, '同時に消す商談');
      // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
      const other = postgres(url!, { max: 1 });
      let recorded: Promise<unknown> = Promise.resolve();
      try {
        await other.begin(async (tx) => {
          await tx`delete from deals where id = ${deal.id}`;
          recorded = outcome(
            adminA.leadFollowUp.recordContact({
              organizationId: orgA,
              leadId,
              kind: 'visit',
              dealId: deal.id,
            })
          );
          await untilBlockedBy(await backendPid(tx));
        });
      } finally {
        await other.end();
      }

      expect(await recorded).toBe('BAD_REQUEST');
      expect(
        await pg.select().from(leadContactLogs).where(eq(leadContactLogs.leadId, leadId))
      ).toHaveLength(0);
    });

    it('finds no lead deleted meanwhile, rather than a database error', async () => {
      const leadId = await createLead(orgA);
      // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
      const other = postgres(url!, { max: 1 });
      let recorded: Promise<unknown> = Promise.resolve();
      try {
        await other.begin(async (tx) => {
          await tx`delete from leads where id = ${leadId}`;
          recorded = outcome(
            adminA.leadFollowUp.recordContact({ organizationId: orgA, leadId, kind: 'call' })
          );
          await untilBlockedBy(await backendPid(tx));
        });
      } finally {
        await other.end();
      }

      expect(await recorded).toBe('NOT_FOUND');
    });
  });
});
