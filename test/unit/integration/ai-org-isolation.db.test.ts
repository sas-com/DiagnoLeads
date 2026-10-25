/**
 * Organization isolation of the AI features (#356) on a real PostgreSQL: an admin of
 * organization B passes the ids of A's leads, alone or mixed with B's own. A's leads are never
 * handed to the AI (scoring, summary, embedding, prediction, similar leads), their scores stay as
 * they were, and B's search stays in B. The Claude calls are counted against AI_CALL_LIMITS
 * (#405) and the OpenAI embeddings against EMBEDDING_CALL_LIMITS (#576), concurrent calls (a
 * batched HTTP request) included. The AI services are stubs; the
 * organization checks and the counting run against the real database. The functions that store
 * and compare the embeddings (lib/features/ai/search/semantic.ts) also run on it, with OpenAI
 * stubbed: they run on the caller's database (ctx.db, never the global client), write and read a
 * lead only in the organization named (#583), and return the organization's leads most similar
 * first (#590). All values are fictional.
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
import { AI_CALL_LIMITS, EMBEDDING_CALL_LIMITS } from '@/lib/features/ai/limits';
import type * as Semantic from '@/lib/features/ai/search/semantic';
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
    predictConversionBatch: vi.fn(async (rows: { lead: { id: string } }[]) =>
      byId(
        rows.map(({ lead }) => lead),
        { probability: 0.5 }
      )
    ),
    generateLeadSummary: vi.fn(async () => 'まとめ'),
    semanticSearch: vi.fn<typeof Semantic.semanticSearch>(async () => []),
    findSimilarLeads: vi.fn<typeof Semantic.findSimilarLeads>(async () => []),
    updateLeadEmbedding: vi.fn<typeof Semantic.updateLeadEmbedding>(async () => true),
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
// The OpenAI embedding the real semantic.ts functions get (kept apart from the stubs above, whose
// calls leadIdsGiven reads)
const openai = vi.hoisted(() => ({
  generateEmbedding: vi.fn<(text: string) => Promise<number[]>>(),
}));
vi.mock('@/lib/features/ai/embeddings/openai', () => ({
  prepareLeadText: ai.prepareLeadText,
  generateEmbedding: openai.generateEmbedding,
}));
// semantic.ts runs on the caller's database (ctx.db, #590): any use of the app's global client
// fails the test
vi.mock('@/lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db')>()),
  db: new Proxy(
    {},
    {
      get: (_target, property) => {
        if (typeof property === 'symbol' || property === 'then') return undefined;
        throw new Error(`the global db was used (db.${property}); pass ctx.db instead`);
      },
    }
  ),
}));

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
  /** Organizations a test created for itself, deleted with A and B */
  const otherOrganizations: string[] = [];

  /** Every lead id any AI stub was given (as an id, a lead, or the leadId of named arguments) */
  const leadIdsGiven = () =>
    Object.values(ai)
      .flatMap((stub) => (stub.mock.calls as unknown[][]).flat())
      .flatMap((arg) => (Array.isArray(arg) ? arg : [arg]))
      .map((arg) => {
        if (typeof arg === 'string') return arg;
        // The semantic functions take named arguments (#590); the batch prediction is handed
        // { lead, contact } pairs (#406)
        const item = arg as { id?: string; leadId?: string; lead?: { id?: string } } | null;
        return item?.id ?? item?.leadId ?? item?.lead?.id;
      })
      .filter(Boolean);
  /** The real semantic.ts (the router tests use the stubs above) */
  const actualSemantic = () =>
    vi.importActual<typeof Semantic>('@/lib/features/ai/search/semantic');
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
    const organizationIds = [orgA, orgB, ...otherOrganizations].filter(Boolean);
    if (organizationIds.length > 0) {
      await pg.delete(organizations).where(inArray(organizations.id, organizationIds));
    }
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    const counters = [AI_CALL_LIMITS, EMBEDDING_CALL_LIMITS].flatMap((limits) => [
      ...userIds.map((id) => rateLimitKey(limits.perUser, id)),
      ...organizationIds.flatMap((id) => [
        rateLimitKey(limits.perOrganization, id),
        rateLimitKey(limits.perOrganizationDaily, id),
      ]),
    ]);
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

  it("searches B's leads only, on the caller's database (semanticSearch)", async () => {
    await adminB.ai.semanticSearch({ organizationId: orgB, query: '基幹システム' });
    expect(ai.semanticSearch).toHaveBeenCalledTimes(1);
    const [named] = ai.semanticSearch.mock.calls[0];
    expect(named).toMatchObject({ query: '基幹システム', organizationId: orgB, limit: 10 });
    expect(named.db).toBe(pg);
  });

  it('counts every concurrent embedding in counters of its own, and nothing for A or a refused caller (#576)', async () => {
    const counted = (key: string) =>
      pg
        .select({ count: publicRateLimits.count })
        .from(publicRateLimits)
        .where(eq(publicRateLimits.key, key))
        .then(([row]) => row?.count ?? 0);
    const userKey = rateLimitKey(EMBEDDING_CALL_LIMITS.perUser, memberBId);
    const orgKey = rateLimitKey(EMBEDDING_CALL_LIMITS.perOrganization, orgB);
    const claudeOrgKey = rateLimitKey(AI_CALL_LIMITS.perOrganization, orgB);
    const [userBefore, orgBefore, claudeBefore] = await Promise.all(
      [userKey, orgKey, claudeOrgKey].map(counted)
    );
    const embedded = () =>
      ai.semanticSearch.mock.calls.length + ai.updateLeadEmbedding.mock.calls.length;

    // A's lead, or organization A itself: refused before anything is counted
    await expect(
      memberB.ai.updateEmbedding({ organizationId: orgB, leadId: leadsA[0] })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      memberB.ai.semanticSearch({ organizationId: orgA, query: '基幹システム' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await counted(userKey)).toBe(userBefore);
    expect(await counted(orgKey)).toBe(orgBefore);

    // One embedding left for this user in the hour
    await consumeRateLimit(
      pg,
      EMBEDDING_CALL_LIMITS.perUser,
      memberBId,
      new Date(),
      EMBEDDING_CALL_LIMITS.perUser.limit - 1 - userBefore
    );
    // Three calls at once, as one batched HTTP request runs them
    const results = await Promise.allSettled([
      memberB.ai.semanticSearch({ organizationId: orgB, query: '基幹システム' }),
      memberB.ai.updateEmbedding({ organizationId: orgB, leadId: leadB }),
      memberB.ai.semanticSearch({ organizationId: orgB, query: '製造業' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const refused = results.filter((result) => result.status === 'rejected');
    expect(refused).toHaveLength(2);
    for (const result of refused) {
      expect((result as PromiseRejectedResult).reason).toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    }
    expect(embedded()).toBe(1);
    // The organization counted only the call that ran, and the Claude calls none of them
    expect(await counted(orgKey)).toBe(orgBefore + 1);
    expect(await counted(claudeOrgKey)).toBe(claudeBefore);
  });

  it("stores and compares embeddings in the organization named only: A's lead is neither written nor the base of B's search (updateLeadEmbedding, findSimilarLeads, #583)", async () => {
    // The real functions (the router tests above use stubs), on the test database
    const { findSimilarLeads, updateLeadEmbedding } = await actualSemantic();
    // A 1536-dimension embedding that points mostly along one axis
    const along = (axis: number) =>
      Array.from({ length: 1536 }, (_, index) => (index === axis ? 1 : 0.01));
    const embeddingsOf = async (ids: string[]) =>
      new Map(
        (
          await pg
            .select({ id: leads.id, embedding: leads.embedding })
            .from(leads)
            .where(inArray(leads.id, ids))
        ).map((row) => [row.id, row.embedding])
      );
    const store = (leadId: string, organizationId: string) =>
      updateLeadEmbedding({ db: pg, leadId, organizationId, text: 'テキスト' });
    const [nearB] = await pg
      .insert(leads)
      .values({ organizationId: orgB, email: `ai-iso-b3-${unique()}@example.co.jp` })
      .returning({ id: leads.id });

    // A's lead with organization B named: not written, and reported as not written (#590)
    openai.generateEmbedding.mockResolvedValue(along(0));
    await expect(store(leadsA[0], orgB)).resolves.toBe(false);
    expect((await embeddingsOf([leadsA[0]])).get(leadsA[0])).toBeNull();

    // Each lead with its own organization named: written
    await expect(store(leadsA[0], orgA)).resolves.toBe(true);
    openai.generateEmbedding.mockResolvedValue(along(1));
    await expect(store(leadB, orgB)).resolves.toBe(true);
    openai.generateEmbedding.mockResolvedValue(along(2));
    await expect(store(nearB.id, orgB)).resolves.toBe(true);
    const stored = await embeddingsOf([leadsA[0], leadB, nearB.id]);
    expect(stored.get(leadsA[0])?.[0]).toBe(1);
    expect(stored.get(leadB)?.[1]).toBe(1);
    expect(stored.get(nearB.id)?.[2]).toBe(1);

    // The comparison query runs on the database passed; the reason of a failure is only logged
    const comparisons = vi.spyOn(pg, 'execute');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const loggedReasons = () =>
      logged.mock.calls.map((call) => (call[1] as Error | undefined)?.message);
    try {
      // A's lead (it has an embedding now) is not read as the base of a search in B: no search
      await expect(
        findSimilarLeads({ db: pg, leadId: leadsA[0], organizationId: orgB })
      ).rejects.toThrow('Finding similar leads failed');
      expect(loggedReasons()).toContain('Reference lead not found or has no embedding');
      expect(comparisons).not.toHaveBeenCalled();

      // B's own lead is read as the base, and the search in B finds B's other lead with an
      // embedding only: not A's, although A's is as close to the base as nearB
      logged.mockClear();
      const similar = await findSimilarLeads({ db: pg, leadId: leadB, organizationId: orgB });
      expect(similar.map((lead) => lead.id)).toEqual([nearB.id]);
      expect(comparisons).toHaveBeenCalledTimes(1);
      expect(logged).not.toHaveBeenCalled();
    } finally {
      comparisons.mockRestore();
      logged.mockRestore();
    }
  });

  describe('comparing the embeddings on PostgreSQL (#590)', () => {
    // Small fixed directions, padded with zeros to the 1536 dimensions of the column
    const vec = (...head: number[]) => [
      ...head,
      ...Array.from({ length: 1536 - head.length }, () => 0),
    ];
    const leadOf = (organizationId: string, label: string, embedding: number[] | null) => ({
      organizationId,
      name: `類似${label}`,
      company: `架空${label}株式会社`,
      email: `ai-sim-${label}-${unique()}@example.co.jp`,
      embedding,
    });
    let orgC: string;
    let orgD: string;
    const fixtures = new Map<
      string,
      { id: string; name: string | null; email: string; company: string | null }
    >();
    const id = (label: string) => fixtures.get(label)?.id;
    /** The result expected for a lead: its columns and its similarity, nothing else */
    const found = (label: string, similarity: number) => ({
      ...fixtures.get(label),
      similarity: expect.closeTo(similarity, 5),
    });
    const NEAR = 1 / Math.sqrt(1.04); // (1, 0.2) against (1, 0)
    const MID = Math.SQRT1_2; // (1, 1) against (1, 0)

    beforeAll(async () => {
      const created = await pg
        .insert(organizations)
        .values([
          { name: '類似C', slug: `ai-sim-c-${unique()}` },
          { name: '類似D', slug: `ai-sim-d-${unique()}` },
        ])
        .returning({ id: organizations.id });
      orgC = created[0].id;
      orgD = created[1].id;
      otherOrganizations.push(orgC, orgD);
      // B's admin is an admin of C too, to call the router there
      await pg
        .insert(organizationMembers)
        .values({ organizationId: orgC, userId: userIds[0], role: 'admin' });
      // Stored through the vector column type, as updateLeadEmbedding's readers get them back
      const rows = await pg
        .insert(leads)
        .values([
          leadOf(orgC, 'base', vec(1)),
          leadOf(orgC, 'near', vec(1, 0.2)),
          leadOf(orgC, 'mid', vec(1, 1)),
          leadOf(orgC, 'far', vec(0, 0, 1)),
          leadOf(orgC, 'none', null),
          // D's twin points the same way as C's base (similarity 1): a search that left its
          // organization would put it first
          leadOf(orgD, 'twin', vec(1)),
          leadOf(orgD, 'other', vec(1, 0.1)),
        ])
        .returning({ id: leads.id, name: leads.name, email: leads.email, company: leads.company });
      for (const row of rows) fixtures.set(row.name?.replace('類似', '') ?? '', row);
    });

    it("returns the organization's other leads with an embedding, most similar first, never another organization's (findSimilarLeads)", async () => {
      const { findSimilarLeads } = await actualSemantic();
      const base = { db: pg, leadId: id('base') ?? '', organizationId: orgC };

      expect(await findSimilarLeads(base)).toEqual([
        found('near', NEAR),
        found('mid', MID),
        found('far', 0),
      ]);
      expect(await findSimilarLeads({ ...base, limit: 2 })).toEqual([
        found('near', NEAR),
        found('mid', MID),
      ]);
      // From D's twin, D's other lead only, although C's base points the same way as the twin
      expect(
        await findSimilarLeads({ db: pg, leadId: id('twin') ?? '', organizationId: orgD })
      ).toEqual([found('other', 1 / Math.sqrt(1.01))]);

      // D's lead is never the base of a search in C
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        await expect(
          findSimilarLeads({ db: pg, leadId: id('twin') ?? '', organizationId: orgC })
        ).rejects.toThrow('Finding similar leads failed');
        expect(logged.mock.calls.map((call) => (call[1] as Error).message)).toEqual([
          'Reference lead not found or has no embedding',
        ]);
      } finally {
        logged.mockRestore();
      }
    });

    it("returns the organization's leads only, most similar to the query first (semanticSearch)", async () => {
      const { semanticSearch } = await actualSemantic();
      openai.generateEmbedding.mockResolvedValue(vec(1));
      const search = { db: pg, query: '基幹システム', organizationId: orgC };

      // The default threshold (0.7) keeps base, near and mid; D's twin (1) is not C's
      expect(await semanticSearch(search)).toEqual([
        found('base', 1),
        found('near', NEAR),
        found('mid', MID),
      ]);
      expect(await semanticSearch({ ...search, minSimilarity: 0 })).toEqual([
        found('base', 1),
        found('near', NEAR),
        found('mid', MID),
        found('far', 0),
      ]);
      expect(await semanticSearch({ ...search, minSimilarity: 0, limit: 2 })).toEqual([
        found('base', 1),
        found('near', NEAR),
      ]);
      expect(openai.generateEmbedding).toHaveBeenCalledWith('基幹システム');
    });

    it('runs the procedures with the real functions on ctx.db (findSimilar, semanticSearch)', async () => {
      const actual = await actualSemantic();
      ai.findSimilarLeads.mockImplementationOnce(actual.findSimilarLeads);
      ai.semanticSearch.mockImplementationOnce(actual.semanticSearch);
      openai.generateEmbedding.mockResolvedValue(vec(1));
      const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

      expect(ids(await adminB.ai.findSimilar({ organizationId: orgC, leadId: id('base') }))).toEqual(
        [id('near'), id('mid'), id('far')]
      );
      expect(
        ids(await adminB.ai.semanticSearch({ organizationId: orgC, query: '基幹システム' }))
      ).toEqual([id('base'), id('near'), id('mid')]);
      expect(ai.findSimilarLeads.mock.calls[0][0].db).toBe(pg);
      expect(ai.semanticSearch.mock.calls[0][0].db).toBe(pg);
    });

    it('stores the embedding through the router, and answers NOT_FOUND, not success, when the lead is gone before it is stored (updateEmbedding)', async () => {
      const actual = await actualSemantic();
      ai.updateLeadEmbedding.mockImplementation(actual.updateLeadEmbedding);
      const [kept, gone] = await pg
        .insert(leads)
        .values([leadOf(orgC, 'kept', null), leadOf(orgC, 'gone', null)])
        .returning({ id: leads.id });
      try {
        openai.generateEmbedding.mockResolvedValue(vec(0, 1));
        await expect(
          adminB.ai.updateEmbedding({ organizationId: orgC, leadId: kept.id })
        ).resolves.toEqual({ success: true });
        const [row] = await pg
          .select({ embedding: leads.embedding })
          .from(leads)
          .where(eq(leads.id, kept.id));
        expect(row.embedding).toEqual(vec(0, 1));
        expect(ai.updateLeadEmbedding.mock.calls[0][0].db).toBe(pg);

        // Read in C by the router, then deleted while OpenAI answers: nothing is written
        openai.generateEmbedding.mockImplementationOnce(async () => {
          await pg.delete(leads).where(eq(leads.id, gone.id));
          return vec(0, 1);
        });
        await expect(
          adminB.ai.updateEmbedding({ organizationId: orgC, leadId: gone.id })
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      } finally {
        ai.updateLeadEmbedding.mockImplementation(async () => true);
        await pg.delete(leads).where(inArray(leads.id, [kept.id, gone.id]));
      }
    });
  });
});
