/**
 * Rate limits of the AI procedures that call Claude (#405): every lead handed to Claude is
 * counted per user, per organization (hour) and per organization (day) before the call, alone
 * or in a batch; a refused request never reaches Claude, and the lead handed over has its text
 * cut (leadForClaude, ai-prompt-input.test.ts). The procedures that embed a text with OpenAI
 * (#576) are counted the same way in counters of their own, and the text embedded is bounded.
 * The database and the AI services are stubs (the counting itself runs on PostgreSQL in
 * ai-org-isolation.db.test.ts).
 */
import type { Organization, OrganizationMember, User } from '@/lib/db/schema';
import { MAX_EMBEDDING_TEXT_CHARS } from '@/lib/features/ai/embeddings/openai';
import {
  AI_CALL_LIMITS,
  EMBEDDING_CALL_LIMITS,
  consumeAiCalls,
  consumeEmbeddingCalls,
} from '@/lib/features/ai/limits';
import { MAX_PROMPT_FIELD_CHARS, PROMPT_TRUNCATED } from '@/lib/features/ai/prompt-input';
import { MAX_SEMANTIC_SEARCH_QUERY_CHARS } from '@/lib/features/ai/types/schemas';
import { leadChangeEvents } from '@/lib/features/webhooks/services/lead-events';
import { appRouter } from '@/server/routers/_app';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const { ai, rateLimit, openai, globalDb } = vi.hoisted(() => ({
  ai: {
    scoreLeadWithAI: vi.fn(),
    scoreLeadsBatch: vi.fn(),
    predictConversion: vi.fn(),
    predictConversionBatch: vi.fn(),
    generateLeadSummary: vi.fn(),
  },
  rateLimit: { consumeRateLimits: vi.fn() },
  // The OpenAI embeddings API, as lib/features/ai/embeddings/openai.ts calls it
  openai: { create: vi.fn() },
  // The global db that lib/features/ai/search/semantic.ts reads and writes embeddings with
  globalDb: { execute: vi.fn(), select: vi.fn() },
}));
vi.mock('openai', () => ({
  OpenAI: vi.fn(function OpenAI() {
    return { embeddings: { create: openai.create } };
  }),
}));
vi.mock('@/lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db')>()),
  db: globalDb,
}));
vi.mock('@/lib/features/ai/scoring/claude', () => ({
  scoreLeadWithAI: ai.scoreLeadWithAI,
  scoreLeadsBatch: ai.scoreLeadsBatch,
}));
vi.mock('@/lib/features/ai/prediction/conversion', () => ({
  predictConversion: ai.predictConversion,
  predictConversionBatch: ai.predictConversionBatch,
}));
vi.mock('@/lib/features/ai/chat/assistant', () => ({
  generateLeadSummary: ai.generateLeadSummary,
}));
vi.mock('@/lib/features/diagnostics/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/features/diagnostics/rate-limit')>()),
  ...rateLimit,
}));
vi.mock('@/lib/features/webhooks/services/lead-events', () => ({
  emitLeadEvents: vi.fn(),
  leadChangeEvents: vi.fn(() => []),
}));

const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_1 = '770e8400-e29b-41d4-a716-446655440001';
const LEAD_2 = '770e8400-e29b-41d4-a716-446655440002';
const LEAD_3 = '770e8400-e29b-41d4-a716-446655440003';

const user: User = {
  id: USER_ID,
  email: 'sales@example.com',
  name: '営業 太郎',
  emailVerified: true,
  image: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const organization: Organization = {
  id: ORG_ID,
  name: 'テスト組織',
  slug: 'test-org',
  settings: {},
  parentOrganizationId: null,
  organizationType: 'independent',
  hierarchyPath: ORG_ID,
  hierarchyLevel: 0,
  groupId: null,
  dataSharingPolicy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const leadRow = (id: string) => ({ id, organizationId: ORG_ID, email: `${id}@example.co.jp` });

function createCaller(role: OrganizationMember['role'] = 'admin') {
  const membership = {
    id: '880e8400-e29b-41d4-a716-446655440000',
    organizationId: ORG_ID,
    userId: USER_ID,
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
    organization,
  };
  const db = {
    query: {
      organizationMembers: { findFirst: vi.fn().mockResolvedValue(membership) },
      leads: { findFirst: vi.fn(), findMany: vi.fn() },
    },
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn((..._args: unknown[]) => ({
          returning: vi.fn().mockResolvedValue([leadRow(LEAD_1)]),
        })),
      })),
    })),
  };
  const caller = appRouter.createCaller({
    db,
    session: { session: { id: 'session-id', userId: USER_ID }, user },
    user,
  } as unknown as Parameters<typeof appRouter.createCaller>[0]);
  return { caller, db };
}

/** [rule name, identifier, cost] of each check of the first consumeRateLimits call */
const countedChecks = () =>
  (
    rateLimit.consumeRateLimits.mock.calls[0][1] as {
      rule: { name: string };
      identifier: string;
      cost: number;
    }[]
  ).map((check) => [check.rule.name, check.identifier, check.cost]);

const checksFor = (cost: number) => [
  ['ai-call-user', USER_ID, cost],
  ['ai-call-org', ORG_ID, cost],
  ['ai-call-org-day', ORG_ID, cost],
];

const refusedBy = (rule: string, retryAfterSeconds = 600) =>
  rateLimit.consumeRateLimits.mockResolvedValue({ allowed: false, rule, retryAfterSeconds });

describe('AI router: rate limits of the Claude calls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimit.consumeRateLimits.mockResolvedValue({ allowed: true });
    ai.scoreLeadWithAI.mockResolvedValue({ score: 80 });
    ai.generateLeadSummary.mockResolvedValue('まとめ');
    ai.predictConversion.mockResolvedValue({ probability: 0.4 });
    ai.scoreLeadsBatch.mockImplementation(
      async (rows: { id: string }[]) => new Map(rows.map((row) => [row.id, { score: 70 }]))
    );
    ai.predictConversionBatch.mockImplementation(
      async (rows: { id: string }[]) => new Map(rows.map((row) => [row.id, { probability: 0.3 }]))
    );
  });

  it('counts one call per user, organization and day before scoring a lead', async () => {
    const { caller, db } = createCaller();
    db.query.leads.findFirst.mockResolvedValue(leadRow(LEAD_1));

    await caller.ai.scoreLead({ organizationId: ORG_ID, leadId: LEAD_1 });

    expect(countedChecks()).toEqual(checksFor(1));
    expect(rateLimit.consumeRateLimits.mock.invocationCallOrder[0]).toBeLessThan(
      ai.scoreLeadWithAI.mock.invocationCallOrder[0]
    );
  });

  it('counts one call for a summary and for a prediction', async () => {
    const { caller, db } = createCaller();
    db.query.leads.findFirst.mockResolvedValue(leadRow(LEAD_1));

    await caller.ai.generateSummary({ organizationId: ORG_ID, leadId: LEAD_1 });
    expect(countedChecks()).toEqual(checksFor(1));

    rateLimit.consumeRateLimits.mockClear();
    await caller.ai.predictConversion({ organizationId: ORG_ID, leadId: LEAD_1 });
    expect(countedChecks()).toEqual(checksFor(1));
  });

  it('counts every lead of a batch that is found in the organization', async () => {
    const { caller, db } = createCaller();
    // Three ids asked, two found in the organization: two Claude calls
    db.query.leads.findMany.mockResolvedValue([leadRow(LEAD_1), leadRow(LEAD_2)]);

    await caller.ai.batchScoreLeads({ organizationId: ORG_ID, leadIds: [LEAD_1, LEAD_2, LEAD_3] });
    expect(countedChecks()).toEqual(checksFor(2));
    expect(ai.scoreLeadsBatch).toHaveBeenCalledTimes(1);

    rateLimit.consumeRateLimits.mockClear();
    await caller.ai.batchPredictConversion({
      organizationId: ORG_ID,
      leadIds: [LEAD_1, LEAD_2, LEAD_3],
    });
    expect(countedChecks()).toEqual(checksFor(2));
  });

  it('never calls Claude once a limit refuses, and names the limit', async () => {
    const { caller, db } = createCaller();
    db.query.leads.findFirst.mockResolvedValue(leadRow(LEAD_1));
    db.query.leads.findMany.mockResolvedValue([leadRow(LEAD_1)]);
    refusedBy('ai-call-org', 600);
    const one = { organizationId: ORG_ID, leadId: LEAD_1 };
    const batch = { organizationId: ORG_ID, leadIds: [LEAD_1] };

    await expect(caller.ai.scoreLead(one)).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      message: 'AI の利用の上限（1時間に120件・組織ごと）に達しました。約10分後にもう一度お試しください',
    });
    await expect(caller.ai.generateSummary(one)).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
    });
    await expect(caller.ai.predictConversion(one)).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
    });
    await expect(caller.ai.batchScoreLeads(batch)).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
    });
    await expect(caller.ai.batchPredictConversion(batch)).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
    });

    for (const stub of Object.values(ai)) expect(stub).not.toHaveBeenCalled();
    // The score is not written either
    expect(db.update).not.toHaveBeenCalled();
  });

  it('hands Claude the lead with its text cut, and keeps the stored lead for the change events', async () => {
    const { caller, db } = createCaller();
    const huge = { ...leadRow(LEAD_1), company: 'c'.repeat(2_000_000) };
    const cut = `${'c'.repeat(MAX_PROMPT_FIELD_CHARS)} ${PROMPT_TRUNCATED}`;
    db.query.leads.findFirst.mockResolvedValue(huge);
    db.query.leads.findMany.mockResolvedValue([huge, leadRow(LEAD_2)]);
    const one = { organizationId: ORG_ID, leadId: LEAD_1 };
    const batch = { organizationId: ORG_ID, leadIds: [LEAD_1, LEAD_2] };

    await caller.ai.scoreLead(one);
    await caller.ai.generateSummary(one);
    await caller.ai.predictConversion(one);
    await caller.ai.batchScoreLeads(batch);
    await caller.ai.batchPredictConversion(batch);

    for (const stub of [ai.scoreLeadWithAI, ai.generateLeadSummary, ai.predictConversion]) {
      expect(stub.mock.calls[0][0]).toMatchObject({ id: LEAD_1, company: cut });
    }
    for (const stub of [ai.scoreLeadsBatch, ai.predictConversionBatch]) {
      expect(stub.mock.calls[0][0]).toMatchObject([{ id: LEAD_1, company: cut }, { id: LEAD_2 }]);
    }
    // The change events compare the stored lead, not the copy handed to Claude
    expect(vi.mocked(leadChangeEvents).mock.calls[0][0]).toBe(huge);
  });

  it('counts nothing for a lead outside the organization or a caller without the right', async () => {
    const { caller, db } = createCaller();
    db.query.leads.findFirst.mockResolvedValue(undefined);
    db.query.leads.findMany.mockResolvedValue([]);
    const one = { organizationId: ORG_ID, leadId: LEAD_1 };

    await expect(caller.ai.scoreLead(one)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      caller.ai.batchScoreLeads({ organizationId: ORG_ID, leadIds: [LEAD_1] })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const viewer = createCaller('parent_viewer');
    viewer.db.query.leads.findFirst.mockResolvedValue(leadRow(LEAD_1));
    await expect(viewer.caller.ai.scoreLead(one)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(rateLimit.consumeRateLimits).not.toHaveBeenCalled();
  });
});

const embeddingChecksFor = (cost: number) => [
  ['ai-embedding-user', USER_ID, cost],
  ['ai-embedding-org', ORG_ID, cost],
  ['ai-embedding-org-day', ORG_ID, cost],
];

describe('AI router: rate limits of the OpenAI embeddings', () => {
  const search = { organizationId: ORG_ID, query: '製造業で基幹システムが古い会社' };
  const one = { organizationId: ORG_ID, leadId: LEAD_1 };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');
    rateLimit.consumeRateLimits.mockResolvedValue({ allowed: true });
    openai.create.mockResolvedValue({ data: [{ embedding: [0.1, 0.2, 0.3] }] });
    globalDb.execute.mockResolvedValue([]);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('counts one embedding per user, organization and day before embedding a search query', async () => {
    const { caller } = createCaller();

    await caller.ai.semanticSearch(search);

    expect(countedChecks()).toEqual(embeddingChecksFor(1));
    expect(openai.create).toHaveBeenCalledTimes(1);
    expect(openai.create.mock.calls[0][0]).toMatchObject({ input: search.query });
    expect(rateLimit.consumeRateLimits.mock.invocationCallOrder[0]).toBeLessThan(
      openai.create.mock.invocationCallOrder[0]
    );
  });

  it('counts one embedding before embedding a lead found in the organization', async () => {
    const { caller, db } = createCaller();
    db.query.leads.findFirst.mockResolvedValue(leadRow(LEAD_1));

    await caller.ai.updateEmbedding(one);

    expect(countedChecks()).toEqual(embeddingChecksFor(1));
    expect(openai.create).toHaveBeenCalledTimes(1);
    expect(rateLimit.consumeRateLimits.mock.invocationCallOrder[0]).toBeLessThan(
      openai.create.mock.invocationCallOrder[0]
    );
    // The embedding is stored once OpenAI has answered, on the lead in the organization only (#583)
    expect(globalDb.execute).toHaveBeenCalledTimes(1);
    const update = new PgDialect().sqlToQuery(globalDb.execute.mock.calls[0][0] as SQL);
    expect(update.sql).toMatch(/WHERE id = \$\d+ AND organization_id = \$\d+/);
    expect(update.params.slice(-2)).toEqual([LEAD_1, ORG_ID]);
  });

  it('never calls OpenAI once a limit refuses, and names the limit', async () => {
    const { caller, db } = createCaller();
    db.query.leads.findFirst.mockResolvedValue(leadRow(LEAD_1));
    refusedBy('ai-embedding-user', 600);

    await expect(caller.ai.semanticSearch(search)).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      message:
        'AI 検索・埋め込みの利用の上限（1時間に300件・ユーザーごと）に達しました。約10分後にもう一度お試しください',
    });
    // Updating a lead's embedding shares the counters, so its refusal names both uses
    await expect(caller.ai.updateEmbedding(one)).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      message:
        'AI 検索・埋め込みの利用の上限（1時間に300件・ユーザーごと）に達しました。約10分後にもう一度お試しください',
    });

    expect(openai.create).not.toHaveBeenCalled();
    // Nothing is searched or stored either
    expect(globalDb.execute).not.toHaveBeenCalled();
  });

  it('counts nothing for a lead outside the organization, a caller without the right or a query too long', async () => {
    const { caller, db } = createCaller();
    db.query.leads.findFirst.mockResolvedValue(undefined);
    await expect(caller.ai.updateEmbedding(one)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const viewer = createCaller('parent_viewer');
    viewer.db.query.leads.findFirst.mockResolvedValue(leadRow(LEAD_1));
    await expect(viewer.caller.ai.updateEmbedding(one)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    // Not a member of the organization named
    const outsider = createCaller();
    outsider.db.query.organizationMembers.findFirst.mockResolvedValue(undefined);
    await expect(outsider.caller.ai.semanticSearch(search)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(outsider.caller.ai.updateEmbedding(one)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    await expect(
      caller.ai.semanticSearch({
        ...search,
        query: 'あ'.repeat(MAX_SEMANTIC_SEARCH_QUERY_CHARS + 1),
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(rateLimit.consumeRateLimits).not.toHaveBeenCalled();
    expect(openai.create).not.toHaveBeenCalled();
  });

  it('embeds a query of the longest length, and a lead with its text cut', async () => {
    const { caller, db } = createCaller();
    const longest = 'あ'.repeat(MAX_SEMANTIC_SEARCH_QUERY_CHARS);
    await caller.ai.semanticSearch({ ...search, query: longest });
    expect(openai.create.mock.calls[0][0]).toMatchObject({ input: longest });

    db.query.leads.findFirst.mockResolvedValue({
      ...leadRow(LEAD_1),
      name: 'n'.repeat(5_000),
      company: 'c'.repeat(2_000_000),
    });
    await caller.ai.updateEmbedding(one);
    const embedded = openai.create.mock.calls[1][0].input as string;
    expect(embedded.length).toBeLessThanOrEqual(MAX_EMBEDDING_TEXT_CHARS);
    expect(embedded).toContain(`${LEAD_1}@example.co.jp`);
  });

  it('counts nothing for similar leads: they compare the stored embeddings without OpenAI', async () => {
    const { caller, db } = createCaller();
    db.query.leads.findFirst.mockResolvedValue(leadRow(LEAD_1));
    const where = vi.fn(async (_condition: SQL) => [{ embedding: '[0.1,0.2,0.3]' }]);
    globalDb.select.mockReturnValue({ from: () => ({ where }) });

    await caller.ai.findSimilar(one);

    // The reference lead is read in the organization named, too (#583)
    expect(new PgDialect().sqlToQuery(where.mock.calls[0][0]).params).toEqual([LEAD_1, ORG_ID]);
    expect(globalDb.execute).toHaveBeenCalledTimes(1);
    expect(rateLimit.consumeRateLimits).not.toHaveBeenCalled();
    expect(openai.create).not.toHaveBeenCalled();
  });
});

describe('consumeEmbeddingCalls', () => {
  beforeEach(() => vi.clearAllMocks());
  const database = {} as Parameters<typeof consumeEmbeddingCalls>[0];

  it('counts in counters of its own, not those of the Claude calls', async () => {
    rateLimit.consumeRateLimits.mockResolvedValue({ allowed: true });
    await consumeEmbeddingCalls(database, { userId: USER_ID, organizationId: ORG_ID, calls: 1 });
    expect(countedChecks()).toEqual(embeddingChecksFor(1));
    const claudeRules = Object.values(AI_CALL_LIMITS).map((rule) => rule.name as string);
    expect(
      Object.values(EMBEDDING_CALL_LIMITS).filter((rule) => claudeRules.includes(rule.name))
    ).toEqual([]);
  });

  it('names the daily limit in hours when its window ends hours later', async () => {
    refusedBy(EMBEDDING_CALL_LIMITS.perOrganizationDaily.name, 5 * 60 * 60);
    await expect(
      consumeEmbeddingCalls(database, { userId: USER_ID, organizationId: ORG_ID, calls: 1 })
    ).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      message:
        'AI 検索・埋め込みの利用の上限（1日に3000件・組織ごと）に達しました。約5時間後にもう一度お試しください',
    });
  });
});

describe('consumeAiCalls', () => {
  beforeEach(() => vi.clearAllMocks());
  const database = {} as Parameters<typeof consumeAiCalls>[0];

  it('names the daily limit in hours when its window ends hours later', async () => {
    refusedBy(AI_CALL_LIMITS.perOrganizationDaily.name, 5 * 60 * 60);
    await expect(
      consumeAiCalls(database, { userId: USER_ID, organizationId: ORG_ID, calls: 3 })
    ).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      message: 'AI の利用の上限（1日に500件・組織ごと）に達しました。約5時間後にもう一度お試しください',
    });
  });

  it('names the per-user limit', async () => {
    refusedBy(AI_CALL_LIMITS.perUser.name, 30);
    await expect(
      consumeAiCalls(database, { userId: USER_ID, organizationId: ORG_ID, calls: 1 })
    ).rejects.toMatchObject({
      message: 'AI の利用の上限（1時間に60件・ユーザーごと）に達しました。約1分後にもう一度お試しください',
    });
  });

  it('passes the time on to the counting', async () => {
    rateLimit.consumeRateLimits.mockResolvedValue({ allowed: true });
    const now = new Date('2026-10-24T03:00:00Z');
    await consumeAiCalls(database, { userId: USER_ID, organizationId: ORG_ID, calls: 4 }, now);
    expect(rateLimit.consumeRateLimits).toHaveBeenCalledWith(database, expect.any(Array), now);
  });
});
