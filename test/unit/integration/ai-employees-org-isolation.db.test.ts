/**
 * AI employees (#1101) on a real PostgreSQL: who may hire and manage them, one per role, the
 * office read from the runs, and the isolation between organizations (an admin of B passes the
 * ids of A's employee: NOT_FOUND, and A's rows stay as they were). All values are fictional.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/ai-employees-org-isolation.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import {
  aiEmployeeRuns,
  aiEmployees,
  organizationMembers,
  organizations,
  users,
} from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('AI employees: permissions and organization isolation (PostgreSQL)', () => {
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
  let memberA: any;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
  let adminB: any;
  let employeeA: string;

  async function callerFor(organizationId: string, role: 'admin' | 'member') {
    const [user] = await pg
      .insert(users)
      .values({ email: `ai-emp-${unique()}@example.com`, name: 'テスト' })
      .returning();
    userIds.push(user.id);
    await pg.insert(organizationMembers).values({ organizationId, userId: user.id, role });
    return appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId: user.id }, user },
      user,
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);
  }

  const rowOfA = async () =>
    (
      await pg
        .select({ name: aiEmployees.name, status: aiEmployees.status })
        .from(aiEmployees)
        .where(eq(aiEmployees.id, employeeA))
    )[0];

  beforeAll(async () => {
    const created = await pg
      .insert(organizations)
      .values([
        { name: 'AI社員A', slug: `ai-emp-a-${unique()}` },
        { name: 'AI社員B', slug: `ai-emp-b-${unique()}` },
      ])
      .returning({ id: organizations.id });
    orgA = created[0].id;
    orgB = created[1].id;
    adminA = await callerFor(orgA, 'admin');
    memberA = await callerFor(orgA, 'member');
    adminB = await callerFor(orgB, 'admin');

    const hired = await adminA.aiEmployees.hire({
      organizationId: orgA,
      role: 'timing_watcher',
      name: 'AI 時期',
    });
    employeeA = hired.id;
  });

  afterAll(async () => {
    if (orgA) await pg.delete(organizations).where(inArray(organizations.id, [orgA, orgB]));
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  it('lets a member look into the office but not hire or manage', async () => {
    const office = await memberA.aiEmployees.office({ organizationId: orgA });
    expect(office.canManage).toBe(false);
    expect(office.employees.map((e: { id: string }) => e.id)).toEqual([employeeA]);
    await expect(
      memberA.aiEmployees.hire({ organizationId: orgA, role: 'lead_scorer', name: 'AI' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      memberA.aiEmployees.update({ organizationId: orgA, employeeId: employeeA, status: 'paused' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      memberA.aiEmployees.dismiss({ organizationId: orgA, employeeId: employeeA })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await rowOfA()).toEqual({ name: 'AI 時期', status: 'active' });
  });

  it('hires one employee per role (CONFLICT for a second)', async () => {
    await expect(
      adminA.aiEmployees.hire({ organizationId: orgA, role: 'timing_watcher', name: '二人目' })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    // The same role in another organization is fine
    const other = await adminB.aiEmployees.hire({
      organizationId: orgB,
      role: 'timing_watcher',
      name: 'B の時期',
    });
    expect(other.id).not.toBe(employeeA);
  });

  it('shows the last run and what succeeded today on the desk', async () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    await pg.insert(aiEmployeeRuns).values([
      {
        organizationId: orgA,
        employeeId: employeeA,
        trigger: 'schedule',
        status: 'succeeded',
        startedAt: yesterday,
        finishedAt: yesterday,
        processedCount: 50,
      },
      {
        organizationId: orgA,
        employeeId: employeeA,
        trigger: 'manual',
        status: 'succeeded',
        startedAt: new Date(now.getTime() - 2000),
        finishedAt: new Date(now.getTime() - 1000),
        processedCount: 4,
      },
      {
        organizationId: orgA,
        employeeId: employeeA,
        trigger: 'manual',
        status: 'failed',
        startedAt: new Date(now.getTime() - 500),
        finishedAt: now,
        processedCount: 2,
        resultCode: 'timeout',
      },
    ]);
    const office = await adminA.aiEmployees.office({ organizationId: orgA });
    expect(office.canManage).toBe(true);
    const [desk] = office.employees;
    expect(desk.lastRun).toMatchObject({ status: 'failed', resultCode: 'timeout' });
    // Only today's succeeded runs count (a run near midnight in Japan may fall on either day)
    expect([4, 54]).toContain(desk.processedToday);
    // The role has no work yet (#1102), so the desk stays in training whatever the runs say
    expect(desk.deskStatus).toBe('training');

    const runs = await memberA.aiEmployees.runs({ organizationId: orgA, employeeId: employeeA });
    expect(runs.map((run: { status: string }) => run.status)).toEqual([
      'failed',
      'succeeded',
      'succeeded',
    ]);
  });

  it("refuses B's admin when it names organization A itself", async () => {
    await expect(adminB.aiEmployees.office({ organizationId: orgA })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it("reads and changes nothing of A's employee by its id", async () => {
    const scope = { organizationId: orgB, employeeId: employeeA };
    await expect(adminB.aiEmployees.runs(scope)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      adminB.aiEmployees.update({ ...scope, name: '乗っ取り', status: 'paused' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(adminB.aiEmployees.dismiss(scope)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await rowOfA()).toEqual({ name: 'AI 時期', status: 'active' });

    const officeB = await adminB.aiEmployees.office({ organizationId: orgB });
    expect(officeB.employees.map((e: { id: string }) => e.id)).not.toContain(employeeA);
    expect(officeB.employees.every((e: { processedToday: number }) => e.processedToday === 0)).toBe(
      true
    );
  });

  it('renames, pauses, resumes and dismisses with its runs', async () => {
    const scope = { organizationId: orgA, employeeId: employeeA };
    await expect(adminA.aiEmployees.update(scope)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await adminA.aiEmployees.update({ ...scope, name: 'AI 見張り' });
    await adminA.aiEmployees.update({ ...scope, status: 'paused' });
    expect(await rowOfA()).toEqual({ name: 'AI 見張り', status: 'paused' });
    const office = await adminA.aiEmployees.office({ organizationId: orgA });
    expect(office.employees[0].deskStatus).toBe('paused');
    await adminA.aiEmployees.update({ ...scope, status: 'active' });

    await adminA.aiEmployees.dismiss(scope);
    expect(await rowOfA()).toBeUndefined();
    const runs = await pg
      .select({ id: aiEmployeeRuns.id })
      .from(aiEmployeeRuns)
      .where(eq(aiEmployeeRuns.employeeId, employeeA));
    expect(runs).toHaveLength(0);
  });
});
