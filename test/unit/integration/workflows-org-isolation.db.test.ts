/**
 * Organization isolation of lead workflows (#356) on a real PostgreSQL: an admin of
 * organization B passes the ids of A's workflow and A's lead. Nothing of A is read, changed,
 * paused or deleted, and B's executions and stats count none of A's runs. All values are
 * fictional.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/workflows-org-isolation.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import {
  leads,
  organizationMembers,
  organizations,
  users,
  workflowExecutions,
  workflows,
} from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('workflows: organization isolation (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let orgA: string;
  let orgB: string;
  const userIds: string[] = [];
  // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
  let adminA: any;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
  let adminB: any;
  let workflowA: string;
  let leadA: string;

  async function callerFor(organizationId: string) {
    const [user] = await pg
      .insert(users)
      .values({ email: `workflows-iso-${unique()}@example.com`, name: 'テスト' })
      .returning();
    userIds.push(user.id);
    await pg.insert(organizationMembers).values({ organizationId, userId: user.id, role: 'admin' });
    return appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId: user.id }, user },
      user,
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);
  }

  const workflowRowOfA = async () =>
    (await pg.select().from(workflows).where(eq(workflows.id, workflowA)))[0];

  beforeAll(async () => {
    const created = await pg
      .insert(organizations)
      .values([
        { name: '自動化切り分けA', slug: `workflows-iso-a-${unique()}` },
        { name: '自動化切り分けB', slug: `workflows-iso-b-${unique()}` },
      ])
      .returning({ id: organizations.id });
    orgA = created[0].id;
    orgB = created[1].id;
    adminA = await callerFor(orgA);
    adminB = await callerFor(orgB);
    const workflow = await adminA.workflows.create({
      organizationId: orgA,
      name: 'A の自動化',
      trigger: 'lead_created',
      actions: [{ type: 'update_score', params: { delta: 10 } }],
    });
    workflowA = workflow.id;
    const [lead] = await pg
      .insert(leads)
      .values({ organizationId: orgA, email: `workflows-iso-${unique()}@example.co.jp` })
      .returning({ id: leads.id });
    leadA = lead.id;
    await pg.insert(workflowExecutions).values({
      workflowId: workflowA,
      organizationId: orgA,
      leadId: leadA,
      trigger: 'lead_created',
      conditionsMatched: true,
      status: 'success',
    });
  });

  afterAll(async () => {
    if (orgA) await pg.delete(organizations).where(inArray(organizations.id, [orgA, orgB]));
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  it("refuses B's admin when it names organization A itself", async () => {
    await expect(adminB.workflows.list({ organizationId: orgA })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it("lists and reads none of A's workflows (list, get)", async () => {
    expect(JSON.stringify(await adminB.workflows.list({ organizationId: orgB }))).not.toContain(
      workflowA
    );
    await expect(
      adminB.workflows.get({ organizationId: orgB, id: workflowA })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it("changes, pauses and deletes nothing of A's workflow by its id (update, toggleStatus, delete)", async () => {
    const before = await workflowRowOfA();
    await expect(
      adminB.workflows.update({ organizationId: orgB, id: workflowA, name: '書き換え' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      adminB.workflows.toggleStatus({ organizationId: orgB, id: workflowA })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      adminB.workflows.delete({ organizationId: orgB, id: workflowA })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await workflowRowOfA()).toEqual(before);
  });

  it("shows and counts none of A's runs, even by A's workflow or lead id (getExecutions, getStats)", async () => {
    for (const filter of [{}, { workflowId: workflowA }, { leadId: leadA }]) {
      const result = await adminB.workflows.getExecutions({ organizationId: orgB, ...filter });
      expect(JSON.stringify(result)).not.toContain(workflowA);
      expect(JSON.stringify(result)).not.toContain(leadA);
    }
    expect(await adminB.workflows.getStats({ organizationId: orgB })).toEqual({
      workflows: { total: 0, active: 0, paused: 0, disabled: 0 },
      executions: { total: 0, success: 0, failed: 0, skipped: 0 },
    });
    // A counts its own workflow and run
    expect(await adminA.workflows.getStats({ organizationId: orgA })).toMatchObject({
      workflows: { total: 1 },
      executions: { total: 1, success: 1 },
    });
  });
});
