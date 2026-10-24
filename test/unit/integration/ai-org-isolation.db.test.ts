/**
 * Organization isolation of the AI features (#356) on a real PostgreSQL: an admin of
 * organization B passes the ids of A's leads, alone or mixed with B's own. A's leads are never
 * handed to the AI (scoring, summary, embedding, prediction, similar leads), their scores stay as
 * they were, and B's search stays in B. The Claude calls are counted against AI_CALL_LIMITS
 * (#405), concurrent calls (a batched HTTP request) included. The AI services are stubs; the
 * organization checks and the counting run against the real database. All values are fictional.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/ai-org-isolation.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import {
  leads,
  organizationMembers,
  organizations,
  publicRateLimits,
  users,
} from '@/lib/db/schema';
import { AI_CALL_LIMITS } from '@/lib/features/ai/limits';
import { consumeRateLimit, rateLimitKey } from '@/lib/features/diagnostics/rate-limit';
import { appRouter } from '@/server/routers/_app';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));
// Webhook deliveries of the scored leads are not the point here (and would outlive the client)
vi.mock('@/lib/features/webhooks/services/lead-events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/features/webhooks/services/lead-events')>()),
  emitLeadEvents: vi.fn(),
}));

// The AI services: stubs that record which leads they were given
const ai = vi.hoisted(() => {
  const byId = (rows: { id: string }[], value: unknown) =>
    new Map(rows.map((row) => [row.id, value]));
  return {
    scoreLeadWithAI: vi.fn(async () => ({ score: 99 })),
    scoreLeadsBatch: vi.fn(async (rows: { id: string }[]) => byId(rows, { score: 99 })),
    predictConversion: vi.fn(async () => ({ probability: 0.5 })),
    predictConversionBatch: vi.fn(async (rows: { id: string }[]) =>
      byId(rows, { probability: 0.5 })
    ),
    generateLeadSummary: vi.fn(async () => 'まとめ'),
    semanticSearch: vi.fn(async () => []),
    findSimilarLeads: vi.fn(async () => []),
    updateLeadEmbedding: vi.fn(async () => undefined),
    prepareLeadText: vi.fn(() => 'text'),
  };
});
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
vi.mock('@/lib/features/ai/search/semantic', () => ({
  semanticSearch: ai.semanticSearch,
  findSimilarLeads: ai.findSimilarLeads,
  updateLeadEmbedding: ai.updateLeadEmbedding,
}));
vi.mock('@/lib/features/ai/embeddings/openai', () => ({ prepareLeadText: ai.prepareLeadText }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('AI features: organization isolation (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let orgA: string;
  let orgB: string;
  const userIds: string[] = [];
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let adminB: any;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let memberB: any;
  let memberBId: string;
  const leadsA: string[] = [];
  let leadB: string;

  /** Every lead id any AI stub was given */
  const leadIdsGiven = () =>
    Object.values(ai)
      .flatMap((stub) => stub.mock.calls.flat())
      .flatMap((arg) => (Array.isArray(arg) ? arg : [arg]))
      .map((arg) => (typeof arg === 'string' ? arg : (arg as { id?: string } | null)?.id))
      .filter(Boolean);
  const scoresOfA = () =>
    pg.select({ id: leads.id, score: leads.score }).from(leads).where(inArray(leads.id, leadsA));

  beforeAll(async () => {
    const created = await pg
      .insert(organizations)
      .values([
        { name: 'AI切り分けA', slug: `ai-iso-a-${unique()}` },
        { name: 'AI切り分けB', slug: `ai-iso-b-${unique()}` },
      ])
      .returning({ id: organizations.id });
    orgA = created[0].id;
    orgB = created[1].id;
    const [user] = await pg
      .insert(users)
      .values({ email: `ai-iso-${unique()}@example.com`, name: 'テスト' })
      .returning();
    userIds.push(user.id);
    await pg
      .insert(organizationMembers)
      .values({ organizationId: orgB, userId: user.id, role: 'admin' });
    adminB = appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId: user.id }, user },
      user,
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);
    // A second user of B, for the rate limits: its own per-user counter starts at zero
    const [member] = await pg
      .insert(users)
      .values({ email: `ai-iso-m-${unique()}@example.com`, name: 'テスト2' })
      .returning();
    userIds.push(member.id);
    memberBId = member.id;
    await pg
      .insert(organizationMembers)
      .values({ organizationId: orgB, userId: member.id, role: 'member' });
    memberB = appRouter.createCaller({
      db: pg,
      session: { session: { id: 's2', userId: member.id }, user: member },
      user: member,
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);
    const rowsA = await pg
      .insert(leads)
      .values(
        [1, 2].map((n) => ({
          organizationId: orgA,
          email: `ai-iso-a${n}-${unique()}@example.co.jp`,
          score: 10 * n,
        }))
      )
      .returning({ id: leads.id });
    leadsA.push(...rowsA.map((row) => row.id));
    const [rowB] = await pg
      .insert(leads)
      .values({ organizationId: orgB, email: `ai-iso-b-${unique()}@example.co.jp`, score: 5 })
      .returning({ id: leads.id });
    leadB = rowB.id;
  });

  beforeEach(() => {
    for (const stub of Object.values(ai)) stub.mockClear();
  });

  afterAll(async () => {
    if (orgA) await pg.delete(organizations).where(inArray(organizations.id, [orgA, orgB]));
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    const counters = [
      ...userIds.map((id) => rateLimitKey(AI_CALL_LIMITS.perUser, id)),
      ...[orgA, orgB].flatMap((id) => [
        rateLimitKey(AI_CALL_LIMITS.perOrganization, id),
        rateLimitKey(AI_CALL_LIMITS.perOrganizationDaily, id),
      ]),
    ];
    await pg.delete(publicRateLimits).where(inArray(publicRateLimits.key, counters));
    await client?.end();
  });

  it("refuses B's admin when it names organization A itself", async () => {
    await expect(
      adminB.ai.scoreLead({ organizationId: orgA, leadId: leadsA[0] })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it("hands none of A's leads to the AI by their ids (scoreLead, findSimilar, generateSummary, updateEmbedding, predictConversion)", async () => {
    const before = await scoresOfA();
    const one = { organizationId: orgB, leadId: leadsA[0] };
    await expect(adminB.ai.scoreLead(one)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(adminB.ai.findSimilar(one)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(adminB.ai.generateSummary(one)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(adminB.ai.updateEmbedding(one)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(adminB.ai.predictConversion(one)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(leadIdsGiven()).toEqual([]);
    expect(await scoresOfA()).toEqual(before);
  });

  it("hands none of A's leads to the AI in a batch, alone or mixed with B's (batchScoreLeads, batchPredictConversion)", async () => {
    const before = await scoresOfA();
    // A's leads alone: none of them is in B
    await expect(
      adminB.ai.batchScoreLeads({ organizationId: orgB, leadIds: leadsA })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      adminB.ai.batchPredictConversion({ organizationId: orgB, leadIds: leadsA })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(leadIdsGiven()).toEqual([]);

    // Mixed with B's own: only B's lead is scored and predicted
    const mixed = { organizationId: orgB, leadIds: [...leadsA, leadB] };
    const scored = await adminB.ai.batchScoreLeads(mixed);
    expect(scored.leads.map((lead: { id: string }) => lead.id)).toEqual([leadB]);
    expect(scored.scores).toEqual([{ leadId: leadB, score: 99 }]);
    const predicted = await adminB.ai.batchPredictConversion(mixed);
    expect(predicted.predictions).toEqual([{ leadId: leadB, prediction: { probability: 0.5 } }]);

    expect(leadIdsGiven().filter((id) => leadsA.includes(id as string))).toEqual([]);
    expect(await scoresOfA()).toEqual(before);
    const [scoredB] = await pg
      .select({ score: leads.score })
      .from(leads)
      .where(eq(leads.id, leadB));
    expect(scoredB.score).toBe(99);
  });

  it('counts every concurrent Claude call: past the per-user limit none reaches Claude', async () => {
    const counted = (key: string) =>
      pg
        .select({ count: publicRateLimits.count })
        .from(publicRateLimits)
        .where(eq(publicRateLimits.key, key))
        .then(([row]) => row?.count ?? 0);
    const orgKey = rateLimitKey(AI_CALL_LIMITS.perOrganization, orgB);
    const orgBefore = await counted(orgKey);
    // Two calls left for this user in the hour
    await consumeRateLimit(
      pg,
      AI_CALL_LIMITS.perUser,
      memberBId,
      new Date(),
      AI_CALL_LIMITS.perUser.limit - 2
    );

    // Five calls at once, as one batched HTTP request runs them
    const one = { organizationId: orgB, leadId: leadB };
    const results = await Promise.allSettled([
      memberB.ai.scoreLead(one),
      memberB.ai.scoreLead(one),
      memberB.ai.generateSummary(one),
      memberB.ai.predictConversion(one),
      memberB.ai.scoreLead(one),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
    const refused = results.filter((result) => result.status === 'rejected');
    expect(refused).toHaveLength(3);
    for (const result of refused) {
      expect((result as PromiseRejectedResult).reason).toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    }
    const claudeCalls =
      ai.scoreLeadWithAI.mock.calls.length +
      ai.generateLeadSummary.mock.calls.length +
      ai.predictConversion.mock.calls.length;
    expect(claudeCalls).toBe(2);

    // A batch is refused whole, and the organization counted only the calls that ran
    await expect(
      memberB.ai.batchScoreLeads({ organizationId: orgB, leadIds: [leadB] })
    ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    expect(ai.scoreLeadsBatch).not.toHaveBeenCalled();
    expect(await counted(orgKey)).toBe(orgBefore + 2);
  });

  it("keeps B's lead score when the AI falls back, and stores a real score (scoreLead)", async () => {
    const one = { organizationId: orgB, leadId: leadB };
    const scoreOfB = async () =>
      (await pg.select({ score: leads.score }).from(leads).where(inArray(leads.id, [leadB])))[0]
        ?.score;
    const before = await scoreOfB();

    ai.scoreLeadWithAI.mockResolvedValueOnce({ score: 50, isFallback: true });
    await expect(adminB.ai.scoreLead(one)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(await scoreOfB()).toBe(before);

    ai.scoreLeadWithAI.mockResolvedValueOnce({ score: 77, isFallback: false });
    await adminB.ai.scoreLead(one);
    expect(await scoreOfB()).toBe(77);
  });

  it("keeps the score of B's leads the AI fell back on, and refuses a batch where all fell back (batchScoreLeads)", async () => {
    const [second] = await pg
      .insert(leads)
      .values({ organizationId: orgB, email: `ai-iso-b2-${unique()}@example.co.jp`, score: 6 })
      .returning({ id: leads.id });
    const scoresOf = async (ids: string[]) =>
      new Map(
        (await pg.select({ id: leads.id, score: leads.score }).from(leads).where(inArray(leads.id, ids))).map(
          (row) => [row.id, row.score]
        )
      );
    const ids = [leadB, second.id];
    const before = await scoresOf(ids);

    // Every lead fell back: nothing is written and the caller gets an error, not "0 scored"
    ai.scoreLeadsBatch.mockResolvedValueOnce(
      new Map(ids.map((id) => [id, { score: 50, isFallback: true }]))
    );
    await expect(
      adminB.ai.batchScoreLeads({ organizationId: orgB, leadIds: ids })
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(await scoresOf(ids)).toEqual(before);

    // One fell back: only the other is written, and the fallback is reported
    ai.scoreLeadsBatch.mockResolvedValueOnce(
      new Map([
        [leadB, { score: 50, isFallback: true }],
        [second.id, { score: 88, isFallback: false }],
      ])
    );
    const result = await adminB.ai.batchScoreLeads({ organizationId: orgB, leadIds: ids });
    expect(result.leads.map((lead: { id: string }) => lead.id)).toEqual([second.id]);
    expect(result.failedLeadIds).toEqual([leadB]);
    const after = await scoresOf(ids);
    expect(after.get(leadB)).toBe(before.get(leadB));
    expect(after.get(second.id)).toBe(88);
  });

  it("searches B's leads only (semanticSearch)", async () => {
    await adminB.ai.semanticSearch({ organizationId: orgB, query: '基幹システム' });
    expect(ai.semanticSearch).toHaveBeenCalledWith(
      '基幹システム',
      orgB,
      expect.objectContaining({ limit: 10 })
    );
  });
});
