/**
 * What to ask next (#75) on a real PostgreSQL: the playbook guide for the lead's main challenge,
 * the notification's effect line, who may read it (not viewers from a parent organization) and
 * other organizations. Playbook text is made up.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/challenge-guide.db.test.ts
 */
import type { Database } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import { axSalesPlaybooks, leads, organizationMembers, organizations, users } from '@/lib/db/schema';
import { emptyAxPlaybookContent } from '@/lib/features/ax-playbook/types/schemas';
import { challengeEffectLine } from '@/lib/features/challenge-guide/service';
import { appRouter } from '@/server/routers/_app';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('challenge guide (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)! as unknown as Database;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const orgIds: string[] = [];
  const userIds: string[] = [];
  // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
  const callers: Record<string, any> = {};

  async function member(organizationId: string, role: string) {
    const [user] = await pg
      .insert(users)
      .values({ email: `guide-${role}-${unique()}@example.com`, name: role })
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

  const axLead = async (organizationId: string, primaryChallenge: string | null) => {
    const [lead] = await pg
      .insert(leads)
      .values({
        organizationId,
        email: `guide-${unique()}@example.co.jp`,
        responses: { axMigration: { targetSystem: 'as400', primaryChallenge, challenges: [] } },
      })
      .returning();
    return lead.id as string;
  };

  beforeAll(async () => {
    for (const name of ['聞くことテスト', '手引きなし組織']) {
      const [row] = await pg
        .insert(organizations)
        .values({ name, slug: `guide-${unique()}` })
        .returning();
      orgIds.push(row.id);
    }
    callers.member = await member(orgIds[0], 'member');
    callers.viewer = await member(orgIds[0], 'parent_viewer');
    callers.other = await member(orgIds[1], 'member');
    const content = emptyAxPlaybookContent();
    content.challenges.cost = {
      effect: '保守費を毎年下げられる\n詳しくは資料で',
      questions: ['今の保守費は年いくら？'],
      signals: ['来期の予算を組む'],
    };
    await pg.insert(axSalesPlaybooks).values({ organizationId: orgIds[0], content });
  });

  afterAll(async () => {
    for (const id of orgIds) await pg.delete(organizations).where(eq(organizations.id, id));
    await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  it('reads the guide for the main challenge, or says what is missing', async () => {
    const cost = await axLead(orgIds[0], 'cost');
    expect(await callers.member.challengeGuide.get({ organizationId: orgIds[0], leadId: cost })).toMatchObject({
      hasDiagnosis: true,
      primary: 'cost',
      hasPlaybook: true,
      guide: { questions: ['今の保守費は年いくら？'], signals: ['来期の予算を組む'] },
    });
    const people = await axLead(orgIds[0], 'people');
    expect(await callers.member.challengeGuide.get({ organizationId: orgIds[0], leadId: people })).toMatchObject({
      primary: 'people',
      hasPlaybook: true,
      guide: null,
    });
    const [plain] = await pg
      .insert(leads)
      .values({ organizationId: orgIds[0], email: `guide-${unique()}@example.co.jp` })
      .returning();
    expect(await callers.member.challengeGuide.get({ organizationId: orgIds[0], leadId: plain.id })).toMatchObject({
      hasDiagnosis: false,
      primary: null,
    });
    const noPlaybook = await axLead(orgIds[1], 'cost');
    expect(await callers.other.challengeGuide.get({ organizationId: orgIds[1], leadId: noPlaybook })).toMatchObject({
      hasPlaybook: false,
      guide: null,
    });
  });

  it('gives the notification one line of the effect only', async () => {
    expect(await challengeEffectLine(orgIds[0], 'cost', pg)).toBe('保守費を毎年下げられる');
    expect(await challengeEffectLine(orgIds[0], 'people', pg)).toBeNull();
    expect(await challengeEffectLine(orgIds[0], null, pg)).toBeNull();
  });

  it('keeps it from parent viewers and other organizations', async () => {
    const lead = await axLead(orgIds[0], 'cost');
    await expect(
      callers.viewer.challengeGuide.get({ organizationId: orgIds[0], leadId: lead })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const foreign = await axLead(orgIds[1], 'cost');
    await expect(
      callers.member.challengeGuide.get({ organizationId: orgIds[0], leadId: foreign })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
