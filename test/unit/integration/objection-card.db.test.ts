/**
 * Objection card (#157) on a real PostgreSQL: the signals from the latest hearing, the lost
 * reason and the diagnosis (the lead's summary and its AX answers, #484, every AX answer of the
 * lead), the playbook rows picked for them, no playbook or one that no longer fits the schema
 * (#727), and who may read it (not viewers from a parent organization).
 * Playbook rows are made up.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/objection-card.db.test.ts
 */
import type { Database } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import {
  type OrganizationRole,
  axSalesPlaybooks,
  diagnosticSubmissions,
  leadHearings,
  leads,
  organizationMembers,
  organizations,
  users,
} from '@/lib/db/schema';
import {
  type AxPlaybookContent,
  emptyAxPlaybookContent,
} from '@/lib/features/ax-playbook/types/schemas';
import { appRouter } from '@/server/routers/_app';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('objection card (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)! as unknown as Database;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const orgIds: string[] = [];
  const userIds: string[] = [];
  // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
  const callers: Record<string, any> = {};

  async function member(organizationId: string, role: OrganizationRole) {
    const [user] = await pg
      .insert(users)
      .values({ email: `objection-${role}-${unique()}@example.com`, name: role })
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

  beforeAll(async () => {
    for (const name of ['切り返しテスト', '手引きなし組織', '壊れた手引き組織']) {
      const [row] = await pg
        .insert(organizations)
        .values({ name, slug: `objection-${unique()}` })
        .returning();
      orgIds.push(row.id);
    }
    callers.member = await member(orgIds[0], 'member');
    callers.viewer = await member(orgIds[0], 'parent_viewer');
    callers.other = await member(orgIds[1], 'member');
    callers.broken = await member(orgIds[2], 'member');
    const content = emptyAxPlaybookContent();
    content.objections = [
      { customer: '高い', response: '小さく始める段階導入', note: '', reasons: ['budget'] },
      { customer: '今はいい', response: '保守期限から逆算', note: '', reasons: ['priority'] },
      { customer: '怖い', response: '並行稼働で確かめる', note: '', reasons: ['risk'] },
    ];
    content.ngPhrases = [
      { ng: '絶対', alternative: '多くの場合', reasons: [] },
      { ng: '安い', alternative: '段階で', reasons: ['budget'] },
      { ng: '簡単', alternative: '手順を', reasons: ['risk'] },
    ];
    content.scheduleFollowUp = '{date}までにご連絡します';
    await pg.insert(axSalesPlaybooks).values({ organizationId: orgIds[0], content });
    // Saved before a change of the schema, or edited by hand: it no longer parses
    await pg.insert(axSalesPlaybooks).values({
      organizationId: orgIds[2],
      content: { ...content, objections: 'not a list' } as unknown as AxPlaybookContent,
    });
  });

  afterAll(async () => {
    for (const id of orgIds) await pg.delete(organizations).where(eq(organizations.id, id));
    await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  it('picks the playbook rows for the hearing, the lost reason and the diagnosis', async () => {
    const [lead] = await pg
      .insert(leads)
      .values({
        organizationId: orgIds[0],
        email: `objection-${unique()}@example.co.jp`,
        status: 'lost',
        lostReason: 'timing',
        responses: { axMigration: { challenges: ['cost'] } },
      })
      .returning();
    await pg.insert(leadHearings).values({
      organizationId: orgIds[0],
      leadId: lead.id,
      heldOn: '2026-10-16',
      catalogVersion: 1,
      fields: { pastBlockers: { value: ['risk'], status: 'done', source: null } },
    });

    const card = await callers.member.objectionCard.get({ organizationId: orgIds[0], leadId: lead.id });
    expect(card.signals).toEqual([
      { reason: 'budget', sources: ['diagnosis'] },
      { reason: 'risk', sources: ['hearing'] },
      { reason: 'priority', sources: ['lostReason'] },
    ]);
    // Hearing first, then the lost reason, then the diagnosis
    expect(card.objections.map((row: { customer: string }) => row.customer)).toEqual([
      '怖い',
      '今はいい',
      '高い',
    ]);
    expect(card.ngPhrases.map((row: { ng: string }) => row.ng)).toEqual(['絶対', '安い', '簡単']);
    expect(card).toMatchObject({
      hasPlaybook: true,
      scheduleTemplate: '{date}までにご連絡します',
      canAddTakeaway: true,
    });
  });

  it('reads the risk from the AX answers, which the summary keeps as people (#484)', async () => {
    const [lead] = await pg
      .insert(leads)
      .values({
        organizationId: orgIds[0],
        email: `objection-${unique()}@example.co.jp`,
        // What the AX diagnosis saves when only "nobody knows how it works" was chosen
        responses: { axMigration: { challenges: ['people'] } },
      })
      .returning();
    const submission = {
      leadId: lead.id,
      diagnosticVersion: 1,
      answers: { platform: 'as400', challenges: ['blackbox'] },
      result: {},
    };
    await pg.insert(diagnosticSubmissions).values([
      { ...submission, organizationId: orgIds[0], diagnosticKey: 'ax-migration', leadCreated: true },
      // Not read: another diagnosis, and another organization's row
      {
        ...submission,
        organizationId: orgIds[0],
        diagnosticKey: 'builder-diagnosis',
        answers: { challenges: ['cost'] },
      },
      {
        ...submission,
        organizationId: orgIds[1],
        diagnosticKey: 'ax-migration',
        answers: { challenges: ['cost'] },
      },
    ]);

    const card = await callers.member.objectionCard.get({ organizationId: orgIds[0], leadId: lead.id });
    expect(card.signals).toEqual([
      { reason: 'staffing', sources: ['diagnosis'] },
      { reason: 'risk', sources: ['diagnosis'] },
    ]);
    expect(card.objections.map((row: { customer: string }) => row.customer)).toEqual(['怖い']);
  });

  it('reads every AX answer of the lead, not only the latest (#727)', async () => {
    const [lead] = await pg
      .insert(leads)
      .values({ organizationId: orgIds[0], email: `objection-${unique()}@example.co.jp` })
      .returning();
    // Two systems diagnosed: the older answer has the cost, the newer one nobody knows how it works
    await pg.insert(diagnosticSubmissions).values(
      [
        { challenges: ['cost'], createdAt: new Date('2026-10-01T01:00:00Z') },
        { challenges: ['blackbox'], createdAt: new Date('2026-10-10T01:00:00Z') },
      ].map(({ challenges, createdAt }) => ({
        organizationId: orgIds[0],
        leadId: lead.id,
        diagnosticKey: 'ax-migration',
        diagnosticVersion: 1,
        answers: { platform: 'as400', challenges },
        result: {},
        createdAt,
      }))
    );

    const card = await callers.member.objectionCard.get({ organizationId: orgIds[0], leadId: lead.id });
    expect(card.signals).toEqual([
      { reason: 'budget', sources: ['diagnosis'] },
      { reason: 'risk', sources: ['diagnosis'] },
    ]);
    expect(card.objections.map((row: { customer: string }) => row.customer)).toEqual([
      '高い',
      '怖い',
    ]);
  });

  it('reads a playbook that no longer fits the schema as none (#727)', async () => {
    const [lead] = await pg
      .insert(leads)
      .values({
        organizationId: orgIds[2],
        email: `objection-${unique()}@example.co.jp`,
        status: 'lost',
        lostReason: 'budget',
      })
      .returning();
    expect(
      await callers.broken.objectionCard.get({ organizationId: orgIds[2], leadId: lead.id })
    ).toMatchObject({
      hasPlaybook: false,
      objections: [],
      ngPhrases: [],
      scheduleTemplate: '',
      // The signals do not depend on the playbook
      signals: [{ reason: 'budget', sources: ['lostReason'] }],
    });
  });

  it('says there is no playbook, and keeps it from viewers of a parent organization', async () => {
    const [lead] = await pg
      .insert(leads)
      .values({ organizationId: orgIds[1], email: `objection-${unique()}@example.co.jp` })
      .returning();
    expect(
      await callers.other.objectionCard.get({ organizationId: orgIds[1], leadId: lead.id })
    ).toMatchObject({ hasPlaybook: false, objections: [], ngPhrases: [], signals: [] });

    const [own] = await pg
      .insert(leads)
      .values({ organizationId: orgIds[0], email: `objection-${unique()}@example.co.jp` })
      .returning();
    await expect(
      callers.viewer.objectionCard.get({ organizationId: orgIds[0], leadId: own.id })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // A lead of another organization is not found
    await expect(
      callers.member.objectionCard.get({ organizationId: orgIds[0], leadId: lead.id })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
