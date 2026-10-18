/**
 * Pre-meeting prep card (#156) on a real PostgreSQL: saving and reading it, the draft source
 * (diagnosis on the lead, reasons of its latest AX answer, the organization's playbook), who may
 * edit and who gets the draft source. All names and questions are made up.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/lead-prep.db.test.ts
 */
import type { Database } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import {
  axSalesPlaybooks,
  diagnosticSubmissions,
  leads,
  organizationMembers,
  organizations,
  users,
} from '@/lib/db/schema';
import { emptyAxPlaybookContent } from '@/lib/features/ax-playbook/types/schemas';
import { appRouter } from '@/server/routers/_app';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('lead prep cards (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)! as unknown as Database;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const orgIds: string[] = [];
  const userIds: string[] = [];
  let org: string;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
  const callers: Record<'rep' | 'viewer', any> = {} as never;

  const card = {
    estimatedSystem: 'AS/400',
    estimatedSystemBasis: '求人に RPG',
    recentNews: '新工場を建設中',
    hypotheses: { people: '担当者が来年退職' },
    firstQuestions: ['保守の体制は？', '退職の予定は？', '今後の計画は？'],
  };

  beforeAll(async () => {
    for (const name of ['事前調査テスト', '事前調査テスト別組織']) {
      const [row] = await pg
        .insert(organizations)
        .values({ name, slug: `prep-${unique()}` })
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
        .values({ email: `prep-${key}-${unique()}@example.com`, name: '営業 太郎' })
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
    const content = emptyAxPlaybookContent();
    content.challenges.people.questions = ['手引きの質問1', '手引きの質問2'];
    content.challenges.cost.questions = ['手引きの質問3'];
    await pg.insert(axSalesPlaybooks).values({ organizationId: org, content });
  });

  afterAll(async () => {
    for (const id of orgIds) await pg.delete(organizations).where(eq(organizations.id, id));
    await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  async function createLead(values: Partial<typeof leads.$inferInsert> = {}, organizationId = org) {
    const [lead] = await pg
      .insert(leads)
      .values({
        organizationId,
        email: `prep-${unique()}@example.co.jp`,
        company: '架空商事',
        ...values,
      })
      .returning();
    return lead.id as string;
  }

  it('saves the card and reads it back with who updated it', async () => {
    const leadId = await createLead();
    expect((await callers.rep.leadPrep.get({ organizationId: org, leadId })).card).toBeNull();
    await callers.rep.leadPrep.save({ organizationId: org, leadId, card });
    let got = await callers.rep.leadPrep.get({ organizationId: org, leadId });
    expect(got.card).toMatchObject({ ...card, updatedByName: '営業 太郎' });

    // A second save replaces it; blanks are dropped
    await callers.rep.leadPrep.save({
      organizationId: org,
      leadId,
      card: { ...card, recentNews: ' ', hypotheses: { people: '', cost: '値上げ' } },
    });
    got = await callers.rep.leadPrep.get({ organizationId: org, leadId });
    expect(got.card).toMatchObject({ recentNews: null, hypotheses: { cost: '値上げ' } });
  });

  it('drafts from the diagnosis on the lead, its latest AX answer and the playbook', async () => {
    const leadId = await createLead({
      targetSystem: 'acos',
      responses: {
        axMigration: { targetSystem: 'as400', primaryChallenge: 'people', challenges: ['people', 'cost'] },
      },
    });
    for (const [createdAt, urgency] of [
      [new Date('2026-10-01T00:00:00Z'), ['old_reason']],
      [new Date('2026-10-10T00:00:00Z'), ['support_end_soon']],
    ] as const) {
      await pg.insert(diagnosticSubmissions).values({
        organizationId: org,
        leadId,
        diagnosticKey: 'ax-migration',
        diagnosticVersion: 3,
        answers: {},
        result: { reasons: { urgency, difficulty: ['programs_large'] } },
        createdAt,
      });
    }
    const got = await callers.rep.leadPrep.get({ organizationId: org, leadId });
    expect(got.canEdit).toBe(true);
    expect(got.draftSource).toMatchObject({
      // The diagnosis wins over the lead field
      targetSystem: 'as400',
      targetSystemFrom: 'diagnosis',
      primaryChallenge: 'people',
      challenges: ['people', 'cost'],
      urgencyReasons: ['support_end_soon'],
      difficultyReasons: ['programs_large'],
      playbookQuestions: { people: ['手引きの質問1', '手引きの質問2'], cost: ['手引きの質問3'] },
    });

    // A lead without a diagnosis (e.g. from an agency) still drafts from its own field
    const plain = await createLead({ targetSystem: 'acos', agencyName: '架空代行' });
    expect((await callers.rep.leadPrep.get({ organizationId: org, leadId: plain })).draftSource).toMatchObject({
      targetSystem: 'acos',
      targetSystemFrom: 'lead',
      primaryChallenge: null,
      urgencyReasons: [],
    });
  });

  it('lets parent viewers read the card, without editing or the playbook', async () => {
    const leadId = await createLead();
    await callers.rep.leadPrep.save({ organizationId: org, leadId, card });
    const got = await callers.viewer.leadPrep.get({ organizationId: org, leadId });
    expect(got).toMatchObject({ canEdit: false, draftSource: null });
    expect(got.card.firstQuestions).toEqual(card.firstQuestions);
    await expect(
      callers.viewer.leadPrep.save({ organizationId: org, leadId, card })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('does not reach leads of another organization', async () => {
    const foreign = await createLead({}, orgIds[1]);
    await expect(
      callers.rep.leadPrep.get({ organizationId: org, leadId: foreign })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      callers.rep.leadPrep.save({ organizationId: org, leadId: foreign, card })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
