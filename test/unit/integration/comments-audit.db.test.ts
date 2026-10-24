/**
 * Comments of a lead on a real PostgreSQL (#555): every write leaves one audit row without the
 * text, the counts come from SQL, deleting a comment takes its replies, pinning is no edit, and
 * the list says what the viewer may do (the same checks as the writes).
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/diagnoleads_test \
 *     bunx vitest --run test/unit/integration/comments-audit.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import {
  auditLogs,
  leadComments,
  leads,
  organizationMembers,
  organizations,
  users,
} from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('lead comments: audit and counts (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const userIds: string[] = [];

  let organizationId: string;
  let leadId: string;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
  const as: Record<'owner' | 'member' | 'other' | 'viewer', any> = {} as never;
  const ids: Record<string, string> = {};

  async function callerFor(role: string, name: string) {
    const [user] = await pg
      .insert(users)
      .values({ email: `comments-audit-${unique()}@example.com`, name })
      .returning();
    userIds.push(user.id);
    await pg.insert(organizationMembers).values({ organizationId, userId: user.id, role });
    ids[name] = user.id;
    return appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId: user.id }, user },
      user,
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);
  }

  const auditOf = (commentId: string) =>
    pg
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.organizationId, organizationId),
          eq(auditLogs.resource, 'lead_comment'),
          eq(auditLogs.resourceId, commentId)
        )
      )
      .orderBy(auditLogs.createdAt);

  const row = async (id: string) =>
    (await pg.select().from(leadComments).where(eq(leadComments.id, id)))[0];

  beforeAll(async () => {
    const [org] = await pg
      .insert(organizations)
      .values({ name: '架空商事（メモ）', slug: `comments-audit-${unique()}` })
      .returning();
    organizationId = org.id;
    as.owner = await callerFor('owner', 'オーナー');
    as.member = await callerFor('member', '営業');
    as.other = await callerFor('member', '別の営業');
    as.viewer = await callerFor('parent_viewer', '親会社');
    const [lead] = await pg
      .insert(leads)
      .values({ organizationId, email: `lead-${unique()}@example.com`, status: 'new' })
      .returning();
    leadId = lead.id;
  });

  afterAll(async () => {
    if (organizationId) await pg.delete(organizations).where(eq(organizations.id, organizationId));
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  const scope = () => ({ organizationId, leadId });

  it('records a new comment without its text', async () => {
    const created = await as.member.comments.create({
      ...scope(),
      content: '架空 太郎さんは来月に決裁予定',
      type: 'note',
    });

    const audit = await auditOf(created.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'create',
      userId: ids['営業'],
      changes: { after: { type: 'note', parentId: null } },
      metadata: { leadId },
    });
    expect(JSON.stringify(audit[0])).not.toContain('架空 太郎');
  });

  it('records that the text changed, not the text; the same text writes nothing', async () => {
    const created = await as.member.comments.create({ ...scope(), content: '初回の連絡は電話で' });
    const before = await row(created.id);

    // The same text again: no write, the comment does not read as edited
    await as.member.comments.update({ organizationId, id: created.id, content: '初回の連絡は電話で' });
    expect((await row(created.id)).updatedAt).toEqual(before.updatedAt);
    expect(await auditOf(created.id)).toHaveLength(1);

    await as.member.comments.update({ organizationId, id: created.id, content: '初回の連絡はメールで' });
    const audit = await auditOf(created.id);
    expect(audit).toHaveLength(2);
    expect(audit[1]).toMatchObject({
      action: 'update',
      metadata: { leadId, changedText: ['content'] },
    });
    expect(JSON.stringify(audit[1])).not.toContain('メール');
  });

  it('pins without marking the comment edited, and records the pin', async () => {
    const created = await as.member.comments.create({ ...scope(), content: '予算は来期' });
    const before = await row(created.id);

    const pinned = await as.member.comments.togglePin({ organizationId, id: created.id });
    expect(pinned.isPinned).toBe(true);
    expect((await row(created.id)).updatedAt).toEqual(before.updatedAt);
    expect((await auditOf(created.id)).at(-1)).toMatchObject({
      action: 'update',
      changes: { before: { isPinned: false }, after: { isPinned: true } },
    });
  });

  it('deletes the replies with their comment and records how many', async () => {
    const parent = await as.member.comments.create({ ...scope(), content: '提案の進め方' });
    await as.other.comments.create({ ...scope(), content: '来週に相談', parentId: parent.id });
    await as.owner.comments.create({ ...scope(), content: '了解', parentId: parent.id });

    await as.member.comments.delete({ organizationId, id: parent.id });

    const left = await pg
      .select({ id: leadComments.id })
      .from(leadComments)
      .where(inArray(leadComments.parentId, [parent.id]));
    expect(left).toEqual([]);
    expect(await row(parent.id)).toBeUndefined();
    expect((await auditOf(parent.id)).at(-1)).toMatchObject({
      action: 'delete',
      userId: ids['営業'],
      changes: { before: { type: 'comment', isPinned: false, authorId: ids['営業'] } },
      metadata: { leadId, replies: 2 },
    });
  });

  it("lets only the author or an owner edit and delete someone's comment", async () => {
    const created = await as.member.comments.create({ ...scope(), content: '見積の前提' });

    await expect(
      as.other.comments.update({ organizationId, id: created.id, content: '書き換え' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(as.other.comments.delete({ organizationId, id: created.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    // Nothing was written, nothing was recorded
    expect((await row(created.id)).content).toBe('見積の前提');
    expect(await auditOf(created.id)).toHaveLength(1);

    await as.owner.comments.update({ organizationId, id: created.id, content: '見積の前提（確認済み）' });
    expect((await row(created.id)).content).toBe('見積の前提（確認済み）');
  });

  it('counts with SQL and says what each viewer may do', async () => {
    const parent = await as.member.comments.create({ ...scope(), content: '次回の議題' });
    await as.other.comments.create({ ...scope(), content: '承知', parentId: parent.id });
    const stored = await pg
      .select({ parentId: leadComments.parentId })
      .from(leadComments)
      .where(eq(leadComments.leadId, leadId));

    // getCount: every comment of the lead, replies included
    expect(await as.member.comments.getCount(scope())).toEqual({ count: stored.length });
    // list: the top-level comments (replies come inside them)
    const page = await as.member.comments.list({ ...scope(), type: 'all' });
    expect(page.total).toBe(stored.filter((comment) => comment.parentId === null).length);
    expect(page.total).toBe(page.items.length);
    expect(page.viewer).toEqual({ userId: ids['営業'], canWrite: true, canModerate: false });

    expect((await as.owner.comments.list(scope())).viewer).toMatchObject({
      canWrite: true,
      canModerate: true,
    });
    // Read-only: the screen shows no form, and a write is refused
    expect((await as.viewer.comments.list(scope())).viewer).toMatchObject({
      canWrite: false,
      canModerate: false,
    });
    await expect(as.viewer.comments.create({ ...scope(), content: '書けない' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
