/**
 * Takeaways, the dashboard's "mine / everyone" and the due notices of the follow-up (#85) on a
 * real PostgreSQL: whom to check with, who is responsible (task assignee, else the lead's
 * assignee, else the creator), notices once per due date (also with two runs at once), the
 * member's setting, test mode email filtering, and a moved due date getting its own notices.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_test \
 *     bunx vitest --run test/unit/integration/lead-follow-up-takeaways.db.test.ts
 */
import type { Database } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import {
  auditLogs,
  leadTasks,
  leads,
  notificationPreferences,
  notifications,
  organizationMembers,
  organizations,
  users,
} from '@/lib/db/schema';
import { runDueTaskNotifications } from '@/lib/features/lead-follow-up/due-notifications';
import { jstDate } from '@/lib/features/leads/types/pipeline';
import { appRouter } from '@/server/routers/_app';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

const DAY_MS = 24 * 60 * 60 * 1000;
const dayFromToday = (days: number) => jstDate(new Date(Date.now() + days * DAY_MS));
/** The notice runs use a fixed day far from the real one: 08:00 JST on 2031-03-11 */
const RUN_AT = new Date('2031-03-10T23:00:00Z');
const TODAY = '2031-03-11';
const runAt = (days: number) => new Date(RUN_AT.getTime() + days * DAY_MS);

describe.skipIf(!url)('lead follow-up takeaways and due notices (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 4 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)! as unknown as Database;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organizationIds: string[] = [];
  const userIds: string[] = [];
  let org: string;
  let otherOrg: string;
  // Members of org: rep (admin, the caller), owner (a lead's assignee), assignee (a task's
  // assignee), quiet (setting off), checker (whom to check with); outsider is in otherOrg only
  const ids: Record<'rep' | 'owner' | 'assignee' | 'quiet' | 'checker' | 'outsider', string> = {
    rep: '',
    owner: '',
    assignee: '',
    quiet: '',
    checker: '',
    outsider: '',
  };
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let rep: any;
  const sendEmail = vi.fn().mockResolvedValue({ id: 'mail' });
  const run = (at: Date) =>
    runDueTaskNotifications(pg, {
      now: at,
      deps: { sendEmail, emailEnabled: () => true, appUrl: 'https://app.example.com' },
    });

  async function createOrganization(name: string) {
    const [row] = await pg
      .insert(organizations)
      .values({ name, slug: `takeaway-${unique()}` })
      .returning();
    organizationIds.push(row.id);
    return row.id;
  }

  async function createMember(
    organizationId: string,
    name: string,
    domain: string,
    role: schema.OrganizationRole = 'member'
  ) {
    const [user] = await pg
      .insert(users)
      .values({ email: `takeaway-${unique()}@${domain}`, name })
      .returning();
    userIds.push(user.id);
    await pg.insert(organizationMembers).values({ organizationId, userId: user.id, role });
    return user;
  }

  async function createLead(assigneeUserId: string | null = null) {
    const [lead] = await pg
      .insert(leads)
      .values({
        organizationId: org,
        email: `lead-${unique()}@example.co.jp`,
        name: '山田 花子',
        company: '架空商事',
        assigneeUserId,
      })
      .returning();
    return lead.id;
  }

  async function createTask(values: {
    dueOn: string;
    title?: string;
    leadAssignee?: string | null;
    assigneeId?: string | null;
    createdBy?: string | null;
    done?: boolean;
    kind?: 'next_action' | 'takeaway';
    checkWith?: string;
    checkWithUserId?: string;
  }) {
    const leadId = await createLead(values.leadAssignee ?? null);
    const [task] = await pg
      .insert(leadTasks)
      .values({
        organizationId: org,
        leadId,
        title: values.title ?? '見積もりを送る',
        dueOn: values.dueOn,
        assigneeId: values.assigneeId ?? null,
        createdBy: values.createdBy === undefined ? ids.rep : values.createdBy,
        completedAt: values.done ? new Date() : null,
        kind: values.kind ?? 'next_action',
        checkWith: values.checkWith ?? null,
        checkWithUserId: values.checkWithUserId ?? null,
      })
      .returning();
    return task;
  }

  const noticesOf = (taskIds: string[]) =>
    pg
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.organizationId, org), eq(notifications.type, 'next_action_due'))
      )
      .then((rows) =>
        rows.filter((row) => taskIds.includes((row.data as { taskId: string }).taskId))
      );

  beforeAll(async () => {
    org = await createOrganization('持ち帰りテスト');
    otherOrg = await createOrganization('持ち帰りテスト（別組織）');
    const repUser = await createMember(org, '営業 太郎', 'example.com', 'admin');
    ids.rep = repUser.id;
    ids.owner = (await createMember(org, '担当 花子', 'outside.example.org')).id;
    ids.assignee = (await createMember(org, '担当 次郎', 'example.com')).id;
    ids.quiet = (await createMember(org, '静か 三郎', 'example.com')).id;
    ids.checker = (await createMember(org, '技術 四郎', 'example.com')).id;
    ids.outsider = (await createMember(otherOrg, '別組織 五郎', 'example.com')).id;
    await pg
      .insert(notificationPreferences)
      .values({ userId: ids.quiet, organizationId: org, inAppNextActionDue: false });
    rep = appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId: repUser.id }, user: repUser },
      user: repUser,
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);
  });

  beforeEach(() => {
    sendEmail.mockClear();
    // Test mode: only example.com is mailed
    vi.stubEnv('APP_TEST_MODE', 'true');
    vi.stubEnv('APP_TEST_MODE_EMAIL_DOMAINS', 'example.com');
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    for (const id of organizationIds) {
      await pg.delete(organizations).where(eq(organizations.id, id));
    }
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  describe('takeaways', () => {
    it('records whom to check with, as a member or as text, and tells them apart from next actions', async () => {
      const leadId = await createLead();
      const member = await rep.leadFollowUp.createTask({
        organizationId: org,
        leadId,
        kind: 'takeaway',
        title: '保守費用の内訳を回答する',
        dueOn: dayFromToday(3),
        checkWithUserId: ids.checker,
      });
      expect(member).toMatchObject({
        kind: 'takeaway',
        checkWith: null,
        checkWithUser: { id: ids.checker, name: '技術 四郎' },
      });
      await rep.leadFollowUp.createTask({
        organizationId: org,
        leadId,
        kind: 'takeaway',
        title: '導入事例を送る',
        dueOn: dayFromToday(4),
        checkWith: '広報部',
      });
      await rep.leadFollowUp.createTask({
        organizationId: org,
        leadId,
        title: '電話する',
        dueOn: dayFromToday(5),
      });

      const { items } = await rep.leadFollowUp.tasks({ organizationId: org, leadId });
      expect(
        items.map((task: { title: string; kind: string; checkWith: string | null; checkWithUser: { name: string } | null }) => [
          task.title,
          task.kind,
          task.checkWithUser?.name ?? task.checkWith,
        ])
      ).toEqual([
        ['保守費用の内訳を回答する', 'takeaway', '技術 四郎'],
        ['導入事例を送る', 'takeaway', '広報部'],
        ['電話する', 'next_action', null],
      ]);
      const [audit] = await pg
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.resource, 'lead_task'), eq(auditLogs.resourceId, member.id)));
      expect(audit.changes).toMatchObject({
        after: { kind: 'takeaway', checkWithUserId: ids.checker },
      });
    });

    it('refuses someone outside the organization, and clears whom to check with on a next action', async () => {
      const leadId = await createLead();
      await expect(
        rep.leadFollowUp.createTask({
          organizationId: org,
          leadId,
          kind: 'takeaway',
          title: '確認する',
          dueOn: dayFromToday(1),
          checkWithUserId: ids.outsider,
        })
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

      const task = await rep.leadFollowUp.createTask({
        organizationId: org,
        leadId,
        kind: 'takeaway',
        title: '確認する',
        dueOn: dayFromToday(1),
        checkWith: '法務',
      });
      const member = await rep.leadFollowUp.updateTask({
        organizationId: org,
        id: task.id,
        checkWithUserId: ids.checker,
      });
      expect(member).toMatchObject({ checkWith: null, checkWithUser: { id: ids.checker } });
      await expect(
        rep.leadFollowUp.updateTask({ organizationId: org, id: task.id, checkWithUserId: ids.outsider })
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      const next = await rep.leadFollowUp.updateTask({
        organizationId: org,
        id: task.id,
        kind: 'next_action',
      });
      expect(next).toMatchObject({ kind: 'next_action', checkWith: null, checkWithUser: null });
    });

    it('is kept to the known kinds by the database', async () => {
      const leadId = await createLead();
      await expect(
        pg.insert(leadTasks).values({ organizationId: org, leadId, dueOn: TODAY, kind: 'memo' })
      ).rejects.toThrow();
    });
  });

  describe('dashboard: mine / everyone', () => {
    it("lists the user's own (task assignee, else lead assignee, else creator) and everyone's with the user's first", async () => {
      const yesterday = dayFromToday(-1);
      const assigned = await createTask({
        dueOn: yesterday,
        title: '自分に割り当て',
        assigneeId: ids.rep,
        createdBy: ids.owner,
        leadAssignee: ids.owner,
      });
      const viaLead = await createTask({
        dueOn: yesterday,
        title: 'リードの担当が自分',
        leadAssignee: ids.rep,
        createdBy: ids.owner,
      });
      const created = await createTask({ dueOn: yesterday, title: '自分が作成' });
      const othersLead = await createTask({
        dueOn: dayFromToday(-2),
        title: 'リードの担当は別の人',
        leadAssignee: ids.owner,
      });
      const othersTask = await createTask({
        dueOn: dayFromToday(-3),
        title: '別の人に割り当て',
        assigneeId: ids.assignee,
      });

      const mine = await rep.leadFollowUp.dueTasks({ organizationId: org });
      const mineIds = mine.items.map((task: { id: string }) => task.id);
      expect(mine.scope).toBe('mine');
      expect(mineIds).toEqual(expect.arrayContaining([assigned.id, viaLead.id, created.id]));
      expect(mineIds).not.toContain(othersLead.id);
      expect(mineIds).not.toContain(othersTask.id);
      expect(mine.items.every((task: { mine: boolean }) => task.mine)).toBe(true);
      expect(mine.total).toBe(mine.counts.mine);

      const all = await rep.leadFollowUp.dueTasks({ organizationId: org, scope: 'all' });
      const order = all.items.map((task: { id: string; mine: boolean }) => [task.id, task.mine]);
      const firstOther = order.findIndex(([, isMine]: [string, boolean]) => !isMine);
      const lastMine = order.map(([, isMine]: [string, boolean]) => isMine).lastIndexOf(true);
      expect(lastMine).toBeLessThan(firstOther);
      expect(order.map(([id]: [string]) => id)).toEqual(
        expect.arrayContaining([othersLead.id, othersTask.id])
      );
      expect(all.total).toBe(all.counts.all);
      expect(all.counts.all).toBeGreaterThan(all.counts.mine);
    });
  });

  describe('due notices', () => {
    it('tells the responsible member once per due date, following their setting and test mode', async () => {
      const tomorrow = '2031-03-12';
      const toAssignee = await createTask({ dueOn: tomorrow, assigneeId: ids.assignee });
      const toLeadOwner = await createTask({ dueOn: '2031-03-10', leadAssignee: ids.owner });
      const toCreator = await createTask({ dueOn: tomorrow });
      const takeaway = await createTask({
        dueOn: TODAY,
        title: '保守費用の内訳を回答する',
        kind: 'takeaway',
        checkWithUserId: ids.checker,
      });
      const done = await createTask({ dueOn: tomorrow, done: true });
      const later = await createTask({ dueOn: '2031-03-13' });
      const old = await createTask({ dueOn: '2031-03-01' });
      const outsider = await createTask({ dueOn: tomorrow, assigneeId: ids.outsider });
      const quiet = await createTask({ dueOn: tomorrow, assigneeId: ids.quiet });
      const nobody = await createTask({ dueOn: tomorrow, createdBy: null });
      const all = [toAssignee, toLeadOwner, toCreator, takeaway, done, later, old, outsider, quiet, nobody].map(
        (task) => task.id
      );

      const first = await run(RUN_AT);
      expect(first.today).toBe(TODAY);
      const notices = await noticesOf(all);
      const byTask = new Map(notices.map((row) => [(row.data as { taskId: string }).taskId, row]));
      expect(byTask.get(toAssignee.id)?.userId).toBe(ids.assignee);
      expect(byTask.get(toLeadOwner.id)).toMatchObject({ userId: ids.owner });
      expect(byTask.get(toLeadOwner.id)?.title).toMatch(/^【期限切れ・次の行動】/);
      expect(byTask.get(toCreator.id)).toMatchObject({ userId: ids.rep });
      expect(byTask.get(toCreator.id)?.title).toMatch(/^【明日が期限・次の行動】/);
      expect(byTask.get(takeaway.id)?.title).toBe(
        '【今日が期限・持ち帰り事項】保守費用の内訳を回答する（架空商事 山田 花子 様）'
      );
      expect(byTask.get(takeaway.id)?.message).toContain('確認先：技術 四郎');
      // Done, later, too old, someone outside, setting off, nobody responsible: no notice
      for (const task of [done, later, old, outsider, quiet, nobody]) {
        expect(byTask.has(task.id)).toBe(false);
      }
      expect(notices).toHaveLength(4);

      // Email: one per member, only to the test mode domain (the lead owner is outside it)
      const mailed = sendEmail.mock.calls.map(([options]) => options.to[0] as string);
      const emailOf = async (id: string) =>
        (await pg.select({ email: users.email }).from(users).where(eq(users.id, id)))[0].email;
      expect(mailed).toEqual(
        expect.arrayContaining([await emailOf(ids.assignee), await emailOf(ids.rep)])
      );
      expect(mailed).not.toContain(await emailOf(ids.owner));
      expect(mailed).not.toContain(await emailOf(ids.quiet));
      // The rep has two tasks in one email
      const repEmail = await emailOf(ids.rep);
      expect(mailed.filter((to) => to === repEmail)).toHaveLength(1);
      const repMail = sendEmail.mock.calls.find(([options]) => options.to[0] === repEmail)?.[0];
      expect(repMail.text).toContain('保守費用の内訳を回答する');
      expect(repMail.text).toContain('見積もりを送る');

      // Run again the same day, and twice at once: nothing new
      sendEmail.mockClear();
      await run(RUN_AT);
      await Promise.all([run(runAt(0.01)), run(runAt(0.02))]);
      expect(await noticesOf(all)).toHaveLength(4);
      expect(sendEmail).not.toHaveBeenCalled();

      // Next day (03-12): what was due soon is due today, already told. New: the takeaway due
      // 03-11 is now overdue, and the task due 03-13 is now due tomorrow
      await run(runAt(1));
      const nextDay = await noticesOf(all);
      expect(nextDay).toHaveLength(6);
      const added = nextDay.filter((row) => !notices.some((first) => first.id === row.id));
      expect(
        added.map((row) => {
          const data = row.data as { taskId: string; notice: string };
          return [data.taskId, data.notice];
        })
      ).toEqual(
        expect.arrayContaining([
          [takeaway.id, 'overdue'],
          [later.id, 'due_soon'],
        ])
      );

      // The day after the due date: overdue, once
      await run(runAt(2));
      await run(runAt(2));
      const overdue = (await noticesOf([toAssignee.id, toCreator.id, takeaway.id])).filter(
        (row) => (row.data as { notice: string }).notice === 'overdue'
      );
      expect(overdue.map((row) => (row.data as { taskId: string }).taskId).sort()).toEqual(
        [toAssignee.id, toCreator.id, takeaway.id].sort()
      );
      // The lead owner's overdue task was told on the first run only
      expect(await noticesOf([toLeadOwner.id])).toHaveLength(1);
    });

    it('gives a moved due date its own notices', async () => {
      const task = await createTask({ dueOn: '2031-03-12', assigneeId: ids.assignee });
      await run(RUN_AT);
      expect(await noticesOf([task.id])).toHaveLength(1);

      await rep.leadFollowUp.updateTask({ organizationId: org, id: task.id, dueOn: '2031-03-20' });
      const [moved] = await pg.select().from(leadTasks).where(eq(leadTasks.id, task.id));
      expect(moved.notifiedDueAt).toBeNull();
      expect(moved.notifiedOverdueAt).toBeNull();

      await run(runAt(8)); // 2031-03-19, the day before the new date
      await run(runAt(8));
      expect(await noticesOf([task.id])).toHaveLength(2);
    });

    it('sends no email when email is not configured, and keeps the in-app notice', async () => {
      const task = await createTask({ dueOn: '2031-03-12', assigneeId: ids.assignee });
      await runDueTaskNotifications(pg, {
        now: RUN_AT,
        deps: { sendEmail, emailEnabled: () => false, appUrl: '' },
      });
      expect(await noticesOf([task.id])).toHaveLength(1);
      expect(sendEmail).not.toHaveBeenCalled();
    });
  });
});
