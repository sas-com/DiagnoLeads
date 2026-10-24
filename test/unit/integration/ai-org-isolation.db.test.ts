/**
 * Organization isolation of the AI features (#356) on a real PostgreSQL: an admin of
 * organization B passes the ids of A's leads, alone or mixed with B's own. A's leads are never
 * handed to the AI (scoring, summary, embedding, prediction, similar leads), their scores stay as
 * they were, and B's search stays in B. The AI services are stubs; the organization checks run
 * against the real database. All values are fictional.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/ai-org-isolation.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import { leads, organizationMembers, organizations, users } from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

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
    // The batch query fails today (#405), before anything is read: the point here is that A's
    // leads never reach the AI and keep their scores, whatever the outcome
    const before = await scoresOfA();
    for (const leadIds of [leadsA, [...leadsA, leadB]]) {
      await expect(
        adminB.ai.batchScoreLeads({ organizationId: orgB, leadIds })
      ).rejects.toBeDefined();
      await expect(
        adminB.ai.batchPredictConversion({ organizationId: orgB, leadIds })
      ).rejects.toBeDefined();
    }
    expect(leadIdsGiven().filter((id) => leadsA.includes(id as string))).toEqual([]);
    expect(await scoresOfA()).toEqual(before);
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

  it("searches B's leads only (semanticSearch)", async () => {
    await adminB.ai.semanticSearch({ organizationId: orgB, query: '基幹システム' });
    expect(ai.semanticSearch).toHaveBeenCalledWith(
      '基幹システム',
      orgB,
      expect.objectContaining({ limit: 10 })
    );
  });
});
