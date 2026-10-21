/**
 * Delivery reviews and the phased delivery report (#159) on a real PostgreSQL: saving and reading
 * a review with the lead's latest AX diagnosis, the phase 1 → 2 → 3 tallies from the deal phase
 * dates, the diagnosis next to the reviews, who may edit, and other organizations. All values
 * are made up.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/delivery-reviews.db.test.ts
 */
import type { Database } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import {
  diagnosticSubmissions,
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

describe.skipIf(!url)('delivery reviews (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)! as unknown as Database;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const orgIds: string[] = [];
  const userIds: string[] = [];
  let org: string;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
  const callers: Record<'rep' | 'viewer', any> = {} as never;

  const review = {
    checkpointOutcomes: { gaiji: 'hard', legacy_edi: 'as_expected', integrations_many: 'hard' },
    actualDifficulty: 'high',
    estimatedEffort: 8,
    actualEffort: 10,
    note: '外字が想定より多かった',
  };

  beforeAll(async () => {
    for (const name of ['振り返りテスト', '振り返りテスト別組織']) {
      const [row] = await pg
        .insert(organizations)
        .values({ name, slug: `delivery-${unique()}` })
        .returning();
      orgIds.push(row.id);
    }
    org = orgIds[0];
    for (const [key, role] of [
      ['rep', 'member'],
      ['viewer', 'parent_viewer'],
    ] as const) {
      const [user] = await pg
        .insert(users)
        .values({ email: `delivery-${key}-${unique()}@example.com`, name: '営業 太郎' })
        .returning();
      userIds.push(user.id);
      await pg.insert(organizationMembers).values({ organizationId: org, userId: user.id, role });
      callers[key] = appRouter.createCaller({
        db: pg,
        session: { session: { id: 's', userId: user.id }, user },
        user,
        // biome-ignore lint/suspicious/noExplicitAny: test context
      } as any);
    }
  });

  afterAll(async () => {
    for (const id of orgIds) await pg.delete(organizations).where(eq(organizations.id, id));
    await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  async function createLead(
    dealPhaseReachedAt: Record<string, string>,
    organizationId = org
  ): Promise<string> {
    const [lead] = await pg
      .insert(leads)
      .values({ organizationId, email: `delivery-${unique()}@example.co.jp`, dealPhaseReachedAt })
      .returning();
    return lead.id;
  }

  async function diagnose(leadId: string, createdAt: string, result: Record<string, unknown>) {
    await pg.insert(diagnosticSubmissions).values({
      organizationId: org,
      leadId,
      diagnosticKey: 'ax-migration',
      diagnosticVersion: 3,
      answers: {},
      result,
      createdAt: new Date(createdAt),
    });
  }

  it('saves a review and reads it back with the latest diagnosis', async () => {
    const leadId = await createLead({ survey_won: '2026-01-10' });
    await diagnose(leadId, '2026-01-01T00:00:00Z', { checkpoints: ['rpg3'], difficulty: { level: 'low' } });
    await diagnose(leadId, '2026-01-05T00:00:00Z', {
      checkpoints: ['gaiji', 'legacy_edi'],
      difficulty: { level: 'medium' },
    });
    let got = await callers.rep.deliveryReviews.get({ organizationId: org, leadId });
    expect(got).toMatchObject({
      review: null,
      canEdit: true,
      diagnosis: { checkpoints: ['gaiji', 'legacy_edi'], difficulty: 'medium' },
    });

    await callers.rep.deliveryReviews.save({ organizationId: org, leadId, review });
    got = await callers.rep.deliveryReviews.get({ organizationId: org, leadId });
    expect(got.review).toMatchObject({ ...review, updatedByName: '営業 太郎' });

    // A second save replaces it
    await callers.rep.deliveryReviews.save({
      organizationId: org,
      leadId,
      review: { ...review, actualEffort: 9.25, note: '' },
    });
    got = await callers.rep.deliveryReviews.get({ organizationId: org, leadId });
    expect(got.review).toMatchObject({ actualEffort: 9.3, note: null });
  });

  it('tallies phase 1 → 2 → 3 and puts the diagnosis next to the reviews', async () => {
    await createLead({ survey_won: '2026-02-01', migration_won: '2026-04-02', ax: '2026-10-01' });
    await createLead({ survey_won: '2026-03-01', migration_won: '2026-03-31' });
    await createLead({ proposal: '2026-03-01' });
    // Another organization does not count
    await createLead({ survey_won: '2026-03-01', migration_won: '2026-03-02' }, orgIds[1]);

    const report = await callers.rep.deliveryReviews.report({ organizationId: org });
    // The lead of the first test reached survey_won too
    expect(report.progress.reached).toEqual({ survey_won: 3, migration_won: 2, ax: 1 });
    expect(report.progress.steps[0]).toMatchObject({ started: 3, advanced: 2, rate: 66.7, medianDays: 45 });
    expect(report.progress.steps[1]).toMatchObject({ started: 2, advanced: 1, rate: 50, medianDays: 182 });

    expect(report.accuracy).toMatchObject({
      reviewed: 1,
      withDiagnosis: 1,
      difficultyMatchRate: 0,
      effort: { count: 1, over: 1 },
    });
    expect(report.accuracy.difficulty.medium.high).toBe(1);
    expect(report.accuracy.checkpoints).toEqual([
      { key: 'gaiji', flagged: 1, outcomes: { hard: 1, as_expected: 0, not_relevant: 0 }, missed: 0 },
      { key: 'integrations_many', flagged: 0, outcomes: { hard: 0, as_expected: 0, not_relevant: 0 }, missed: 1 },
      { key: 'legacy_edi', flagged: 1, outcomes: { hard: 0, as_expected: 1, not_relevant: 0 }, missed: 0 },
    ]);
  });

  it('lets parent viewers read, not save, and keeps other organizations out', async () => {
    const leadId = await createLead({ survey_won: '2026-05-01' });
    expect(await callers.viewer.deliveryReviews.get({ organizationId: org, leadId })).toMatchObject({
      canEdit: false,
    });
    await expect(
      callers.viewer.deliveryReviews.save({ organizationId: org, leadId, review })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const foreign = await createLead({ survey_won: '2026-05-01' }, orgIds[1]);
    await expect(
      callers.rep.deliveryReviews.get({ organizationId: org, leadId: foreign })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      callers.rep.deliveryReviews.save({ organizationId: org, leadId: foreign, review })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
