/**
 * Bringing an update of a template to the AI employees (#1281) on a real PostgreSQL: each save
 * keeps its version, the training room shows what the template changed since an employee's copy
 * (and which sections the employee edited), the president replaces only the chosen sections, a
 * stale or doubled send changes nothing, and a refresher reads only the replaced sections (Claude
 * gives scripted answers). All values are fictional.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/dl_test \
 *     bunx vitest --run test/unit/integration/ai-employees-curriculum-updates.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import {
  aiEmployeeMemories,
  aiEmployeeSessions,
  aiEmployeeTrainings,
  aiEmployees,
  aiTrainingTemplateVersions,
  auditLogs,
  organizationMembers,
  organizations,
  users,
} from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import type Anthropic from '@anthropic-ai/sdk';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const claude = vi.hoisted(() => ({ replies: [] as unknown[], requests: [] as unknown[] }));
vi.mock('@/lib/features/ai/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/features/ai/service')>();
  return {
    ...actual,
    createClaudeMessage: vi.fn(async (params: unknown) => {
      claude.requests.push(structuredClone(params));
      const next = claude.replies.shift();
      if (!next) throw new Error('No scripted reply left');
      return next;
    }),
  };
});

const url = process.env.TEST_DATABASE_URL;

const reply = (stop_reason: Anthropic.StopReason, content: unknown[]): Partial<Anthropic.Message> => ({
  id: `msg_${Math.random().toString(36).slice(2)}`,
  type: 'message',
  role: 'assistant',
  model: 'claude-sonnet-5-5',
  content: content as Anthropic.ContentBlock[],
  stop_reason,
  stop_sequence: null,
  usage: {
    input_tokens: 100,
    output_tokens: 40,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  } as Anthropic.Usage,
});

const V1 = {
  company: '架空の部品を作る会社です。',
  services: '部品の設計',
  customers: '製造業のお客様',
  values: '正直に伝える',
  donts: '約束していない値引きをしない',
};
const V2 = { ...V1, company: '架空の部品と工具を作る会社です。', services: '部品と工具の設計' };

describe.skipIf(!url)('AI employees: bringing a template update (PostgreSQL)', () => {
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
  let sales: string;
  const enabled = process.env.AI_EMPLOYEE_AGENT_ENABLED;

  async function callerFor(organizationId: string, role: 'admin' | 'member') {
    const [user] = await pg
      .insert(users)
      .values({ email: `ai-upd-${unique()}@example.com`, name: 'テスト' })
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

  const ownCommon = async (employeeId: string) =>
    (
      await pg
        .select()
        .from(aiEmployeeTrainings)
        .where(
          and(eq(aiEmployeeTrainings.employeeId, employeeId), eq(aiEmployeeTrainings.kind, 'common'))
        )
    )[0];

  beforeAll(async () => {
    process.env.AI_EMPLOYEE_AGENT_ENABLED = 'true';
    const created = await pg
      .insert(organizations)
      .values([
        { name: '更新A', slug: `ai-upd-a-${unique()}` },
        { name: '更新B', slug: `ai-upd-b-${unique()}` },
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
    sales = (await adminA.aiEmployees.hire({ organizationId: orgA, role: 'sales', name: 'AI 追客' }))
      .id;
  });

  afterAll(async () => {
    process.env.AI_EMPLOYEE_AGENT_ENABLED = enabled;
    if (orgA) await pg.delete(organizations).where(inArray(organizations.id, [orgA, orgB]));
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  it('keeps each version of a template, and shows what changed since an employee’s copy', async () => {
    await adminA.aiEmployees.saveTemplate({ organizationId: orgA, scope: 'common', sections: V1 });
    // The marketer gets its copy (version 1) and is onboarded; it edits its own services
    for (const employeeId of [marketer, sales]) {
      await adminA.aiEmployees.copyTemplate({
        organizationId: orgA,
        employeeId,
        kind: 'common',
        locale: 'ja',
      });
    }
    await pg
      .update(aiEmployees)
      .set({ level: 1, onboardedAt: new Date() })
      .where(eq(aiEmployees.id, marketer));
    const own = { ...V1, services: 'この社員には、部品の設計を数字で話すことを求める' };
    await adminA.aiEmployees.saveTraining({
      organizationId: orgA,
      employeeId: marketer,
      kind: 'common',
      sections: own,
    });
    let curriculum = await adminA.aiEmployees.curriculum({ organizationId: orgA, locale: 'ja' });
    expect(curriculum.updates).toEqual({});

    expect(
      await adminA.aiEmployees.saveTemplate({ organizationId: orgA, scope: 'common', sections: V2 })
    ).toEqual({ version: 2 });
    const versions = await pg
      .select({ version: aiTrainingTemplateVersions.version, sections: aiTrainingTemplateVersions.sections })
      .from(aiTrainingTemplateVersions)
      .where(eq(aiTrainingTemplateVersions.organizationId, orgA));
    expect(versions.sort((a, b) => a.version - b.version)).toEqual([
      { version: 1, sections: V1 },
      { version: 2, sections: V2 },
    ]);

    curriculum = await adminA.aiEmployees.curriculum({ organizationId: orgA, locale: 'ja' });
    // Read with the changes: what the screen sends back with the update
    expect(curriculum.updates[marketer].common.copyUpdatedAt).toEqual(
      (await ownCommon(marketer))?.updatedAt
    );
    expect(curriculum.updates[marketer].common).toMatchObject({
      fromVersion: 1,
      toVersion: 2,
      changes: [
        { section: 'company', base: V1.company, latest: V2.company, own: V1.company, edited: false },
        {
          section: 'services',
          base: V1.services,
          latest: V2.services,
          own: own.services,
          edited: true,
        },
      ],
    });
    // The role training was never copied: nothing to bring
    expect(curriculum.updates[marketer].role).toBeUndefined();
    // Another organization sees none of it
    const other = await adminB.aiEmployees.curriculum({ organizationId: orgB, locale: 'ja' });
    expect(other.updates).toEqual({});
  });

  it('refuses a stale send, another organization and a member', async () => {
    const send = {
      organizationId: orgA,
      employeeId: marketer,
      kind: 'common',
      fromVersion: 1,
      toVersion: 3,
      copyUpdatedAt: (await ownCommon(marketer))?.updatedAt,
      replace: ['company'],
      refresher: false,
      locale: 'ja',
    };
    await expect(adminA.aiEmployees.applyTemplateUpdate(send)).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'changed_meanwhile',
    });
    await expect(
      adminB.aiEmployees.applyTemplateUpdate({ ...send, organizationId: orgB, toVersion: 2 })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      memberA.aiEmployees.applyTemplateUpdate({ ...send, toVersion: 2 })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // A manager's edit of the copy made after the president read it is never overwritten
    const read = (await ownCommon(marketer))?.updatedAt;
    const edited = await ownCommon(marketer);
    await adminA.aiEmployees.saveTraining({
      organizationId: orgA,
      employeeId: marketer,
      kind: 'common',
      sections: { ...(edited?.sections as typeof V1) },
    });
    await expect(
      adminA.aiEmployees.applyTemplateUpdate({ ...send, toVersion: 2, copyUpdatedAt: read })
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'changed_meanwhile' });
    expect((await ownCommon(marketer))?.templateVersion).toBe(1);
  });

  it('replaces only the chosen sections, on record, once, and starts a refresher that reads only them', async () => {
    const send = {
      organizationId: orgA,
      employeeId: marketer,
      kind: 'common',
      fromVersion: 1,
      toVersion: 2,
      copyUpdatedAt: (await ownCommon(marketer))?.updatedAt,
      replace: ['company'],
      refresher: true,
      locale: 'ja',
    };
    const applied = await adminA.aiEmployees.applyTemplateUpdate(send);
    expect(applied).toMatchObject({ templateVersion: 2, replaced: ['company'], refresher: 'started' });
    const copy = await ownCommon(marketer);
    expect(copy?.templateVersion).toBe(2);
    expect(copy?.sections).toMatchObject({
      company: V2.company,
      services: 'この社員には、部品の設計を数字で話すことを求める',
    });
    // A second send of the same answer changes nothing, and starts no second refresher
    await expect(adminA.aiEmployees.applyTemplateUpdate(send)).rejects.toMatchObject({
      message: 'changed_meanwhile',
    });
    const refreshers = await pg
      .select()
      .from(aiEmployeeSessions)
      .where(and(eq(aiEmployeeSessions.employeeId, marketer), eq(aiEmployeeSessions.kind, 'refresher')));
    expect(refreshers).toHaveLength(1);
    const first = (refreshers[0]?.messages as { content: string }[])[0]?.content ?? '';
    expect(first).toContain('<training_update>');
    expect(first).toContain(V2.company);
    expect(first).not.toContain('部品と工具の設計');

    const [logged] = await pg
      .select({ changes: auditLogs.changes, metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, orgA), eq(auditLogs.resource, 'ai_training')))
      .orderBy(auditLogs.createdAt)
      .then((rows) => rows.filter((row) => row.metadata?.event === 'employee_training_updated'));
    expect(logged?.metadata).toMatchObject({ replaced: ['company'] });
    const started = await pg
      .select({ changes: auditLogs.changes, metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, orgA), eq(auditLogs.resource, 'ai_training')))
      .then((rows) => rows.filter((row) => row.metadata?.event === 'refresher_started'));
    expect(started.map((row) => row.changes?.after)).toEqual([
      { kind: 'common', sessionId: applied.sessionId, sections: ['company'] },
    ]);
    expect(logged?.changes).toMatchObject({
      before: { kind: 'common', templateVersion: 1, sections: { company: V1.company } },
      after: { kind: 'common', templateVersion: 2, sections: { company: V2.company } },
    });

    // The refresher: a note fixed, then its report; it is over without the president's answer
    const sessionId = applied.sessionId as string;
    claude.requests.length = 0;
    claude.replies.push(
      reply('tool_use', [
        {
          type: 'tool_use',
          id: 'm1',
          name: 'memory',
          input: { command: 'create', path: '/memories/company.md', file_text: '部品と工具を作る会社' },
        },
      ]),
      reply('tool_use', [
        {
          type: 'tool_use',
          id: 'r1',
          name: 'submit_refresher_report',
          input: { summary: '会社の説明に工具が加わりました。', notes_changed: ['/memories/company.md'] },
        },
      ])
    );
    expect(await adminA.aiEmployees.advance({ organizationId: orgA, sessionId })).toEqual({
      state: 'running',
    });
    expect(await adminA.aiEmployees.advance({ organizationId: orgA, sessionId })).toEqual({
      state: 'closed',
      status: 'succeeded',
    });
    const request = claude.requests[0] as Anthropic.MessageCreateParamsNonStreaming;
    expect(JSON.stringify(request.system)).toContain('short refresher');
    expect(request.tools?.map((tool) => ('name' in tool ? tool.name : null))).toEqual([
      'memory',
      'submit_refresher_report',
    ]);
    const [over] = await pg.select().from(aiEmployeeSessions).where(eq(aiEmployeeSessions.id, sessionId));
    expect(over?.status).toBe('succeeded');
    expect(over?.finishedAt).not.toBeNull();
    expect(over?.report).toMatchObject({ notes_changed: ['/memories/company.md'] });
    const notes = await pg
      .select({ path: aiEmployeeMemories.path })
      .from(aiEmployeeMemories)
      .where(eq(aiEmployeeMemories.employeeId, marketer));
    expect(notes.map((note) => note.path)).toEqual(['/memories/company.md']);

    // The room shows the refresher apart from the onboarding and the reviews
    const training = await adminA.aiEmployees.training({ organizationId: orgA });
    const shown = training.employees.find((entry: { id: string }) => entry.id === marketer);
    expect(shown.refresher).toMatchObject({ id: sessionId, kind: 'refresher', status: 'succeeded' });
    expect(shown.session).toBeNull();
    const asMember = await memberA.aiEmployees.training({ organizationId: orgA });
    expect(
      asMember.employees.find((entry: { id: string }) => entry.id === marketer).refresher.report
    ).toBeNull();
  });

  it('brings the update in without a refresher before the onboarding, or while switched off', async () => {
    const send = {
      organizationId: orgA,
      employeeId: sales,
      kind: 'common',
      fromVersion: 1,
      toVersion: 2,
      copyUpdatedAt: (await ownCommon(sales))?.updatedAt,
      replace: ['company', 'services'],
      refresher: true,
      locale: 'ja',
    };
    expect(await adminA.aiEmployees.applyTemplateUpdate(send)).toMatchObject({
      templateVersion: 2,
      refresher: 'in_training',
      sessionId: null,
    });
    expect((await ownCommon(sales))?.sections).toEqual(V2);

    await adminA.aiEmployees.saveTemplate({
      organizationId: orgA,
      scope: 'common',
      sections: { ...V2, values: '正直に、早く伝える' },
    });
    process.env.AI_EMPLOYEE_AGENT_ENABLED = 'false';
    try {
      expect(
        await adminA.aiEmployees.applyTemplateUpdate({
          ...send,
          employeeId: marketer,
          fromVersion: 2,
          toVersion: 3,
          copyUpdatedAt: (await ownCommon(marketer))?.updatedAt,
          replace: ['values'],
        })
      ).toMatchObject({ templateVersion: 3, refresher: 'agent_disabled', sessionId: null });
    } finally {
      process.env.AI_EMPLOYEE_AGENT_ENABLED = 'true';
    }
  });

  it('keeps by default what is not known when an older version was not kept', async () => {
    // As for a template saved before the history was kept: the sales copy's version is gone
    await pg
      .delete(aiTrainingTemplateVersions)
      .where(
        and(
          eq(aiTrainingTemplateVersions.organizationId, orgA),
          eq(aiTrainingTemplateVersions.version, 2)
        )
      );
    const curriculum = await adminA.aiEmployees.curriculum({ organizationId: orgA, locale: 'ja' });
    expect(curriculum.updates[sales].common).toMatchObject({
      fromVersion: 2,
      toVersion: 3,
      changes: [{ section: 'values', base: null, edited: null }],
    });
  });

  it('never lets a save of the copy overwrite an update brought in since it was read', async () => {
    const read = (await ownCommon(sales))?.updatedAt;
    const sections = (await ownCommon(sales))?.sections as typeof V1;
    // Another manager brings an update in meanwhile (here: a manual save moves the copy on)
    await adminA.aiEmployees.saveTraining({
      organizationId: orgA,
      employeeId: sales,
      kind: 'common',
      sections: { ...sections, donts: '別の管理者の手直し' },
    });
    await expect(
      adminA.aiEmployees.saveTraining({
        organizationId: orgA,
        employeeId: sales,
        kind: 'common',
        sections: { ...sections, donts: '古い画面からの保存' },
        copyUpdatedAt: read,
      })
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'changed_meanwhile' });
    expect((await ownCommon(sales))?.sections).toMatchObject({ donts: '別の管理者の手直し' });
    // Read again, it is saved
    expect(
      await adminA.aiEmployees.saveTraining({
        organizationId: orgA,
        employeeId: sales,
        kind: 'common',
        sections: { ...sections, donts: '読み直してからの保存' },
        copyUpdatedAt: (await ownCommon(sales))?.updatedAt,
      })
    ).toEqual({ kind: 'common' });
  });
});
