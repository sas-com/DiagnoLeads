/**
 * The training room (Epic #1187) on a real PostgreSQL: the onboarding moves one step at a time
 * and hands in a report (#1188, #1189), the president corrects it and approves it, the reviews
 * count the facts and narrow or keep (#1190), the notes are kept with their versions, and every
 * action stays inside its organization and needs the managers' permission. Claude is replaced by
 * scripted answers. All values are fictional.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/ai-employees-training.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import {
  aiEmployeeMemoryVersions,
  aiEmployeeRuns,
  aiEmployeeSessions,
  aiEmployees,
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
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
      if (next instanceof Error) throw next;
      return next;
    }),
  };
});

const url = process.env.TEST_DATABASE_URL;

const reply = (
  stop_reason: Anthropic.StopReason,
  content: unknown[]
): Partial<Anthropic.Message> => ({
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
const memory = (id: string, input: Record<string, unknown>) => ({
  type: 'tool_use',
  id,
  name: 'memory',
  input,
});
const REPORT = {
  introduction: 'AIマーケターです。よろしくお願いします。',
  role_summary: '見込み客を見つけ、追う価値のある相手を見極めて営業に渡します。',
  goals: ['評価の基準を社長と合わせる'],
  questions: ['重視する業種はありますか'],
};

describe.skipIf(!url)('AI employees: the training room (PostgreSQL)', () => {
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
      .values({ email: `ai-train-${unique()}@example.com`, name: 'テスト' })
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

  const employee = async (id: string) =>
    (await pg.select().from(aiEmployees).where(eq(aiEmployees.id, id)))[0];
  const session = async (id: string) =>
    (await pg.select().from(aiEmployeeSessions).where(eq(aiEmployeeSessions.id, id)))[0];

  beforeAll(async () => {
    process.env.AI_EMPLOYEE_AGENT_ENABLED = 'true';
    const created = await pg
      .insert(organizations)
      .values([
        { name: '研修A', slug: `ai-train-a-${unique()}` },
        { name: '研修B', slug: `ai-train-b-${unique()}` },
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

  beforeEach(() => {
    claude.replies.length = 0;
    claude.requests.length = 0;
  });

  afterAll(async () => {
    process.env.AI_EMPLOYEE_AGENT_ENABLED = enabled;
    if (orgA) await pg.delete(organizations).where(inArray(organizations.id, [orgA, orgB]));
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  it('refuses to start while the switch is off', async () => {
    process.env.AI_EMPLOYEE_AGENT_ENABLED = 'false';
    try {
      await expect(
        adminA.aiEmployees.startOnboarding({ organizationId: orgA, employeeId: marketer, locale: 'ja' })
      ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', message: 'agent_disabled' });
      const training = await adminA.aiEmployees.training({ organizationId: orgA });
      expect(training.agentEnabled).toBe(false);
    } finally {
      process.env.AI_EMPLOYEE_AGENT_ENABLED = 'true';
    }
    expect(claude.requests).toHaveLength(0);
  });

  it('keeps the policy and the onboarding for the managers of the organization', async () => {
    await expect(
      memberA.aiEmployees.setPolicy({ organizationId: orgA, employeeId: marketer, policy: 'x' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      adminB.aiEmployees.setPolicy({ organizationId: orgB, employeeId: marketer, policy: 'x' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      adminB.aiEmployees.startOnboarding({ organizationId: orgB, employeeId: marketer, locale: 'ja' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await adminA.aiEmployees.setPolicy({
      organizationId: orgA,
      employeeId: marketer,
      policy: '製造業の見込み客を重視してください。',
    });
    expect((await employee(marketer)).policy).toBe('製造業の見込み客を重視してください。');
  });

  it('onboards one step at a time, reminds once, and waits for the president with the report', async () => {
    const { sessionId } = await adminA.aiEmployees.startOnboarding({
      organizationId: orgA,
      employeeId: marketer,
      locale: 'ja',
    });
    // One open session per employee
    await expect(
      adminA.aiEmployees.startOnboarding({ organizationId: orgA, employeeId: marketer, locale: 'ja' })
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'open_session' });

    claude.replies.push(
      reply('tool_use', [
        { type: 'thinking', thinking: '', signature: 'sig-1' },
        memory('t1', { command: 'create', path: '/memories/role.md', file_text: '見込み客を見極める' }),
        memory('t2', { command: 'create', path: '/memories/x.md', file_text: 'taro@example.com' }),
      ]),
      reply('end_turn', [{ type: 'text', text: 'Done.', citations: null }]),
      reply('tool_use', [{ type: 'tool_use', id: 'r1', name: 'submit_onboarding_report', input: REPORT }])
    );

    // Another organization and a member cannot move it
    await expect(adminB.aiEmployees.advance({ organizationId: orgB, sessionId })).rejects.toMatchObject(
      { code: 'NOT_FOUND' }
    );
    await expect(memberA.aiEmployees.advance({ organizationId: orgA, sessionId })).rejects.toMatchObject(
      { code: 'FORBIDDEN' }
    );

    expect(await adminA.aiEmployees.advance({ organizationId: orgA, sessionId })).toEqual({
      state: 'running',
    });
    expect(await adminA.aiEmployees.advance({ organizationId: orgA, sessionId })).toEqual({
      state: 'running',
    });
    expect(await adminA.aiEmployees.advance({ organizationId: orgA, sessionId })).toEqual({
      state: 'waiting',
    });

    const row = await session(sessionId);
    expect(row).toMatchObject({ status: 'waiting', steps: 3, inputTokens: 300, outputTokens: 120 });
    expect(row.report).toEqual(REPORT);
    const messages = row.messages as Anthropic.MessageParam[];
    // The conversation is appended to as it came: the thinking block is kept, each tool answered
    expect(messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
    ]);
    expect((messages[1].content as { type: string }[])[0]).toMatchObject({ type: 'thinking', signature: 'sig-1' });
    const results = messages[2].content as Anthropic.ToolResultBlockParam[];
    expect(results.map((result) => result.is_error ?? false)).toEqual([false, true]);
    expect(messages[4].content).toContain('You have not handed in your report yet');
    // The second request carried the whole conversation so far
    expect((claude.requests[1] as { messages: unknown[] }).messages).toHaveLength(3);

    // The note was kept with a version by the agent; the address never was
    const training = await adminA.aiEmployees.training({ organizationId: orgA });
    const mine = training.employees.find((e: { id: string }) => e.id === marketer);
    expect(mine.notes.map((note: { path: string }) => note.path)).toEqual(['/memories/role.md']);
    expect(mine.session).toMatchObject({ id: sessionId, status: 'waiting', report: REPORT });
    const versions = await pg
      .select()
      .from(aiEmployeeMemoryVersions)
      .where(eq(aiEmployeeMemoryVersions.employeeId, marketer));
    expect(versions).toEqual([
      expect.objectContaining({ path: '/memories/role.md', changedBy: 'agent', sessionId }),
    ]);

    // A member sees the grade but not the notes, the report or the policy
    const seen = (await memberA.aiEmployees.training({ organizationId: orgA })).employees.find(
      (e: { id: string }) => e.id === marketer
    );
    expect(seen).toMatchObject({ level: 0, notes: [], policy: '' });
    expect(seen.session.report).toBeNull();
  });

  it('gives a correction back, then approves: the employee goes on probation, on record', async () => {
    const [open] = await pg
      .select()
      .from(aiEmployeeSessions)
      .where(and(eq(aiEmployeeSessions.employeeId, marketer), eq(aiEmployeeSessions.status, 'waiting')));
    await expect(
      adminB.aiEmployees.answerOnboarding({ organizationId: orgB, sessionId: open.id, answer: 'approve' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await adminA.aiEmployees.answerOnboarding({
      organizationId: orgA,
      sessionId: open.id,
      answer: 'correct',
      correction: '目標は1つでよいです',
    });
    expect((await session(open.id)).status).toBe('running');
    claude.replies.push(
      reply('tool_use', [{ type: 'tool_use', id: 'r2', name: 'submit_onboarding_report', input: REPORT }])
    );
    expect(await adminA.aiEmployees.advance({ organizationId: orgA, sessionId: open.id })).toEqual({
      state: 'waiting',
    });
    const sent = (claude.requests[0] as { messages: Anthropic.MessageParam[] }).messages;
    expect(String(sent.at(-1)?.content)).toContain('<president_correction>');

    const answered = await adminA.aiEmployees.answerOnboarding({
      organizationId: orgA,
      sessionId: open.id,
      answer: 'approve',
    });
    expect(answered).toEqual({ level: 1 });
    expect(await employee(marketer)).toMatchObject({ level: 1 });
    expect((await employee(marketer)).onboardedAt).not.toBeNull();
    expect((await session(open.id)).status).toBe('succeeded');
    // A double send changes nothing
    await expect(
      adminA.aiEmployees.answerOnboarding({ organizationId: orgA, sessionId: open.id, answer: 'approve' })
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'not_waiting' });
    const logged = await pg
      .select({ metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, orgA), eq(auditLogs.resourceId, marketer)));
    expect(logged.map((row) => row.metadata?.event).sort()).toEqual([
      'onboarding_approved',
      'policy_changed',
    ]);
  });

  it('holds a review: facts from the records, a self-review, and no promotion the facts do not call for', async () => {
    const { reviewId, sessionId, recommendation } = await adminA.aiEmployees.startReview({
      organizationId: orgA,
      employeeId: marketer,
      locale: 'ja',
    });
    expect(recommendation).toBe('keep');
    claude.replies.push(
      reply('tool_use', [
        memory('g', { command: 'create', path: '/memories/goals.md', file_text: '次の30日の目標' }),
        {
          type: 'tool_use',
          id: 's',
          name: 'submit_self_review',
          input: { self_review: '記録はまだありません。', next_goals: ['基準を合わせる'] },
        },
      ])
    );
    // The decision waits for the self-review
    await expect(
      adminA.aiEmployees.decideReview({ organizationId: orgA, reviewId, decision: 'keep' })
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'self_review_running' });
    expect(await adminA.aiEmployees.advance({ organizationId: orgA, sessionId })).toEqual({
      state: 'waiting',
    });
    await expect(
      adminA.aiEmployees.decideReview({ organizationId: orgA, reviewId, decision: 'promote', fromLevel: 1 })
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'not_recommended' });
    await expect(
      adminB.aiEmployees.decideReview({ organizationId: orgB, reviewId, decision: 'keep' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(
      await adminA.aiEmployees.decideReview({ organizationId: orgA, reviewId, decision: 'keep' })
    ).toEqual({ level: 1 });
    expect((await session(sessionId)).status).toBe('succeeded');
    // The next one is a month away
    await expect(
      adminA.aiEmployees.startReview({ organizationId: orgA, employeeId: marketer, locale: 'ja' })
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'review_not_due' });
  });

  it('lowers the grade at once when the runs fail too often', async () => {
    const sales = (
      await adminA.aiEmployees.hire({ organizationId: orgA, role: 'sales', name: 'AI 追客' })
    ).id;
    const since = new Date(Date.now() - 40 * 86_400_000);
    await pg
      .update(aiEmployees)
      .set({ level: 2, onboardedAt: since, levelChangedAt: since })
      .where(eq(aiEmployees.id, sales));
    await pg.insert(aiEmployeeRuns).values(
      Array.from({ length: 10 }, (_, i) => ({
        organizationId: orgA,
        employeeId: sales,
        role: 'sales',
        trigger: 'schedule',
        status: i < 4 ? 'failed' : 'succeeded',
        startedAt: new Date(Date.now() - (i + 1) * 3_600_000),
      }))
    );
    const review = await adminA.aiEmployees.startReview({
      organizationId: orgA,
      employeeId: sales,
      locale: 'ja',
    });
    expect(review.recommendation).toBe('narrow');
    expect((await employee(sales)).level).toBe(1);
    const training = await adminA.aiEmployees.training({ organizationId: orgA });
    expect(training.employees.find((e: { id: string }) => e.id === sales).review).toMatchObject({
      recommendation: 'narrow',
      levelBefore: 2,
      levelAfter: 1,
      status: 'decided',
    });
    await adminA.aiEmployees.cancelSession({ organizationId: orgA, sessionId: review.sessionId });
  });

  it('ends on a refusal, and never makes two steps of one session at once', async () => {
    const engineer = (
      await adminA.aiEmployees.hire({ organizationId: orgA, role: 'engineer', name: 'AI 準備' })
    ).id;
    const { sessionId } = await adminA.aiEmployees.startOnboarding({
      organizationId: orgA,
      employeeId: engineer,
      locale: 'en',
    });
    await pg
      .update(aiEmployeeSessions)
      .set({ lockedUntil: new Date(Date.now() + 60_000) })
      .where(eq(aiEmployeeSessions.id, sessionId));
    expect(await adminA.aiEmployees.advance({ organizationId: orgA, sessionId })).toEqual({
      state: 'busy',
    });
    expect(claude.requests).toHaveLength(0);
    await pg
      .update(aiEmployeeSessions)
      .set({ lockedUntil: null })
      .where(eq(aiEmployeeSessions.id, sessionId));

    claude.replies.push(reply('refusal', []));
    expect(await adminA.aiEmployees.advance({ organizationId: orgA, sessionId })).toEqual({
      state: 'failed',
      resultCode: 'refused',
    });
    expect(await session(sessionId)).toMatchObject({ status: 'failed', resultCode: 'refused' });
    expect(await adminA.aiEmployees.advance({ organizationId: orgA, sessionId })).toEqual({
      state: 'closed',
      status: 'failed',
    });
    // A passing failure saves nothing and can be tried again
    const again = await adminA.aiEmployees.startOnboarding({
      organizationId: orgA,
      employeeId: engineer,
      locale: 'en',
    });
    claude.replies.push(Object.assign(new Error('timeout'), { status: undefined }));
    expect(
      await adminA.aiEmployees.advance({ organizationId: orgA, sessionId: again.sessionId })
    ).toEqual({ state: 'retry' });
    expect(await session(again.sessionId)).toMatchObject({ status: 'running', lockedUntil: null });
  });

  it('lets a manager fix and delete a note, with the same checks and a version', async () => {
    await expect(
      adminB.aiEmployees.editNote({
        organizationId: orgB,
        employeeId: marketer,
        path: '/memories/extra.md',
        content: 'x',
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      adminA.aiEmployees.editNote({
        organizationId: orgA,
        employeeId: marketer,
        path: '/memories/extra.md',
        content: '連絡先 taro@example.com',
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'invalid_note' });
    await expect(
      adminA.aiEmployees.editNote({
        organizationId: orgA,
        employeeId: marketer,
        path: '/memories/../x.md',
        content: 'x',
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await adminA.aiEmployees.editNote({
      organizationId: orgA,
      employeeId: marketer,
      path: '/memories/role.md',
      content: '社長が直した役割',
    });
    await adminA.aiEmployees.editNote({
      organizationId: orgA,
      employeeId: marketer,
      path: '/memories/goals.md',
      content: null,
    });
    const training = await adminA.aiEmployees.training({ organizationId: orgA });
    const notes = training.employees.find((e: { id: string }) => e.id === marketer).notes;
    expect(notes.map((note: { path: string; content: string }) => [note.path, note.content])).toEqual([
      ['/memories/role.md', '社長が直した役割'],
    ]);
    const byUser = await pg
      .select()
      .from(aiEmployeeMemoryVersions)
      .where(
        and(
          eq(aiEmployeeMemoryVersions.employeeId, marketer),
          eq(aiEmployeeMemoryVersions.changedBy, 'user')
        )
      );
    expect(byUser.map((row) => [row.path, row.content])).toEqual(
      expect.arrayContaining([
        ['/memories/role.md', '社長が直した役割'],
        ['/memories/goals.md', null],
      ])
    );
  });
});
