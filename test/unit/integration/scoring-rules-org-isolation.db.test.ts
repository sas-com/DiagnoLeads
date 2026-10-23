/**
 * Organization isolation of the scoringRules router (#356): a member of organization B who passes
 * the id of organization A's ruleset or lead gets NOT_FOUND, and A's rulesets and lead scores stay
 * as they were. Recalculating B's own leads never touches A's.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_test \
 *     bunx vitest --run test/unit/integration/scoring-rules-org-isolation.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import {
  leadScoringRulesets,
  leads,
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

describe.skipIf(!url)('scoringRules organization isolation (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organizationIds: string[] = [];
  const userIds: string[] = [];

  let orgA: string;
  let orgB: string;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let adminB: any;
  let rulesetA: string;
  let leadA: string;
  let leadB: string;

  async function createOrganization(name: string) {
    const [org] = await pg
      .insert(organizations)
      .values({ name, slug: `score-iso-${unique()}` })
      .returning();
    organizationIds.push(org.id);
    return org.id;
  }

  async function callerFor(organizationId: string) {
    const [user] = await pg
      .insert(users)
      .values({ email: `score-iso-${unique()}@example.com`, name: 'Score' })
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

  async function insertRuleset(organizationId: string, baseScore: number) {
    const [row] = await pg
      .insert(leadScoringRulesets)
      .values({ organizationId, name: 'Ruleset', baseScore, isDefault: true })
      .returning();
    return row.id;
  }

  async function insertLead(organizationId: string) {
    const [row] = await pg
      .insert(leads)
      .values({ organizationId, email: `lead-${unique()}@example.com`, status: 'new', score: 10 })
      .returning();
    return row.id;
  }

  const stateOfA = async () => ({
    rulesets: await pg
      .select()
      .from(leadScoringRulesets)
      .where(eq(leadScoringRulesets.organizationId, orgA)),
    leads: await pg.select().from(leads).where(eq(leads.organizationId, orgA)),
  });

  beforeAll(async () => {
    orgA = await createOrganization('スコア切り分けA');
    orgB = await createOrganization('スコア切り分けB');
    adminB = await callerFor(orgB);
    rulesetA = await insertRuleset(orgA, 90);
    leadA = await insertLead(orgA);
    leadB = await insertLead(orgB);
  });

  afterAll(async () => {
    if (organizationIds.length > 0) {
      await pg.delete(organizations).where(inArray(organizations.id, organizationIds));
    }
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  const asB = () => ({ organizationId: orgB });

  const calls: Record<string, () => Promise<unknown>> = {
    get: () => adminB.scoringRules.get({ ...asB(), id: rulesetA }),
    update: () => adminB.scoringRules.update({ ...asB(), id: rulesetA, name: 'Changed by B' }),
    delete: () => adminB.scoringRules.delete({ ...asB(), id: rulesetA }),
    simulateScore: () =>
      adminB.scoringRules.simulateScore({ ...asB(), rulesetId: rulesetA, leadData: {} }),
    'calculateScore (lead of A)': () =>
      adminB.scoringRules.calculateScore({ ...asB(), leadId: leadA }),
    'calculateScore (ruleset of A)': () =>
      adminB.scoringRules.calculateScore({ ...asB(), leadId: leadB, rulesetId: rulesetA }),
    'recalculateAll (ruleset of A)': () =>
      adminB.scoringRules.recalculateAll({ ...asB(), rulesetId: rulesetA }),
  };

  it.each(Object.keys(calls))('%s with ids of another organization answers NOT_FOUND', async (name) => {
    const before = await stateOfA();
    const [leadBBefore] = await pg.select().from(leads).where(eq(leads.id, leadB));
    await expect(calls[name]()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await stateOfA()).toEqual(before);
    const [leadBAfter] = await pg.select().from(leads).where(eq(leads.id, leadB));
    expect(leadBAfter.score).toBe(leadBBefore.score);
  });

  it("recalculating B's own leads never touches A's", async () => {
    await insertRuleset(orgB, 70);
    const before = await stateOfA();
    await adminB.scoringRules.recalculateAll(asB());
    expect(await stateOfA()).toEqual(before);
    const [after] = await pg.select().from(leads).where(eq(leads.id, leadB));
    expect(after.score).toBe(70);
  });

  it("refuses A's organizationId to a member of B", async () => {
    await expect(
      adminB.scoringRules.get({ organizationId: orgA, id: rulesetA })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
