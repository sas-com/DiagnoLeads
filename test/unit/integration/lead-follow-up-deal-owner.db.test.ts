/**
 * Next actions added for a deal (#853) on a real PostgreSQL through the routers: whom one is given
 * to (the deal's owner when the lead's assignee is someone else or nobody; nobody when they are
 * the same person, when the deal has no owner, or when its owner may no longer hold leads), where
 * it then shows (the "mine" of 今日 and the dashboard, the due notices), what its audit row keeps,
 * and what is refused: a deal of another lead, of another organization (also one pointing at the
 * lead) or no deal at all, all with one answer, and naming a deal without the right to read
 * deals. All values are fictional.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_test \
 *     bunx vitest --run test/unit/integration/lead-follow-up-deal-owner.db.test.ts
 */
import { canReadDeals } from '@/lib/auth/deal-access';
import type { Database } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import {
  auditLogs,
  deals,
  leadTasks,
  leads,
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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));
// The rule itself, but replaceable for a role kept out of the deals (none exists before #276)
vi.mock('@/lib/auth/deal-access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/deal-access')>();
  return { ...actual, canReadDeals: vi.fn(actual.canReadDeals) };
});

const url = process.env.TEST_DATABASE_URL;

/**
 * The due notices run on a day of their own, far from the real one and from the days of the other
 * files that run them (a run claims the due tasks of every organization): 08:00 JST on 2033-06-15
 */
const RUN_AT = new Date('2033-06-14T23:00:00Z');
const DUE_TOMORROW = '2033-06-16';

type Caller = ReturnType<typeof appRouter.createCaller>;
type CallerContext = Parameters<typeof appRouter.createCaller>[0];
type Role = schema.OrganizationRole;

describe.skipIf(!url)('next actions added for a deal (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  const pg = (client ? drizzle(client, { schema }) : null) as unknown as Database;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organizationIds: string[] = [];
  const userIds: string[] = [];
  let orgA: string;
  let orgB: string;
  // Of A: rep (admin, who adds), leadOwner (a lead's assignee), dealOwner (a deal's owner),
  // viewer (a parent organization's viewer), leaver (a member who left A); outsider is of B only
  const ids = { rep: '', leadOwner: '', dealOwner: '', viewer: '', leaver: '', outsider: '' };
  let rep: Caller;
  let leadOwner: Caller;
  let dealOwner: Caller;
  let viewer: Caller;

  async function createOrganization(name: string) {
    const [org] = await pg
      .insert(organizations)
      .values({ name, slug: `deal-owner-${unique()}` })
      .returning({ id: organizations.id });
    organizationIds.push(org.id);
    return org.id;
  }

  async function createUser(name: string, memberships: { organizationId: string; role: Role }[]) {
    const [user] = await pg
      .insert(users)
      .values({ email: `deal-owner-${unique()}@example.com`, name })
      .returning();
    userIds.push(user.id);
    for (const { organizationId, role } of memberships) {
      await pg.insert(organizationMembers).values({ organizationId, userId: user.id, role });
    }
    return user;
  }

  const callerFor = (user: { id: string; email: string; name: string | null }) =>
    appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId: user.id }, user },
      user,
    } as unknown as CallerContext);

  async function createLead(organizationId: string, assigneeUserId: string | null) {
    const [lead] = await pg
      .insert(leads)
      .values({
        organizationId,
        email: `lead-${unique()}@example.co.jp`,
        name: '山田 花子',
        company: '架空商事',
        assigneeUserId,
      })
      .returning({ id: leads.id });
    return lead.id;
  }

  /** A deal as the database holds it: its owner may have left since it was set */
  async function createDeal(organizationId: string, leadId: string, ownerUserId: string | null) {
    const [deal] = await pg
      .insert(deals)
      .values({ organizationId, leadId, name: '現行調査', ownerUserId })
      .returning({ id: deals.id });
    return deal.id;
  }

  const taskRow = async (id: string) =>
    (await pg.select().from(leadTasks).where(eq(leadTasks.id, id)))[0];
  const tasksOf = (leadId: string) => pg.select().from(leadTasks).where(eq(leadTasks.leadId, leadId));
  const createAuditOf = async (taskId: string) =>
    (
      await pg
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.resource, 'lead_task'),
            eq(auditLogs.resourceId, taskId),
            eq(auditLogs.action, 'create')
          )
        )
    )[0];
  /** The next actions a member sees under "mine" on 今日 and the dashboard (due today or before) */
  const mineOf = async (caller: Caller) =>
    (
      await caller.leadFollowUp.dueTasks({ organizationId: orgA, scope: 'mine', limit: 200 })
    ).items.map((item) => item.id);

  const add = (leadId: string, dealId?: string, dueOn = jstDate()) =>
    rep.leadFollowUp.createTask({
      organizationId: orgA,
      leadId,
      title: '見積もりを送る',
      dueOn,
      ...(dealId ? { dealId } : {}),
    });

  beforeAll(async () => {
    orgA = await createOrganization('商談の次の行動A');
    orgB = await createOrganization('商談の次の行動B');
    const repUser = await createUser('営業 太郎', [{ organizationId: orgA, role: 'admin' }]);
    const leadOwnerUser = await createUser('リード 担当', [{ organizationId: orgA, role: 'member' }]);
    const dealOwnerUser = await createUser('商談 担当', [{ organizationId: orgA, role: 'member' }]);
    const viewerUser = await createUser('親会社 閲覧', [
      { organizationId: orgA, role: 'parent_viewer' },
    ]);
    const leaverUser = await createUser('退職 済み', [{ organizationId: orgA, role: 'member' }]);
    const outsiderUser = await createUser('別組織 花子', [{ organizationId: orgB, role: 'admin' }]);
    ids.rep = repUser.id;
    ids.leadOwner = leadOwnerUser.id;
    ids.dealOwner = dealOwnerUser.id;
    ids.viewer = viewerUser.id;
    ids.leaver = leaverUser.id;
    ids.outsider = outsiderUser.id;
    rep = callerFor(repUser);
    leadOwner = callerFor(leadOwnerUser);
    dealOwner = callerFor(dealOwnerUser);
    viewer = callerFor(viewerUser);
  });

  afterAll(async () => {
    for (const id of organizationIds) {
      await pg.delete(organizations).where(eq(organizations.id, id));
    }
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  it("gives it to the deal's owner when the lead's assignee is someone else, for their 今日", async () => {
    const leadId = await createLead(orgA, ids.leadOwner);
    const dealId = await createDeal(orgA, leadId, ids.dealOwner);

    const task = await add(leadId, dealId);
    const given = { id: ids.dealOwner, name: '商談 担当' };
    expect(task).toMatchObject({ assigneeId: ids.dealOwner, assignee: given });
    expect((await taskRow(task.id)).assigneeId).toBe(ids.dealOwner);
    // The lead's list names whom it is given to
    const list = await rep.leadFollowUp.tasks({ organizationId: orgA, leadId });
    expect(list.items.map((item) => item.assignee)).toEqual([given]);

    // The deal's owner sees it under "mine", the lead's assignee does not
    expect(await mineOf(dealOwner)).toContain(task.id);
    expect(await mineOf(leadOwner)).not.toContain(task.id);

    // The audit row names the deal, and whom it was given to
    const audit = await createAuditOf(task.id);
    expect(audit.metadata).toEqual({ leadId, dealId });
    expect(audit.changes).toEqual({
      after: { title: '見積もりを送る', dueOn: jstDate(), note: null, assigneeId: ids.dealOwner },
    });

    // A change keeps it with them, and still names them
    const done = await rep.leadFollowUp.updateTask({ organizationId: orgA, id: task.id, done: true });
    expect(done).toMatchObject({ done: true, assigneeId: ids.dealOwner, assignee: given });
  });

  it("gives it to the deal's owner when the lead has no assignee, not to whoever adds it", async () => {
    const leadId = await createLead(orgA, null);
    const dealId = await createDeal(orgA, leadId, ids.dealOwner);

    const task = await add(leadId, dealId);
    expect((await taskRow(task.id)).assigneeId).toBe(ids.dealOwner);
    expect(await mineOf(dealOwner)).toContain(task.id);
    expect(await mineOf(rep)).not.toContain(task.id);
  });

  it("leaves it to the lead's assignee when the deal's owner is the same person, or there is none", async () => {
    const leadId = await createLead(orgA, ids.leadOwner);
    const sameOwner = await createDeal(orgA, leadId, ids.leadOwner);
    const noOwner = await createDeal(orgA, leadId, null);

    const same = await add(leadId, sameOwner);
    const unowned = await add(leadId, noOwner);
    const withoutDeal = await add(leadId);
    for (const task of [same, unowned, withoutDeal]) {
      expect(task).toMatchObject({ assigneeId: null, assignee: null });
      expect((await taskRow(task.id)).assigneeId).toBeNull();
    }
    // It follows the lead's assignee, as every other task does
    expect(await mineOf(leadOwner)).toEqual(
      expect.arrayContaining([same.id, unowned.id, withoutDeal.id])
    );

    // The deal is named in the audit row; no assignee was given
    const audit = await createAuditOf(same.id);
    expect(audit.metadata).toEqual({ leadId, dealId: sameOwner });
    expect(audit.changes).toEqual({
      after: { title: '見積もりを送る', dueOn: jstDate(), note: null },
    });
    expect((await createAuditOf(withoutDeal.id)).metadata).toEqual({ leadId });
  });

  it("leaves it to the lead's assignee when the deal's owner may no longer hold leads", async () => {
    const leadId = await createLead(orgA, ids.leadOwner);
    // The owner left the organization after the deal was given to them
    const leaversDeal = await createDeal(orgA, leadId, ids.leaver);
    await pg
      .delete(organizationMembers)
      .where(
        and(eq(organizationMembers.organizationId, orgA), eq(organizationMembers.userId, ids.leaver))
      );
    // A read-only role, and a member of another organization only
    const viewersDeal = await createDeal(orgA, leadId, ids.viewer);
    const outsidersDeal = await createDeal(orgA, leadId, ids.outsider);

    const added = [
      await add(leadId, leaversDeal),
      await add(leadId, viewersDeal),
      await add(leadId, outsidersDeal),
    ];
    for (const task of added) {
      expect((await taskRow(task.id)).assigneeId).toBeNull();
    }
    expect(await mineOf(leadOwner)).toEqual(expect.arrayContaining(added.map((task) => task.id)));
  });

  it('refuses a deal of another lead, of another organization and no deal at all alike, adding nothing', async () => {
    const leadId = await createLead(orgA, ids.leadOwner);
    const otherLead = await createLead(orgA, ids.leadOwner);
    const dealOfOtherLead = await createDeal(orgA, otherLead, ids.dealOwner);
    const leadOfB = await createLead(orgB, ids.outsider);
    const dealOfB = await createDeal(orgB, leadOfB, ids.outsider);
    // A row of B that points at A's lead (the foreign keys do not hold the organizations together)
    const dealOfBOnTheLead = await createDeal(orgB, leadId, ids.dealOwner);

    const answers = [];
    for (const dealId of [dealOfOtherLead, dealOfB, dealOfBOnTheLead, crypto.randomUUID()]) {
      const error = await add(leadId, dealId).then(
        () => null,
        (caught: { code?: string; message?: string }) => ({
          code: caught.code,
          message: caught.message,
        })
      );
      answers.push(error);
    }
    const answer = { code: 'BAD_REQUEST', message: 'The deal is not a deal of the lead' };
    expect(answers).toEqual([answer, answer, answer, answer]);
    expect(await tasksOf(leadId)).toHaveLength(0);

    // Another organization's lead is not found first, with its own deal too
    await expect(add(leadOfB, dealOfB)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await tasksOf(leadOfB)).toHaveLength(0);
  });

  it('needs the right to read deals to name a deal; a viewer adds nothing', async () => {
    const leadId = await createLead(orgA, ids.leadOwner);
    const dealId = await createDeal(orgA, leadId, ids.dealOwner);

    // An admin's abilities kept out of the deals, as the agency accounts of #276 will be
    vi.mocked(canReadDeals).mockReturnValueOnce(false);
    await expect(add(leadId, dealId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await tasksOf(leadId)).toHaveLength(0);
    // Without a deal there is nothing of the deals to read
    const task = await add(leadId);
    expect((await taskRow(task.id)).assigneeId).toBeNull();

    await expect(
      viewer.leadFollowUp.createTask({
        organizationId: orgA,
        leadId,
        title: '見積もりを送る',
        dueOn: jstDate(),
        dealId,
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await tasksOf(leadId)).toHaveLength(1);
  });

  it("sends the due notices to the deal's owner, and those of one left to the lead to its assignee", async () => {
    const leadId = await createLead(orgA, ids.leadOwner);
    const toDealOwner = await add(leadId, await createDeal(orgA, leadId, ids.dealOwner), DUE_TOMORROW);
    const toLeadOwner = await add(leadId, await createDeal(orgA, leadId, ids.leadOwner), DUE_TOMORROW);

    await runDueTaskNotifications(pg, {
      now: RUN_AT,
      deps: { sendEmail: vi.fn(), emailEnabled: () => false, appUrl: '' },
    });
    const notices = await pg
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.organizationId, orgA), eq(notifications.type, 'next_action_due'))
      );
    const recipientOf = (taskId: string) =>
      notices
        .filter((row) => (row.data as { taskId: string }).taskId === taskId)
        .map((row) => row.userId);
    expect(recipientOf(toDealOwner.id)).toEqual([ids.dealOwner]);
    expect(recipientOf(toLeadOwner.id)).toEqual([ids.leadOwner]);
  });
});
