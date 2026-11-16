/**
 * The training of the AI employees (#1280) on a real PostgreSQL: the templates start from the
 * catalog (role) or empty (common), a save raises the version, each employee gets its own copy
 * that can be edited or copied again, the onboarding reads it as data, and everything stays
 * inside its organization for the managers only. All values are fictional.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/ai-employees-curriculum.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import {
  aiEmployeeSessions,
  aiEmployeeTrainings,
  auditLogs,
  organizationMembers,
  organizations,
  users,
} from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

const COMMON = {
  company: '架空の部品を作る会社です。',
  services: '部品の設計と製造',
  customers: '製造業のお客様',
  values: '正直に伝える',
  donts: '約束していない値引きをしない',
};

describe.skipIf(!url)('AI employees: the training (PostgreSQL)', () => {
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
  let marketer: string;
  const enabled = process.env.AI_EMPLOYEE_AGENT_ENABLED;

  async function callerFor(organizationId: string, role: 'admin' | 'member') {
    const [user] = await pg
      .insert(users)
      .values({ email: `ai-curr-${unique()}@example.com`, name: 'テスト' })
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

  beforeAll(async () => {
    process.env.AI_EMPLOYEE_AGENT_ENABLED = 'true';
    const created = await pg
      .insert(organizations)
      .values([
        { name: '研修A', slug: `ai-curr-a-${unique()}` },
        { name: '研修B', slug: `ai-curr-b-${unique()}` },
      ])
      .returning({ id: organizations.id });
    orgA = created[0].id;
    orgB = created[1].id;
    adminA = await callerFor(orgA, 'admin');
    memberA = await callerFor(orgA, 'member');
    adminB = await callerFor(orgB, 'admin');
    marketer = (
      await adminA.aiEmployees.hire({ organizationId: orgA, role: 'marketer', name: 'AI 評価' })
    ).id;
  });

  afterAll(async () => {
    process.env.AI_EMPLOYEE_AGENT_ENABLED = enabled;
    if (orgA) await pg.delete(organizations).where(inArray(organizations.id, [orgA, orgB]));
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  it('starts the role templates from the catalog and the common one empty, for managers only', async () => {
    const curriculum = await adminA.aiEmployees.curriculum({ organizationId: orgA, locale: 'ja' });
    expect(curriculum.templates.common).toMatchObject({ version: 0, updatedAt: null });
    expect(Object.values(curriculum.templates.common.sections).every((text) => text === '')).toBe(
      true
    );
    expect(curriculum.templates.marketer.sections.purpose).toBe(
      '見込み客（リード）を見つけ、追う価値のある相手を見極めます。'
    );
    expect(curriculum.templates.marketer.sections.handoffs).toBe(
      '受け取る相手：なし／渡す相手：セールス'
    );
    expect(curriculum.employees).toEqual({});
    await expect(
      memberA.aiEmployees.curriculum({ organizationId: orgA, locale: 'ja' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('raises the version of a template at each save, and refuses contact details', async () => {
    expect(
      await adminA.aiEmployees.saveTemplate({ organizationId: orgA, scope: 'common', sections: COMMON })
    ).toEqual({ version: 1 });
    expect(
      await adminA.aiEmployees.saveTemplate({
        organizationId: orgA,
        scope: 'common',
        sections: { ...COMMON, company: '  架空の部品を作る会社です。  ' },
      })
    ).toEqual({ version: 2 });
    await expect(
      adminA.aiEmployees.saveTemplate({
        organizationId: orgA,
        scope: 'common',
        sections: { ...COMMON, customers: '窓口 taro@example.com' },
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    // The sections of the other kind are refused
    await expect(
      adminA.aiEmployees.saveTemplate({
        organizationId: orgA,
        scope: 'marketer',
        sections: COMMON,
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    const curriculum = await adminA.aiEmployees.curriculum({ organizationId: orgA, locale: 'ja' });
    expect(curriculum.templates.common).toMatchObject({ version: 2, sections: COMMON });
    // Another organization has its own templates
    const other = await adminB.aiEmployees.curriculum({ organizationId: orgB, locale: 'ja' });
    expect(other.templates.common.version).toBe(0);
  });

  it('gives the onboarding the employee’s own copy, as data', async () => {
    const { sessionId } = await adminA.aiEmployees.startOnboarding({
      organizationId: orgA,
      employeeId: marketer,
      locale: 'ja',
    });
    const [session] = await pg
      .select({ messages: aiEmployeeSessions.messages })
      .from(aiEmployeeSessions)
      .where(eq(aiEmployeeSessions.id, sessionId));
    const first = (session.messages as { content: string }[])[0].content;
    expect(first).toContain('<company_training>');
    expect(first).toContain('架空の部品を作る会社です。');
    expect(first).toContain('見込み客（リード）を見つけ');
    await adminA.aiEmployees.cancelSession({ organizationId: orgA, sessionId });

    const copies = await pg
      .select({ kind: aiEmployeeTrainings.kind, version: aiEmployeeTrainings.templateVersion })
      .from(aiEmployeeTrainings)
      .where(eq(aiEmployeeTrainings.employeeId, marketer));
    expect(copies.sort((a, b) => a.kind.localeCompare(b.kind))).toEqual([
      { kind: 'common', version: 2 },
      { kind: 'role', version: 0 },
    ]);
  });

  it('lets a manager edit an employee’s copy and copy the template again, on record', async () => {
    const own = { ...COMMON, values: 'この社員には、数字で話すことを特に求める' };
    await adminA.aiEmployees.saveTraining({
      organizationId: orgA,
      employeeId: marketer,
      kind: 'common',
      sections: own,
    });
    let curriculum = await adminA.aiEmployees.curriculum({ organizationId: orgA, locale: 'ja' });
    expect(curriculum.employees[marketer].common).toMatchObject({ sections: own, templateVersion: 2 });

    await adminA.aiEmployees.saveTemplate({ organizationId: orgA, scope: 'common', sections: COMMON });
    expect(
      await adminA.aiEmployees.copyTemplate({
        organizationId: orgA,
        employeeId: marketer,
        kind: 'common',
        locale: 'ja',
      })
    ).toEqual({ templateVersion: 3 });
    curriculum = await adminA.aiEmployees.curriculum({ organizationId: orgA, locale: 'ja' });
    expect(curriculum.employees[marketer].common).toMatchObject({
      sections: COMMON,
      templateVersion: 3,
    });

    // Another organization, a member, and contact details are refused
    await expect(
      adminB.aiEmployees.saveTraining({
        organizationId: orgB,
        employeeId: marketer,
        kind: 'common',
        sections: COMMON,
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      adminB.aiEmployees.copyTemplate({
        organizationId: orgB,
        employeeId: marketer,
        kind: 'role',
        locale: 'ja',
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      memberA.aiEmployees.saveTraining({
        organizationId: orgA,
        employeeId: marketer,
        kind: 'common',
        sections: COMMON,
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      adminA.aiEmployees.saveTraining({
        organizationId: orgA,
        employeeId: marketer,
        kind: 'role',
        sections: {
          purpose: '電話 03-1234-5678',
          scope: '',
          tasks: '',
          handoffs: '',
          measures: '',
        },
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    const logged = await pg
      .select({ metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, orgA), eq(auditLogs.resource, 'ai_training')));
    expect(logged.map((row) => row.metadata?.event).sort()).toEqual([
      'employee_training_copied',
      'employee_training_saved',
      'template_saved',
      'template_saved',
      'template_saved',
    ]);
  });
});
