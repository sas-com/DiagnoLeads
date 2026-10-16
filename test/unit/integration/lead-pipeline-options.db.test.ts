/**
 * Lead agency / acquisition cost and the date each deal phase was first reached (#83),
 * through the leads router on a real PostgreSQL.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_test \
 *     bunx vitest --run test/unit/integration/lead-pipeline-options.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import { leads, organizationMembers, organizations, users } from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('lead pipeline options (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let organizationId: string;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let caller: any;

  beforeAll(async () => {
    const [org] = await pg
      .insert(organizations)
      .values({ name: 'パイプラインテスト株式会社', slug: `pipe-${unique()}` })
      .returning();
    organizationId = org.id;
    const [user] = await pg
      .insert(users)
      .values({ email: `pipe-${unique()}@example.com`, name: 'テスト 太郎' })
      .returning();
    await pg.insert(organizationMembers).values({ organizationId, userId: user.id, role: 'admin' });
    caller = appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId: user.id }, user },
      user,
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);
  });

  afterAll(async () => {
    if (organizationId) await pg.delete(organizations).where(eq(organizations.id, organizationId));
    await client?.end();
  });

  it('stores the agency, the cost and the first date of the phase on create', async () => {
    const lead = await caller.leads.create({
      organizationId,
      email: `lead-${unique()}@example.co.jp`,
      name: '山田 花子',
      inflowSource: 'telemarketing_agency',
      agencyName: 'テスト代行',
      acquisitionCost: 20000,
      dealPhase: 'initial_hearing',
      targetSystem: 'package',
      lostReason: null,
    });

    const [row] = await pg.select().from(leads).where(eq(leads.id, lead.id));
    expect(row.inflowSource).toBe('telemarketing_agency');
    expect(row.agencyName).toBe('テスト代行');
    expect(row.acquisitionCost).toBe(20000);
    expect(row.targetSystem).toBe('package');
    expect(Object.keys(row.dealPhaseReachedAt)).toEqual(['initial_hearing']);
    expect(row.dealPhaseReachedAt.initial_hearing).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('adds each new phase and keeps the first date of a phase reached again', async () => {
    const lead = await caller.leads.create({
      organizationId,
      email: `lead-${unique()}@example.co.jp`,
      name: '佐藤 次郎',
      dealPhase: 'initial_hearing',
    });
    // Pretend the first phase was reached long ago
    await pg
      .update(leads)
      .set({ dealPhaseReachedAt: { initial_hearing: '2026-01-05' } })
      .where(eq(leads.id, lead.id));

    await caller.leads.update({ organizationId, id: lead.id, dealPhase: 'proposal' });
    await caller.leads.update({ organizationId, id: lead.id, dealPhase: 'initial_hearing' });
    await caller.leads.update({ organizationId, id: lead.id, lostReason: 'on_hold' });

    const [row] = await pg.select().from(leads).where(eq(leads.id, lead.id));
    expect(row.dealPhaseReachedAt.initial_hearing).toBe('2026-01-05');
    expect(row.dealPhaseReachedAt.proposal).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(row.dealPhase).toBe('initial_hearing');
    expect(row.lostReason).toBe('on_hold');
  });

  it('leaves the dates alone when the phase is cleared', async () => {
    const lead = await caller.leads.create({
      organizationId,
      email: `lead-${unique()}@example.co.jp`,
      name: '鈴木 三郎',
      dealPhase: 'proposal',
    });

    await caller.leads.update({ organizationId, id: lead.id, dealPhase: null });

    const [row] = await pg.select().from(leads).where(eq(leads.id, lead.id));
    expect(row.dealPhase).toBeNull();
    expect(Object.keys(row.dealPhaseReachedAt)).toEqual(['proposal']);
  });
});
