/**
 * Lead follow-up (#136 contact records, #85 next actions) through the routers on a real
 * PostgreSQL: first contact, audit rows, organization isolation, permissions, the dashboard's
 * due list and the next action a hearing's next meeting date creates.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_test \
 *     bunx vitest --run test/unit/integration/lead-follow-up.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import {
  auditLogs,
  leadContactLogs,
  leadTasks,
  leads,
  organizationMembers,
  organizations,
  users,
} from '@/lib/db/schema';
import { firstContactTimes } from '@/lib/features/lead-follow-up/service';
import { jstDate } from '@/lib/features/leads/types/pipeline';
import { appRouter } from '@/server/routers/_app';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

const DAY_MS = 24 * 60 * 60 * 1000;
const dayFromToday = (days: number) => jstDate(new Date(Date.now() + days * DAY_MS));

describe.skipIf(!url)('lead follow-up (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organizationIds: string[] = [];
  let orgA: string;
  let orgB: string;
  let userA: string;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let adminA: any;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let viewerA: any;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let adminB: any;

  async function createOrganization(name: string) {
    const [org] = await pg
      .insert(organizations)
      .values({ name, slug: `follow-${unique()}` })
      .returning();
    organizationIds.push(org.id);
    return org.id;
  }

  async function callerFor(organizationId: string, role: string) {
    const [user] = await pg
      .insert(users)
      .values({ email: `follow-${unique()}@example.com`, name: 'テスト 担当' })
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

  async function createLead(organizationId: string, name = '山田 花子') {
    const [lead] = await pg
      .insert(leads)
      .values({ organizationId, email: `lead-${unique()}@example.co.jp`, name, company: '架空商事' })
      .returning();
    return lead.id;
  }

  const auditRowsOf = (resource: string, resourceId: string) =>
    pg
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.resource, resource), eq(auditLogs.resourceId, resourceId)));

  beforeAll(async () => {
    orgA = await createOrganization('フォローテストA');
    orgB = await createOrganization('フォローテストB');
    const a = await callerFor(orgA, 'admin');
    adminA = a.caller;
    userA = a.userId;
    viewerA = (await callerFor(orgA, 'parent_viewer')).caller;
    adminB = (await callerFor(orgB, 'admin')).caller;
  });

  afterAll(async () => {
    for (const id of organizationIds) {
      await pg.delete(organizations).where(eq(organizations.id, id));
    }
    await client?.end();
  });

  describe('contact records (#136)', () => {
    it('records one tap with an optional note, keeps the earliest as the first contact and audits it', async () => {
      const leadId = await createLead(orgA);
      const empty = await adminA.leadFollowUp.contacts({ organizationId: orgA, leadId });
      expect(empty).toMatchObject({
        firstContactAt: null,
        total: 0,
        noAnswerCount: 0,
        recent: [],
        canEdit: true,
      });

      const first = await adminA.leadFollowUp.recordContact({
        organizationId: orgA,
        leadId,
        kind: 'no_answer',
      });
      const second = await adminA.leadFollowUp.recordContact({
        organizationId: orgA,
        leadId,
        kind: 'call',
        note: '  日程の候補を伺った  ',
      });

      const summary = await viewerA.leadFollowUp.contacts({ organizationId: orgA, leadId });
      expect(summary.total).toBe(2);
      expect(summary.noAnswerCount).toBe(1);
      // "No answer" counts as the first contact time (speed to lead)
      expect(summary.firstContactAt?.getTime()).toBe(first.contactedAt.getTime());
      const times = await firstContactTimes(pg, { organizationId: orgA, leadIds: [leadId] });
      expect(times.get(leadId)?.getTime()).toBe(first.contactedAt.getTime());
      // Scoped by organization
      expect((await firstContactTimes(pg, { organizationId: orgB, leadIds: [leadId] })).size).toBe(0);
      expect(summary.recent.map((r: { id: string }) => r.id)).toEqual([second.id, first.id]);
      expect(summary.recent[0]).toMatchObject({
        kind: 'call',
        note: '日程の候補を伺った',
        createdBy: { id: userA, name: 'テスト 担当' },
      });
      expect(summary.canEdit).toBe(false);

      const [audit] = await auditRowsOf('lead_contact', second.id);
      expect(audit).toMatchObject({
        organizationId: orgA,
        userId: userA,
        action: 'create',
        changes: { after: { kind: 'call', note: '日程の候補を伺った' } },
        metadata: { leadId },
      });

      // The timeline shows them, the earliest marked as the first contact
      const timeline = await viewerA.leadActivity.list({
        organizationId: orgA,
        leadId,
        types: ['contact_recorded'],
        limit: 10,
      });
      expect(
        timeline.items.map((e: { contactKind: string; first: boolean }) => [e.contactKind, e.first])
      ).toEqual([
        ['call', false],
        ['no_answer', true],
      ]);
    });

    it('undoes a wrong tap and moves the first contact to the next record', async () => {
      const leadId = await createLead(orgA);
      const wrong = await adminA.leadFollowUp.recordContact({ organizationId: orgA, leadId, kind: 'email' });
      await adminA.leadFollowUp.deleteContact({ organizationId: orgA, id: wrong.id });

      const summary = await adminA.leadFollowUp.contacts({ organizationId: orgA, leadId });
      expect(summary).toMatchObject({ firstContactAt: null, total: 0 });
      const rows = await auditRowsOf('lead_contact', wrong.id);
      expect(rows.map((r) => r.action).sort()).toEqual(['create', 'delete']);
    });

    it('keeps organizations apart and read-only roles out', async () => {
      const leadId = await createLead(orgA);
      const record = await adminA.leadFollowUp.recordContact({ organizationId: orgA, leadId, kind: 'call' });

      await expect(adminB.leadFollowUp.contacts({ organizationId: orgB, leadId })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(
        adminB.leadFollowUp.recordContact({ organizationId: orgB, leadId, kind: 'call' })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        adminB.leadFollowUp.deleteContact({ organizationId: orgB, id: record.id })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        viewerA.leadFollowUp.recordContact({ organizationId: orgA, leadId, kind: 'call' })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      const rows = await pg.select().from(leadContactLogs).where(eq(leadContactLogs.leadId, leadId));
      expect(rows).toHaveLength(1);
    });
  });

  describe('next actions (#85)', () => {
    it('adds, moves, completes and deletes a next action, auditing only what changed', async () => {
      const leadId = await createLead(orgA);
      const task = await adminA.leadFollowUp.createTask({
        organizationId: orgA,
        leadId,
        title: '資料を送る',
        dueOn: '2026-11-02',
        note: '',
      });
      expect(task).toMatchObject({ title: '資料を送る', note: null, done: false, source: 'manual', assigneeId: null });

      await adminA.leadFollowUp.updateTask({ organizationId: orgA, id: task.id, dueOn: '2026-11-04' });
      // Nothing changes: no audit row
      await adminA.leadFollowUp.updateTask({ organizationId: orgA, id: task.id, dueOn: '2026-11-04' });
      const done = await adminA.leadFollowUp.updateTask({ organizationId: orgA, id: task.id, done: true });
      expect(done.done).toBe(true);
      expect(done.completedAt).toBeInstanceOf(Date);

      const second = await adminA.leadFollowUp.createTask({
        organizationId: orgA,
        leadId,
        title: '見積もりの確認',
        dueOn: '2026-11-10',
      });
      const list = await viewerA.leadFollowUp.tasks({ organizationId: orgA, leadId });
      // Open ones first, then done ones
      expect(list.items.map((t: { id: string }) => t.id)).toEqual([second.id, task.id]);
      expect(list.canEdit).toBe(false);

      const audits = await auditRowsOf('lead_task', task.id);
      expect(audits.map((a) => a.action).sort()).toEqual(['create', 'update', 'update']);
      expect(audits.find((a) => a.action === 'update' && a.changes?.after && 'done' in (a.changes.after as object)))
        .toMatchObject({ changes: { before: { done: false }, after: { done: true } } });

      await adminA.leadFollowUp.deleteTask({ organizationId: orgA, id: second.id });
      const after = await adminA.leadFollowUp.tasks({ organizationId: orgA, leadId });
      expect(after.items).toHaveLength(1);
    });

    it('keeps organizations apart and read-only roles out', async () => {
      const leadId = await createLead(orgA);
      const task = await adminA.leadFollowUp.createTask({
        organizationId: orgA,
        leadId,
        title: '連絡',
        dueOn: '2026-11-02',
      });
      await expect(adminB.leadFollowUp.tasks({ organizationId: orgB, leadId })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(
        adminB.leadFollowUp.createTask({ organizationId: orgB, leadId, title: 'x', dueOn: '2026-11-02' })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        adminB.leadFollowUp.updateTask({ organizationId: orgB, id: task.id, done: true })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(adminB.leadFollowUp.deleteTask({ organizationId: orgB, id: task.id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(
        viewerA.leadFollowUp.updateTask({ organizationId: orgA, id: task.id, done: true })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      const [row] = await pg.select().from(leadTasks).where(eq(leadTasks.id, task.id));
      expect(row.completedAt).toBeNull();
    });

    it("lists the organization's open next actions due today or earlier for the dashboard", async () => {
      const org = await createOrganization('フォローテストC');
      const { caller } = await callerFor(org, 'member');
      const leadId = await createLead(org, '佐藤 一郎');
      const add = (title: string, dueOn: string) =>
        caller.leadFollowUp.createTask({ organizationId: org, leadId, title, dueOn });
      const overdue = await add('期限切れ', dayFromToday(-3));
      const today = await add('今日', dayFromToday(0));
      await add('明日', dayFromToday(1));
      const finished = await add('完了済み', dayFromToday(-1));
      await caller.leadFollowUp.updateTask({ organizationId: org, id: finished.id, done: true });
      // Another organization's overdue task never shows
      const otherLead = await createLead(orgB);
      await adminB.leadFollowUp.createTask({
        organizationId: orgB,
        leadId: otherLead,
        title: '別組織',
        dueOn: dayFromToday(-1),
      });

      const due = await caller.leadFollowUp.dueTasks({ organizationId: org });
      expect(due.total).toBe(2);
      expect(due.items.map((t: { id: string }) => t.id)).toEqual([overdue.id, today.id]);
      expect(due.items[0].lead).toEqual({ name: '佐藤 一郎', company: '架空商事' });
      expect(due.today).toBe(dayFromToday(0));

      // The dashboard lists the first ones; the total still counts all (#431)
      const first = await caller.leadFollowUp.dueTasks({ organizationId: org, limit: 1 });
      expect(first.total).toBe(2);
      expect(first.items.map((t: { id: string }) => t.id)).toEqual([overdue.id]);
    });

    it('lists the first 20 by default and the rest when asked (#431)', async () => {
      const org = await createOrganization('フォローテストD');
      const { caller } = await callerFor(org, 'member');
      const leadId = await createLead(org);
      for (let index = 0; index < 22; index++) {
        await caller.leadFollowUp.createTask({
          organizationId: org,
          leadId,
          title: `期限切れ ${index + 1}`,
          dueOn: dayFromToday(-1),
        });
      }

      const first = await caller.leadFollowUp.dueTasks({ organizationId: org });
      expect(first.total).toBe(22);
      expect(first.items).toHaveLength(20);
      const all = await caller.leadFollowUp.dueTasks({ organizationId: org, limit: 200 });
      expect(all.items).toHaveLength(22);
      // The same order: the opened list starts with the first page
      expect(all.items.slice(0, 20).map((t: { id: string }) => t.id)).toEqual(
        first.items.map((t: { id: string }) => t.id)
      );
    });
  });

  describe('next action from a hearing (#85)', () => {
    const meeting = (date: string) => ({
      nextMeetingDate: { value: date, status: 'done', source: null },
    });

    it('creates one next action at the next meeting date and follows later changes until done', async () => {
      const leadId = await createLead(orgA);
      const hearing = await adminA.leadHearings.create({ organizationId: orgA, leadId, heldOn: '2026-10-16' });
      const tasksOf = async () =>
        (await adminA.leadFollowUp.tasks({ organizationId: orgA, leadId })).items as {
          id: string;
          dueOn: string;
          title: string | null;
          source: string;
          sourceHearingId: string | null;
          done: boolean;
        }[];
      expect(await tasksOf()).toEqual([]);

      let saved = await adminA.leadHearings.update({
        organizationId: orgA,
        id: hearing.id,
        heldOn: '2026-10-16',
        fields: meeting('2026-11-05'),
        expectedUpdatedAt: hearing.updatedAt,
      });
      // Autosave of the same date again: still one
      saved = await adminA.leadHearings.update({
        organizationId: orgA,
        id: hearing.id,
        heldOn: '2026-10-16',
        fields: meeting('2026-11-05'),
        expectedUpdatedAt: saved.updatedAt,
      });
      let tasks = await tasksOf();
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({
        dueOn: '2026-11-05',
        title: null,
        source: 'hearing',
        sourceHearingId: hearing.id,
        done: false,
      });
      const [created] = await auditRowsOf('lead_task', tasks[0].id);
      expect(created).toMatchObject({ action: 'create', userId: userA, metadata: { leadId, via: 'hearing' } });

      // The date moves: the open next action moves with it
      saved = await adminA.leadHearings.update({
        organizationId: orgA,
        id: hearing.id,
        heldOn: '2026-10-16',
        fields: meeting('2026-11-06'),
        expectedUpdatedAt: saved.updatedAt,
      });
      tasks = await tasksOf();
      expect(tasks.map((t) => t.dueOn)).toEqual(['2026-11-06']);

      // A new hearing copies the date of the previous one: no second next action for that date
      await adminA.leadHearings.create({ organizationId: orgA, leadId, heldOn: '2026-10-20' });
      expect(await tasksOf()).toHaveLength(1);

      // Done ones stay as they were
      await adminA.leadFollowUp.updateTask({ organizationId: orgA, id: tasks[0].id, done: true });
      saved = await adminA.leadHearings.update({
        organizationId: orgA,
        id: hearing.id,
        heldOn: '2026-10-16',
        fields: meeting('2026-11-20'),
        expectedUpdatedAt: saved.updatedAt,
      });
      tasks = await tasksOf();
      expect(tasks.map((t) => [t.dueOn, t.done])).toEqual([['2026-11-06', true]]);
    });

    it('makes nothing when the hearing has no next meeting date, and keeps the task when the hearing is deleted', async () => {
      const leadId = await createLead(orgA);
      const hearing = await adminA.leadHearings.create({ organizationId: orgA, leadId, heldOn: '2026-10-16' });
      const saved = await adminA.leadHearings.update({
        organizationId: orgA,
        id: hearing.id,
        heldOn: '2026-10-16',
        fields: { nextMeetingDate: { status: 'next', source: null } },
        expectedUpdatedAt: hearing.updatedAt,
      });
      expect((await adminA.leadFollowUp.tasks({ organizationId: orgA, leadId })).items).toEqual([]);

      await adminA.leadHearings.update({
        organizationId: orgA,
        id: hearing.id,
        heldOn: '2026-10-16',
        fields: meeting('2026-12-01'),
        expectedUpdatedAt: saved.updatedAt,
      });
      await adminA.leadHearings.delete({ organizationId: orgA, id: hearing.id });
      const [task] = (await adminA.leadFollowUp.tasks({ organizationId: orgA, leadId })).items;
      expect(task).toMatchObject({ dueOn: '2026-12-01', sourceHearingId: null, source: 'hearing' });
    });
  });
});
