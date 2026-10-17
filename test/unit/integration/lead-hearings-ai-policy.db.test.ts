/**
 * AI source code analysis answer of a hearing (#160) on a real PostgreSQL: the lead's assignee
 * is told when a hearing records "not allowed" or "on conditions" (once per change, not on every
 * autosave, not when they recorded it themselves), and the hearing list carries the answer for
 * the lead page. All names are made up.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/lead-hearings-ai-policy.db.test.ts
 */
import type { Database } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import { leads, notifications, organizationMembers, organizations, users } from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('hearing AI analysis answer (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)! as unknown as Database;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let org: string;
  const member: Record<'rep' | 'owner', { id: string }> = {} as never;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let rep: any;

  const answer = (value: string, conditions?: string) => ({
    aiSourceAnalysis: { value, status: 'done', source: null },
    ...(conditions
      ? { aiSourceAnalysisConditions: { value: conditions, status: 'done', source: null } }
      : {}),
  });

  async function hearingFor(assigneeUserId: string) {
    const [lead] = await pg
      .insert(leads)
      .values({
        organizationId: org,
        email: `ai-${unique()}@example.co.jp`,
        name: '山田 花子',
        company: '架空商事',
        assigneeUserId,
      })
      .returning();
    const hearing = await rep.leadHearings.create({
      organizationId: org,
      leadId: lead.id,
      heldOn: '2026-10-16',
    });
    let updatedAt: Date = hearing.updatedAt;
    const save = async (fields: Record<string, unknown>) => {
      const saved = await rep.leadHearings.update({
        organizationId: org,
        id: hearing.id,
        heldOn: '2026-10-16',
        fields,
        expectedUpdatedAt: updatedAt,
      });
      updatedAt = saved.updatedAt;
    };
    return { leadId: lead.id as string, save };
  }

  const noticesOf = (leadId: string) =>
    pg
      .select({ userId: notifications.userId, title: notifications.title, data: notifications.data })
      .from(notifications)
      .where(
        and(eq(notifications.organizationId, org), eq(notifications.type, 'hearing_ai_restricted'))
      )
      .then((rows) => rows.filter((row) => (row.data as { leadId: string }).leadId === leadId));

  beforeAll(async () => {
    const [row] = await pg
      .insert(organizations)
      .values({ name: 'AI 解析テスト', slug: `ai-policy-${unique()}` })
      .returning();
    org = row.id;
    for (const key of ['rep', 'owner'] as const) {
      const [user] = await pg
        .insert(users)
        .values({ email: `ai-${key}-${unique()}@example.com`, name: key === 'rep' ? '営業 太郎' : '担当 次郎' })
        .returning();
      member[key] = user;
      await pg.insert(organizationMembers).values({ organizationId: org, userId: user.id, role: 'member' });
      if (key === 'rep') {
        rep = appRouter.createCaller({
          db: pg,
          session: { session: { id: 's', userId: user.id }, user },
          user,
          // biome-ignore lint/suspicious/noExplicitAny: test context
        } as any);
      }
    }
  });

  afterAll(async () => {
    await pg.delete(organizations).where(eq(organizations.id, org));
    await pg.delete(users).where(inArray(users.id, [member.rep.id, member.owner.id]));
    await client?.end();
  });

  it('tells the assignee once per change to a restriction', async () => {
    const { leadId, save } = await hearingFor(member.owner.id);
    await save(answer('unknown'));
    expect(await noticesOf(leadId)).toHaveLength(0);

    await save(answer('conditional', '社内の閉域環境のみ'));
    let notices = await noticesOf(leadId);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ userId: member.owner.id });
    expect(notices[0].title).toContain('「条件付き」');

    // Autosave of the same answer
    await save(answer('conditional', '社内の閉域環境のみ（確認中）'));
    expect(await noticesOf(leadId)).toHaveLength(1);

    await save(answer('not_allowed'));
    notices = await noticesOf(leadId);
    expect(notices).toHaveLength(2);

    const list = await rep.leadHearings.listByLead({ organizationId: org, leadId });
    expect(list.items[0].aiSourceAnalysis).toEqual({ value: 'not_allowed', conditions: null });
  });

  it('tells nobody when the assignee recorded it themselves', async () => {
    const { leadId, save } = await hearingFor(member.rep.id);
    await save(answer('not_allowed'));
    expect(await noticesOf(leadId)).toHaveLength(0);
  });
});
