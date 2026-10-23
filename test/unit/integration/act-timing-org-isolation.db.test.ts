/**
 * Organization isolation of "when to act" (#356) on a real PostgreSQL: an admin of organization
 * B passes the id of A's lead, and changes B's settings. A's lead is not read, and A's settings,
 * "when to act" and next action stay as they were. All values are fictional.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/act-timing-org-isolation.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import { leadTasks, leads, organizationMembers, organizations, users } from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

const done = (value: unknown) => ({ value, status: 'done', source: null });

describe.skipIf(!url)('when to act: organization isolation (PostgreSQL)', () => {
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
  let leadA: string;

  async function callerFor(organizationId: string) {
    const [user] = await pg
      .insert(users)
      .values({ email: `act-iso-${unique()}@example.com`, name: 'テスト' })
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

  const stateOfA = async () => ({
    lead: (await pg.select({ actBy: leads.actBy }).from(leads).where(eq(leads.id, leadA)))[0],
    tasks: await pg
      .select({ title: leadTasks.title, dueOn: leadTasks.dueOn })
      .from(leadTasks)
      .where(and(eq(leadTasks.leadId, leadA), eq(leadTasks.source, 'act_timing'))),
    settings: (await adminA.actTiming.settings({ organizationId: orgA })).settings,
  });

  beforeAll(async () => {
    const created = await pg
      .insert(organizations)
      .values([
        { name: '時期切り分けA', slug: `act-iso-a-${unique()}` },
        { name: '時期切り分けB', slug: `act-iso-b-${unique()}` },
      ])
      .returning({ id: organizations.id });
    orgA = created[0].id;
    orgB = created[1].id;
    adminA = await callerFor(orgA);
    adminB = await callerFor(orgB);

    // A's lead has a "when to act" and its next action, worked out from a hearing
    const [lead] = await pg
      .insert(leads)
      .values({ organizationId: orgA, email: `act-iso-${unique()}@example.co.jp` })
      .returning({ id: leads.id });
    leadA = lead.id;
    const hearing = await adminA.leadHearings.create({
      organizationId: orgA,
      leadId: leadA,
      heldOn: '2026-10-16',
    });
    await adminA.leadHearings.update({
      organizationId: orgA,
      id: hearing.id,
      heldOn: '2026-10-16',
      fields: { hardwareSupportEnd: done('2032-06') },
      expectedUpdatedAt: hearing.updatedAt,
    });
  });

  afterAll(async () => {
    if (orgA) await pg.delete(organizations).where(inArray(organizations.id, [orgA, orgB]));
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  it("refuses B's admin when it names organization A itself", async () => {
    await expect(
      adminB.actTiming.get({ organizationId: orgA, leadId: leadA })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it("reads nothing of A's lead by its id (get)", async () => {
    await expect(
      adminB.actTiming.get({ organizationId: orgB, leadId: leadA })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it("keeps A's settings, when to act and next action when B changes its settings (settings, updateSettings)", async () => {
    const before = await stateOfA();
    expect(before.lead.actBy).toBe('2031-06-01');
    expect(before.tasks).toHaveLength(1);

    const saved = await adminB.actTiming.updateSettings({
      organizationId: orgB,
      settings: { migrationMonths: 24, noticeMonths: 1 },
    });
    // B has no leads: nothing of A is recomputed
    expect(saved.recomputed).toBe(0);
    expect((await adminB.actTiming.settings({ organizationId: orgB })).settings).toEqual({
      migrationMonths: 24,
      noticeMonths: 1,
    });
    expect(await stateOfA()).toEqual(before);
  });
});
