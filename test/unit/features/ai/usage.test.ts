/**
 * Token usage of the AI calls (#47, lib/features/ai/usage.ts): one structured log line for each
 * response of Claude or of the OpenAI embeddings, with the operation, the organization, the model,
 * the tokens and the time taken, and nothing that points at a person or at the lead (no lead id,
 * no name, no prompt or output text). The procedures run through the tRPC router with the
 * Anthropic and OpenAI SDKs replaced, as in ai-router-limits.test.ts; a failed call logs no usage
 * and still reaches reportClaudeFailure. The structured outputs come back as text, as
 * messages.create returns them, and are parsed by the SDK's own jsonSchemaOutputFormat, so an
 * answer that is not JSON fails the way it does in production.
 */
import type { Organization, OrganizationMember, User } from '@/lib/db/schema';
import { CLAUDE_MODEL } from '@/lib/features/ai/client';
import { generateEmbedding } from '@/lib/features/ai/embeddings/openai';
import { predictConversion } from '@/lib/features/ai/prediction/conversion';
import { generateLeadSummary } from '@/lib/features/ai/chat/assistant';
import { scoreLeadWithAI } from '@/lib/features/ai/scoring/claude';
import { AI_USAGE_EVENT, logAiUsage } from '@/lib/features/ai/usage';
import { appRouter } from '@/server/routers/_app';
import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  create: vi.fn(),
  embed: vi.fn(),
  reportServerError: vi.fn(),
  consumeRateLimits: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: sdk.create };
  },
}));
vi.mock('openai', () => ({
  OpenAI: class MockOpenAI {
    embeddings = { create: sdk.embed };
  },
}));
vi.mock('@/lib/ops/alert', () => ({ reportServerError: sdk.reportServerError }));
vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/features/diagnostics/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/features/diagnostics/rate-limit')>()),
  consumeRateLimits: sdk.consumeRateLimits,
}));
vi.mock('@/lib/features/webhooks/services/lead-events', () => ({
  emitLeadEvents: vi.fn(),
  leadChangeEvents: vi.fn(() => []),
}));

const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_1 = '770e8400-e29b-41d4-a716-446655440001';
const LEAD_2 = '770e8400-e29b-41d4-a716-446655440002';

/** What points at a person or at the lead: none of it may reach a usage line */
const PERSONAL = {
  name: '山田 花子',
  email: 'hanako.yamada@example.co.jp',
  phone: '03-1234-5678',
  notes: '決裁者は専務。娘さんの受験で11月は不在がち',
};
const COMPANY = '架空精機株式会社';

const leadRow = (id: string) => ({
  id,
  organizationId: ORG_ID,
  ...PERSONAL,
  company: COMPANY,
  status: 'new',
  source: 'website',
  score: 40,
  responses: null,
  createdAt: new Date('2026-10-20T00:00:00Z'),
  updatedAt: new Date('2026-10-20T00:00:00Z'),
});

/** The text Claude answers with, which is lead content too */
const REASONING = '移行の時期が近く、決裁者が関わっているため優先度が高い';
const SUMMARY = '架空精機は Access の基幹システムを移行したいリードです。';

/** A Claude message as messages.create returns it: the thinking, then the text */
const claudeMessage = (text: string, usage: object, stopReason = 'end_turn') => ({
  model: CLAUDE_MODEL,
  stop_reason: stopReason,
  usage,
  content: [
    { type: 'thinking', thinking: '', signature: 'sig' },
    { type: 'text', text },
  ],
});

const usage = { input_tokens: 812, output_tokens: 95 };
const scoreOutput = {
  score: 82,
  confidence: 'high',
  reasoning: REASONING,
  recommendedActions: ['初回の商談を設定する'],
  priority: 'high',
};
const scoreResponse = claudeMessage(JSON.stringify(scoreOutput), {
  ...usage,
  cache_read_input_tokens: null,
  cache_creation_input_tokens: null,
});
const predictionOutput = {
  probability: 64,
  confidence: 'medium',
  estimatedDaysToConversion: 30,
  factors: [{ name: '移行の時期', impact: 'positive', weight: 7, description: REASONING }],
  recommendations: ['事例を送る'],
  risks: [],
};
const predictionResponse = claudeMessage(JSON.stringify(predictionOutput), {
  input_tokens: 1430,
  output_tokens: 210,
});
const summaryResponse = claudeMessage(SUMMARY, {
  input_tokens: 640,
  output_tokens: 120,
  cache_read_input_tokens: 0,
});
const embeddingResponse = {
  model: 'text-embedding-3-small',
  data: [{ embedding: [0.1, 0.2, 0.3] }],
  usage: { prompt_tokens: 9, total_tokens: 9 },
};

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

function createCaller() {
  const membership = {
    id: '880e8400-e29b-41d4-a716-446655440000',
    organizationId: ORG_ID,
    userId: USER_ID,
    role: 'admin' satisfies OrganizationMember['role'],
    createdAt: new Date(),
    updatedAt: new Date(),
    organization,
  };
  const db = {
    query: {
      organizationMembers: { findFirst: vi.fn().mockResolvedValue(membership) },
      leads: {
        findFirst: vi.fn().mockResolvedValue(leadRow(LEAD_1)),
        findMany: vi.fn().mockResolvedValue([leadRow(LEAD_1), leadRow(LEAD_2)]),
      },
    },
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([leadRow(LEAD_1)]) })),
      })),
    })),
    // The search finds nothing; the embedding's UPDATE … RETURNING id finds the lead
    execute: vi.fn().mockResolvedValue([{ id: LEAD_1 }]),
  };
  return appRouter.createCaller({
    db,
    session: { session: { id: 'session-id', userId: USER_ID }, user },
    user,
  } as unknown as Parameters<typeof appRouter.createCaller>[0]);
}

/** The console methods spied on: console.info, log, warn and error share one signature */
let info: MockInstance<typeof console.info>;
let consoleSpies: MockInstance<typeof console.info>[];

/** The usage lines written so far, parsed */
const usageLines = () =>
  info.mock.calls
    .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
    .filter((line) => line.event === AI_USAGE_EVENT);

/** Everything handed to the console, as one text */
const everythingLogged = () =>
  consoleSpies.flatMap((spy) => spy.mock.calls.flat()).map((arg) => String(arg)).join('\n');

const expectNothingPersonal = () => {
  const logged = everythingLogged();
  for (const value of [
    ...Object.values(PERSONAL),
    COMPANY,
    LEAD_1,
    LEAD_2,
    REASONING,
    SUMMARY,
    '<lead_data>',
  ]) {
    expect(logged).not.toContain(value);
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');
  sdk.consumeRateLimits.mockResolvedValue({ allowed: true });
  sdk.create.mockResolvedValue(summaryResponse);
  sdk.embed.mockResolvedValue(embeddingResponse);
  info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  consoleSpies = [
    info,
    vi.spyOn(console, 'log').mockImplementation(() => undefined),
    vi.spyOn(console, 'warn').mockImplementation(() => undefined),
    vi.spyOn(console, 'error').mockImplementation(() => undefined),
  ];
});
afterEach(() => {
  // The console and performance.now spies
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('logAiUsage', () => {
  const call = {
    operation: 'score-lead' as const,
    organizationId: ORG_ID,
    model: CLAUDE_MODEL,
    startedAt: 1_000,
  };

  it('writes one line of JSON with the operation, organization, model, tokens and time', () => {
    vi.spyOn(performance, 'now').mockReturnValueOnce(1_250.4);

    logAiUsage(call, {
      model: 'claude-sonnet-5-5-20260801',
      usage: {
        input_tokens: 812,
        output_tokens: 95,
        cache_read_input_tokens: 1_024,
        cache_creation_input_tokens: 0,
      },
    });

    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]).toHaveLength(1);
    const [line] = info.mock.calls[0] as [string];
    expect(line).not.toContain('\n');
    expect(JSON.parse(line)).toEqual({
      event: 'ai.usage',
      operation: 'score-lead',
      organizationId: ORG_ID,
      model: 'claude-sonnet-5-5-20260801',
      inputTokens: 812,
      outputTokens: 95,
      cacheReadInputTokens: 1_024,
      cacheCreationInputTokens: 0,
      durationMs: 250,
    });
  });

  it('names the model asked for when the response has none, and leaves out absent cache counts', () => {
    logAiUsage(call, {
      usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: null },
    });

    const [line] = usageLines();
    expect(line.model).toBe(CLAUDE_MODEL);
    expect(line).not.toHaveProperty('cacheReadInputTokens');
    expect(line).not.toHaveProperty('cacheCreationInputTokens');
  });

  it('counts the input tokens of an embedding, which has no output tokens', () => {
    logAiUsage(
      { ...call, operation: 'embed-lead', model: 'text-embedding-3-small' },
      embeddingResponse
    );

    expect(usageLines()[0]).toMatchObject({
      operation: 'embed-lead',
      model: 'text-embedding-3-small',
      inputTokens: 9,
      outputTokens: 0,
    });
  });

  it('logs null counts for a response without usage', () => {
    logAiUsage(call, {});

    expect(usageLines()[0]).toMatchObject({ inputTokens: null, outputTokens: null });
  });

  it('never throws, even when the response is missing or the console fails', () => {
    expect(() =>
      logAiUsage(call, undefined as unknown as Parameters<typeof logAiUsage>[1])
    ).not.toThrow();
    info.mockImplementation(() => {
      throw new Error('console is gone');
    });
    expect(logAiUsage(call, { usage })).toBeUndefined();
  });
});

describe('usage line of each AI call', () => {
  it('scoring a lead logs one line', async () => {
    sdk.create.mockResolvedValue(scoreResponse);

    const result = await createCaller().ai.scoreLead({ organizationId: ORG_ID, leadId: LEAD_1 });

    expect(result.aiScore).toMatchObject({ score: 82, isFallback: false });
    expect(usageLines()).toEqual([
      {
        event: 'ai.usage',
        operation: 'score-lead',
        organizationId: ORG_ID,
        model: CLAUDE_MODEL,
        inputTokens: 812,
        outputTokens: 95,
        durationMs: expect.any(Number),
      },
    ]);
    expect(usageLines()[0].durationMs).toBeGreaterThanOrEqual(0);
    expectNothingPersonal();
  });

  it('a batch of scores logs one line for each lead', async () => {
    sdk.create.mockResolvedValue(scoreResponse);

    await createCaller().ai.batchScoreLeads({ organizationId: ORG_ID, leadIds: [LEAD_1, LEAD_2] });

    expect(sdk.create).toHaveBeenCalledTimes(2);
    expect(usageLines()).toHaveLength(2);
    for (const line of usageLines()) {
      expect(line).toMatchObject({
        operation: 'score-lead',
        organizationId: ORG_ID,
        inputTokens: 812,
        outputTokens: 95,
      });
    }
    expectNothingPersonal();
  });

  it('a prediction logs one line, and a batch one line for each lead', async () => {
    sdk.create.mockResolvedValue(predictionResponse);
    const caller = createCaller();

    const { prediction } = await caller.ai.predictConversion({
      organizationId: ORG_ID,
      leadId: LEAD_1,
    });
    expect(prediction.probability).toBe(64);
    expect(usageLines()).toEqual([
      {
        event: 'ai.usage',
        operation: 'predict-conversion',
        organizationId: ORG_ID,
        model: CLAUDE_MODEL,
        inputTokens: 1430,
        outputTokens: 210,
        durationMs: expect.any(Number),
      },
    ]);

    await caller.ai.batchPredictConversion({ organizationId: ORG_ID, leadIds: [LEAD_1, LEAD_2] });
    expect(usageLines()).toHaveLength(3);
    expect(usageLines().every((line) => line.operation === 'predict-conversion')).toBe(true);
    expectNothingPersonal();
  });

  it('a summary logs one line, with the cache count the SDK returned', async () => {
    const { summary } = await createCaller().ai.generateSummary({
      organizationId: ORG_ID,
      leadId: LEAD_1,
    });

    expect(summary).toBe(SUMMARY);
    expect(usageLines()).toEqual([
      {
        event: 'ai.usage',
        operation: 'lead-summary',
        organizationId: ORG_ID,
        model: CLAUDE_MODEL,
        inputTokens: 640,
        outputTokens: 120,
        cacheReadInputTokens: 0,
        durationMs: expect.any(Number),
      },
    ]);
    expectNothingPersonal();
  });

  it('the embeddings of a search and of a lead log one line each', async () => {
    const caller = createCaller();

    await caller.ai.semanticSearch({ organizationId: ORG_ID, query: '製造業で基幹システムが古い' });
    await caller.ai.updateEmbedding({ organizationId: ORG_ID, leadId: LEAD_1 });

    expect(usageLines()).toEqual([
      {
        event: 'ai.usage',
        operation: 'embed-search-query',
        organizationId: ORG_ID,
        model: 'text-embedding-3-small',
        inputTokens: 9,
        outputTokens: 0,
        durationMs: expect.any(Number),
      },
      expect.objectContaining({ operation: 'embed-lead', organizationId: ORG_ID }),
    ]);
    expect(everythingLogged()).not.toContain('製造業で基幹システムが古い');
    expectNothingPersonal();
  });

  it('logs no person or lead content even when a caller hands the whole lead row over', async () => {
    sdk.create.mockResolvedValueOnce(scoreResponse).mockResolvedValueOnce(predictionResponse);
    const row = leadRow(LEAD_1);
    const scope = { organizationId: ORG_ID };

    await scoreLeadWithAI(row, scope);
    await predictConversion(row, { hasName: true, hasPhone: true }, scope);
    await generateLeadSummary(row, scope);
    await generateEmbedding(`${COMPANY} ${PERSONAL.notes}`, { operation: 'embed-lead', ...scope });

    expect(usageLines().map((line) => line.operation)).toEqual([
      'score-lead',
      'predict-conversion',
      'lead-summary',
      'embed-lead',
    ]);
    expectNothingPersonal();
  });

  // Billed answers without a usable structured output (structured outputs docs: a refusal or a
  // reply cut off at max_tokens may not match the schema). The SDK's parse of the text throws for
  // the first two, as messages.parse would have before the usage line was written.
  it.each([
    {
      answer: 'cut off inside the JSON at max_tokens',
      text: (output: object) => JSON.stringify(output).slice(0, 30),
      stopReason: 'max_tokens',
    },
    {
      answer: 'a refusal in plain text',
      text: () => 'I cannot help with that request.',
      stopReason: 'refusal',
    },
  ])('an answer $answer still logs its tokens, and falls back as before', async ({
    text,
    stopReason,
  }) => {
    const billed = { input_tokens: 812, output_tokens: 3_990 };
    sdk.create
      .mockResolvedValueOnce(claudeMessage(text(scoreOutput), billed, stopReason))
      .mockResolvedValueOnce(claudeMessage(text(predictionOutput), billed, stopReason));
    const caller = createCaller();
    const one = { organizationId: ORG_ID, leadId: LEAD_1 };

    await expect(caller.ai.scoreLead(one)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    const { prediction } = await caller.ai.predictConversion(one);

    // The heuristic fallback, not the answer
    expect(prediction.probability).not.toBe(predictionOutput.probability);
    expect(usageLines()).toEqual([
      expect.objectContaining({ operation: 'score-lead', inputTokens: 812, outputTokens: 3_990 }),
      expect.objectContaining({
        operation: 'predict-conversion',
        inputTokens: 812,
        outputTokens: 3_990,
      }),
    ]);
    // Not a misconfiguration: nobody on call is alerted
    expect(sdk.reportServerError).not.toHaveBeenCalled();
    expectNothingPersonal();
  });

  it('an answer that stopped while thinking (no text block) still logs its tokens', async () => {
    sdk.create.mockResolvedValue({
      ...scoreResponse,
      stop_reason: 'max_tokens',
      usage: { input_tokens: 812, output_tokens: 4_000 },
      content: [{ type: 'thinking', thinking: '', signature: 'sig' }],
    });
    const caller = createCaller();
    const one = { organizationId: ORG_ID, leadId: LEAD_1 };

    await expect(caller.ai.scoreLead(one)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    await caller.ai.predictConversion(one);

    expect(usageLines().map(({ operation, outputTokens }) => [operation, outputTokens])).toEqual([
      ['score-lead', 4_000],
      ['predict-conversion', 4_000],
    ]);
  });

  it('a failed call logs no usage and still reaches reportClaudeFailure', async () => {
    const unauthorized = Object.assign(new Error('invalid x-api-key'), { status: 401 });
    sdk.create.mockRejectedValue(unauthorized);
    const caller = createCaller();
    const one = { organizationId: ORG_ID, leadId: LEAD_1 };

    await expect(caller.ai.scoreLead(one)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    await caller.ai.predictConversion(one);
    expect((await caller.ai.generateSummary(one)).summary).toBe('Unable to generate summary');

    expect(usageLines()).toEqual([]);
    expect(sdk.reportServerError.mock.calls.map(([where]) => where)).toEqual([
      'ai/score-lead',
      'ai/predict-conversion',
      'ai/lead-summary',
    ]);
  });
});
