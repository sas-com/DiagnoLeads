/**
 * Comments of a lead on a real PostgreSQL (#555): every write leaves one audit row without the
 * text, the counts come from SQL, deleting a comment takes its replies (others' replies only
 * for an owner), even one written at the same time, pinning is no edit, the list says what the
 * viewer may do, and the parent organization reads no comment, in the comments or in the lead's
 * activity.
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
import { and, eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('lead comments: audit, counts and readers (PostgreSQL)', () => {
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

  it('takes comments and notes only, with a small metadata, and replies one level deep', async () => {
    await expect(
      as.member.comments.create({ ...scope(), content: '活動', type: 'activity' })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      as.member.comments.create({ ...scope(), content: '大きい', metadata: { note: 'x'.repeat(3000) } })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    const parent = await as.member.comments.create({ ...scope(), content: '進め方' });
    const reply = await as.other.comments.create({ ...scope(), content: '賛成', parentId: parent.id });
    // A reply to a reply would never be listed, nor deleted with its thread
    await expect(
      as.member.comments.create({ ...scope(), content: '返信の返信', parentId: reply.id })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
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

  it('pins without marking the comment edited, and records each pin', async () => {
    const created = await as.member.comments.create({ ...scope(), content: '予算は来期' });
    const before = await row(created.id);

    const pinned = await as.member.comments.togglePin({ organizationId, id: created.id });
    expect(pinned.isPinned).toBe(true);
    expect((await row(created.id)).updatedAt).toEqual(before.updatedAt);
    expect((await auditOf(created.id)).at(-1)).toMatchObject({
      action: 'update',
      changes: { before: { isPinned: false }, after: { isPinned: true } },
    });

    await as.member.comments.togglePin({ organizationId, id: created.id });
    expect((await auditOf(created.id)).at(-1)).toMatchObject({
      changes: { before: { isPinned: true }, after: { isPinned: false } },
    });
  });

  it('deletes the replies with their comment, one audit row each', async () => {
    const parent = await as.member.comments.create({ ...scope(), content: '提案の進め方' });
    const reply = await as.member.comments.create({ ...scope(), content: '補足', parentId: parent.id });

    await as.member.comments.delete({ organizationId, id: parent.id });

    expect(await row(parent.id)).toBeUndefined();
    expect(await row(reply.id)).toBeUndefined();
    expect((await auditOf(reply.id)).at(-1)).toMatchObject({
      action: 'delete',
      changes: { before: { type: 'comment', isPinned: false, authorId: ids['営業'] } },
      metadata: { leadId, parentId: parent.id },
    });
    expect((await auditOf(parent.id)).at(-1)).toMatchObject({
      action: 'delete',
      userId: ids['営業'],
      changes: { before: { type: 'comment', isPinned: false, authorId: ids['営業'] } },
      metadata: { leadId, replies: 1 },
    });
  });

  it("leaves others' replies to an owner: the author alone cannot delete the thread", async () => {
    const parent = await as.member.comments.create({ ...scope(), content: '次の打ち合わせ' });
    const reply = await as.other.comments.create({ ...scope(), content: '日程を調整', parentId: parent.id });

    await expect(as.member.comments.delete({ organizationId, id: parent.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    // Nothing was deleted, nothing was recorded
    expect(await row(parent.id)).toBeDefined();
    expect(await row(reply.id)).toBeDefined();
    expect(await auditOf(parent.id)).toHaveLength(1);

    await as.owner.comments.delete({ organizationId, id: parent.id });
    expect(await row(reply.id)).toBeUndefined();
    expect((await auditOf(reply.id)).at(-1)).toMatchObject({
      action: 'delete',
      userId: ids['オーナー'],
      changes: { before: { authorId: ids['別の営業'] } },
      metadata: { parentId: parent.id },
    });
  });

  it("lets only the author or an owner edit, pin and delete someone's comment", async () => {
    const created = await as.member.comments.create({ ...scope(), content: '見積の前提' });

    await expect(
      as.other.comments.update({ organizationId, id: created.id, content: '書き換え' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(as.other.comments.delete({ organizationId, id: created.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    // Pinning too, as the screen offers it
    await expect(
      as.other.comments.togglePin({ organizationId, id: created.id })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await row(created.id)).content).toBe('見積の前提');
    expect((await row(created.id)).isPinned).toBe(false);
    expect(await auditOf(created.id)).toHaveLength(1);

    await as.owner.comments.update({ organizationId, id: created.id, content: '見積の前提（確認済み）' });
    expect((await row(created.id)).content).toBe('見積の前提（確認済み）');
    expect((await as.owner.comments.togglePin({ organizationId, id: created.id })).isPinned).toBe(
      true
    );
  });

  it('counts with SQL and says what each member may do', async () => {
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
  });

  /**
   * Until a session waits for a lock the given backend holds (or 3 seconds pass, when nothing
   * waits): only waits on this test's own connection count, not those of other test files
   */
  async function untilBlockedBy(pid: number) {
    for (let i = 0; i < 60; i++) {
      const [row] = await pg.execute<{ waiting: number }>(
        sql`select count(*)::int as waiting from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))`
      );
      if (row && row.waiting > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  const backendPid = async (tx: postgres.TransactionSql) => {
    const [row] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid`;
    return row.pid;
  };

  const outcome = (promise: Promise<unknown>) =>
    promise.then(
      () => 'done',
      (error: { code?: string }) => error.code
    );

  it('leaves no reply to a comment deleted while the reply is written', async () => {
    const parent = await as.member.comments.create({ ...scope(), content: '同時に消すメモ' });
    // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
    const other = postgres(url!, { max: 1 });
    let reply: Promise<unknown> = Promise.resolve();
    try {
      await other.begin(async (tx) => {
        // A delete of the thread holds the comment
        await tx`select id from lead_comments where id = ${parent.id} for update`;
        reply = outcome(
          as.other.comments.create({ ...scope(), content: '間に合わない返信', parentId: parent.id })
        );
        await untilBlockedBy(await backendPid(tx));
        await tx`delete from lead_comments where id = ${parent.id}`;
      });
    } finally {
      await other.end();
    }

    expect(await reply).toBe('NOT_FOUND');
    const orphans = await pg
      .select({ id: leadComments.id })
      .from(leadComments)
      .where(eq(leadComments.parentId, parent.id));
    expect(orphans).toHaveLength(0);
  });

  it('counts a reply written while its comment is deleted', async () => {
    const parent = await as.member.comments.create({ ...scope(), content: '同時に返信が付くメモ' });
    // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
    const other = postgres(url!, { max: 1 });
    let removal: Promise<unknown> = Promise.resolve();
    try {
      await other.begin(async (tx) => {
        // Someone else's reply is being written: it holds its comment
        await tx`select id from lead_comments where id = ${parent.id} for key share`;
        await tx`insert into lead_comments (lead_id, organization_id, user_id, content, type, parent_id)
          values (${leadId}, ${organizationId}, ${ids['別の営業']}, '同時の返信', 'comment', ${parent.id})`;
        removal = outcome(as.member.comments.delete({ organizationId, id: parent.id }));
        await untilBlockedBy(await backendPid(tx));
      });
    } finally {
      await other.end();
    }

    // The delete saw the reply: someone else's, so the author alone cannot delete the thread
    expect(await removal).toBe('FORBIDDEN');
    expect(await row(parent.id)).toBeDefined();
    expect(await auditOf(parent.id)).toHaveLength(1);
  });

  it('finds no lead deleted while a comment is written, rather than a database error', async () => {
    const [doomed] = await pg
      .insert(leads)
      .values({ organizationId, email: `lead-${unique()}@example.com`, status: 'new' })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
    const other = postgres(url!, { max: 1 });
    let written: Promise<unknown> = Promise.resolve();
    try {
      await other.begin(async (tx) => {
        // Deleting the lead holds it, and then its comments
        await tx`delete from leads where id = ${doomed.id}`;
        written = outcome(
          as.member.comments.create({ organizationId, leadId: doomed.id, content: '消えるリード' })
        );
        await untilBlockedBy(await backendPid(tx));
      });
    } finally {
      await other.end();
    }

    expect(await written).toBe('NOT_FOUND');
  });

  it('shows the parent organization no comment, in the comments or in the activity', async () => {
    await as.member.comments.create({ ...scope(), content: '親会社に見せないメモ' });

    await expect(as.viewer.comments.list(scope())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(as.viewer.comments.getCount(scope())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(as.viewer.comments.create({ ...scope(), content: '書けない' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect((await as.viewer.leads.access({ organizationId })).canReadComments).toBe(false);

    // The activity still shows the rest of the lead, without the comments
    const theirs = await as.viewer.leadActivity.list({ organizationId, leadId, limit: 50 });
    expect(theirs.items.some((item: { kind: string }) => item.kind === 'comment')).toBe(false);
    expect(JSON.stringify(theirs)).not.toContain('親会社に見せないメモ');
    const ours = await as.member.leadActivity.list({ organizationId, leadId, limit: 50 });
    expect(ours.items.some((item: { kind: string }) => item.kind === 'comment')).toBe(true);
    expect((await as.member.leads.access({ organizationId })).canReadComments).toBe(true);
  });
});
