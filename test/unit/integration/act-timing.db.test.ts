/**
 * "When to act" (#151) on a real PostgreSQL: recomputed when a hearing is saved, kept on the
 * lead for the list's sort and filter, a next action due before it (moved with the month, not
 * duplicated, not made again once done), leads won or lost for other reasons left out, the
 * diagnosis estimate, the organization settings and the morning run. All names are made up.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/act-timing.db.test.ts
 */
import type { Database } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import {
  diagnosticSubmissions,
  leadTasks,
  leads,
  organizationMembers,
  organizations,
  users,
} from '@/lib/db/schema';
import { RECOMPUTE_RECENT_DAYS, recomputeRecentlyUpdated } from '@/lib/features/act-timing/service';
import { appRouter } from '@/server/routers/_app';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

const done = (value: unknown) => ({ value, status: 'done', source: null });

/**
 * An update time just inside the morning run's window. The run takes every organization's
 * recently updated leads, oldest first and a batch at a time; other DB tests running at the same
 * time add their own leads, so a lead updated "now" could be left for the next run (#357).
 */
const earliestInWindow = () =>
  new Date(Date.now() - (RECOMPUTE_RECENT_DAYS * 24 * 60 - 1) * 60 * 1000);

describe.skipIf(!url)('when to act (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)! as unknown as Database;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let org: string;
  const userIds: string[] = [];
  // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
  const callers: Record<'admin' | 'member', any> = {} as never;

  async function leadWithHearing(fields: Record<string, unknown>, values: Partial<typeof leads.$inferInsert> = {}) {
    const [lead] = await pg
      .insert(leads)
      .values({ organizationId: org, email: `act-${unique()}@example.co.jp`, company: '架空商事', ...values })
      .returning();
    const hearing = await callers.member.leadHearings.create({
      organizationId: org,
      leadId: lead.id,
      heldOn: '2026-10-16',
    });
    let updatedAt: Date = hearing.updatedAt;
    const save = async (next: Record<string, unknown>) => {
      const saved = await callers.member.leadHearings.update({
        organizationId: org,
        id: hearing.id,
        heldOn: '2026-10-16',
        fields: next,
        expectedUpdatedAt: updatedAt,
      });
      updatedAt = saved.updatedAt;
    };
    await save(fields);
    return { leadId: lead.id as string, save };
  }

  const leadOf = async (leadId: string) =>
    (await pg.select({ actBy: leads.actBy }).from(leads).where(eq(leads.id, leadId)))[0];
  const tasksOf = (leadId: string) =>
    pg
      .select({ id: leadTasks.id, title: leadTasks.title, dueOn: leadTasks.dueOn, completedAt: leadTasks.completedAt })
      .from(leadTasks)
      .where(and(eq(leadTasks.leadId, leadId), eq(leadTasks.source, 'act_timing')));

  beforeAll(async () => {
    const [row] = await pg
      .insert(organizations)
      .values({ name: '動くべき時期テスト', slug: `act-${unique()}` })
      .returning();
    org = row.id;
    for (const role of ['admin', 'member'] as const) {
      const [user] = await pg
        .insert(users)
        .values({ email: `act-${role}-${unique()}@example.com`, name: role })
        .returning();
      userIds.push(user.id);
      await pg.insert(organizationMembers).values({ organizationId: org, userId: user.id, role });
      callers[role] = appRouter.createCaller({
        db: pg,
        session: { session: { id: 's', userId: user.id }, user },
        user,
        // biome-ignore lint/suspicious/noExplicitAny: test context
      } as any);
    }
  });

  afterAll(async () => {
    await pg.delete(organizations).where(eq(organizations.id, org));
    await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  it('works it out when a hearing is saved, with a next action before it', async () => {
    // Support ends 2030-09, retires 2030-03 (earlier): 12 months → 2029-03; told 3 months before
    const { leadId, save } = await leadWithHearing({
      hardwareSupportEnd: done('2030-09'),
      earliestRetirement: done('2030-03'),
    });
    expect(await leadOf(leadId)).toEqual({ actBy: '2029-03-01' });
    let tasks = await tasksOf(leadId);
    expect(tasks).toEqual([
      expect.objectContaining({ title: '動くべき時期（2029年3月）の前に再接触する', dueOn: '2028-12-01' }),
    ]);

    // Saving the same dates again leaves the next action alone
    await save({ hardwareSupportEnd: done('2030-09'), earliestRetirement: done('2030-03') });
    expect((await tasksOf(leadId))[0].id).toBe(tasks[0].id);

    // A fiscal year ending in March moves it back to the budget planning in December
    await save({
      hardwareSupportEnd: done('2030-09'),
      earliestRetirement: done('2030-03'),
      fiscalYearEndMonth: done(3),
    });
    expect(await leadOf(leadId)).toEqual({ actBy: '2028-12-01' });
    tasks = await tasksOf(leadId);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ title: '動くべき時期（2028年12月）の前に再接触する', dueOn: '2028-09-01' });

    const view = await callers.member.actTiming.get({ organizationId: org, leadId });
    expect(view).toMatchObject({
      followed: true,
      timing: { actBy: '2028-12', deadline: { month: '2030-03', source: 'retirement' }, budgetPlanning: '2028-12' },
      task: { dueOn: '2028-09-01', done: false },
    });

    // Dates removed: nothing to work out, the open next action goes
    await save({});
    expect(await leadOf(leadId)).toEqual({ actBy: null });
    expect(await tasksOf(leadId)).toEqual([]);
  });

  it('does not make the next action again once done for that month', async () => {
    const { leadId, save } = await leadWithHearing({ hardwareSupportEnd: done('2031-06') });
    const [task] = await tasksOf(leadId);
    await pg.update(leadTasks).set({ completedAt: new Date() }).where(eq(leadTasks.id, task.id));
    await save({ hardwareSupportEnd: done('2031-06'), budgetStatus: done('planning') });
    expect(await tasksOf(leadId)).toHaveLength(1);
  });

  it('leaves out won leads and leads lost for another reason, but follows lost for timing', async () => {
    const timing = await leadWithHearing({ hardwareSupportEnd: done('2030-09') }, { status: 'lost', lostReason: 'timing' });
    expect(await tasksOf(timing.leadId)).toHaveLength(1);

    const other = await leadWithHearing({ hardwareSupportEnd: done('2030-09') });
    expect(await tasksOf(other.leadId)).toHaveLength(1);
    await pg
      .update(leads)
      .set({ status: 'lost', lostReason: 'budget', updatedAt: earliestInWindow() })
      .where(eq(leads.id, other.leadId));
    // The morning run picks up the status change
    await recomputeRecentlyUpdated(pg);
    expect(await tasksOf(other.leadId)).toEqual([]);
    // "When to act" itself stays on the lead (the list can still show it)
    expect(await leadOf(other.leadId)).toEqual({ actBy: '2029-09-01' });
    expect((await callers.member.actTiming.get({ organizationId: org, leadId: other.leadId })).followed).toBe(false);
  });

  it('estimates from the diagnosis answer through the morning run', async () => {
    const [lead] = await pg
      .insert(leads)
      .values({
        organizationId: org,
        email: `act-${unique()}@example.co.jp`,
        company: '診断だけ商事',
        updatedAt: earliestInWindow(),
      })
      .returning();
    await pg.insert(diagnosticSubmissions).values({
      organizationId: org,
      leadId: lead.id,
      diagnosticKey: 'ax-migration',
      diagnosticVersion: 3,
      answers: { support_end: '1_3y' },
      result: {},
      createdAt: new Date('2026-10-16T00:00:00Z'),
    });
    await recomputeRecentlyUpdated(pg);
    // 2026-10 + 24 months = 2028-10, minus 12 months
    expect(await leadOf(lead.id)).toEqual({ actBy: '2027-10-01' });
  });

  it('sorts and filters the list by it', async () => {
    const result = await callers.member.leads.list({
      organizationId: org,
      actTiming: 'has',
      sortBy: 'actBy',
      sortOrder: 'asc',
      limit: 100,
      offset: 0,
    });
    const dates = (result.items as { actBy: string | null }[]).map((lead) => lead.actBy);
    expect(dates.length).toBeGreaterThan(0);
    expect(dates.every((date) => date !== null)).toBe(true);
    expect([...dates].sort()).toEqual(dates);

    // Support ends in 14 months: act within 2 months, so "soon"
    const near = new Date();
    near.setUTCMonth(near.getUTCMonth() + 14);
    const { leadId: nearLead } = await leadWithHearing({
      hardwareSupportEnd: done(near.toISOString().slice(0, 7)),
    });
    // Within the next 6 months: the near one, none of the far dates
    const soon = await callers.member.leads.list({ organizationId: org, actTiming: 'soon', limit: 100, offset: 0 });
    expect(soon.items.map((lead: { id: string }) => lead.id)).toContain(nearLead);
    expect(soon.items.filter((lead: { actBy: string | null }) => lead.actBy && lead.actBy > '2029-01-01')).toEqual([]);
  });

  it('stops the morning run when its time is up, leaving the rest for the next run', async () => {
    let tick = 0;
    // Each check of the clock moves it on by 6 s: the second lead is past the 10 s budget
    const result = await recomputeRecentlyUpdated(pg, new Date(), { clock: () => (tick += 6000) });
    expect(result.recomputed).toBe(1);
    expect(result.pending).toBeGreaterThan(0);
  });

  it('lets owners and admins change the settings, recomputing the leads', async () => {
    await expect(
      callers.member.actTiming.updateSettings({ organizationId: org, settings: { migrationMonths: 24, noticeMonths: 1 } })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const { leadId } = await leadWithHearing({ hardwareSupportEnd: done('2032-06') });
    expect(await leadOf(leadId)).toEqual({ actBy: '2031-06-01' });
    const saved = await callers.admin.actTiming.updateSettings({
      organizationId: org,
      settings: { migrationMonths: 24, noticeMonths: 1 },
    });
    expect(saved.recomputed).toBeGreaterThan(0);
    expect(await leadOf(leadId)).toEqual({ actBy: '2030-06-01' });
    expect((await tasksOf(leadId)).find((task) => !task.completedAt)).toMatchObject({ dueOn: '2030-05-01' });
    expect((await callers.member.actTiming.settings({ organizationId: org })).settings).toEqual({
      migrationMonths: 24,
      noticeMonths: 1,
    });
    // Other settings are kept
    const [row] = await pg.select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, org));
    expect(row.settings).toMatchObject({ actTiming: { migrationMonths: 24, noticeMonths: 1 } });
  });
});
