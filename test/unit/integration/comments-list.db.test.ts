/**
 * The pages and the counts of a lead's comments on a real PostgreSQL (#722): every type of the
 * lead is counted whatever type or page is listed (replies not: they come inside their
 * comment), the cursor reads past the 50th comment and ends on the last page, each comment
 * once, pinned first and then the newest, and only the lead and the organization asked for are
 * counted and listed.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/diagnoleads_test \
 *     bunx vitest --run test/unit/integration/comments-list.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import { leadComments, leads, organizationMembers, organizations, users } from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;
type CallerContext = Parameters<typeof appRouter.createCaller>[0];
type Caller = ReturnType<typeof appRouter.createCaller>;

describe.skipIf(!url)('lead comments: pages and counts (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  const pg = client
    ? drizzle(client, { schema })
    : (null as unknown as ReturnType<typeof drizzle<typeof schema>>);
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organizationIds: string[] = [];
  const userIds: string[] = [];

  let organizationId: string;
  let authorId: string;
  let leadId: string;
  let otherLeadId: string;
  let pinnedId: string;
  let member: Caller;

  const at = (minutes: number) => new Date(Date.parse('2026-10-01T00:00:00Z') + minutes * 60_000);

  const insertLead = async () => {
    const [lead] = await pg
      .insert(leads)
      .values({ organizationId, email: `lead-${unique()}@example.com`, status: 'new' })
      .returning();
    return lead.id;
  };

  beforeAll(async () => {
    const [org, other] = await pg
      .insert(organizations)
      .values([
        { name: '架空商事（メモの一覧）', slug: `comments-list-${unique()}` },
        { name: '架空物産（メモの一覧）', slug: `comments-list-other-${unique()}` },
      ])
      .returning();
    organizationId = org.id;
    organizationIds.push(org.id, other.id);

    const [user] = await pg
      .insert(users)
      .values({ email: `comments-list-${unique()}@example.com`, name: '営業' })
      .returning();
    userIds.push(user.id);
    authorId = user.id;
    await pg
      .insert(organizationMembers)
      .values({ organizationId, userId: user.id, role: 'member' });
    member = appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId: user.id }, user },
      user,
    } as unknown as CallerContext);

    leadId = await insertLead();
    otherLeadId = await insertLead();

    // 51 comments a minute apart, two notes (the oldest one pinned) and one activity entry
    const rows = [
      ...Array.from({ length: 51 }, (_, i) => ({
        type: 'comment' as const,
        content: `コメント${i + 1}`,
        createdAt: at(i),
        isPinned: false,
      })),
      { type: 'note' as const, content: 'メモ', createdAt: at(100), isPinned: false },
      { type: 'note' as const, content: 'ピン留めのメモ', createdAt: at(-10), isPinned: true },
      { type: 'activity' as const, content: '資料を送付', createdAt: at(200), isPinned: false },
    ];
    const inserted = await pg
      .insert(leadComments)
      .values(
        rows.map((row) => ({
          ...row,
          organizationId,
          leadId,
          userId: user.id,
          updatedAt: row.createdAt,
        }))
      )
      .returning();
    const pinned = inserted.find((row) => row.isPinned);
    const first = inserted.find((row) => row.content === 'コメント1');
    if (!pinned || !first) throw new Error('the comments were not written');
    pinnedId = pinned.id;

    // Counted with nothing: a reply (inside its comment), a comment of another lead, and a row
    // of another organization on this lead, however it was written
    await pg.insert(leadComments).values([
      {
        organizationId,
        leadId,
        userId: user.id,
        content: '返信',
        type: 'comment',
        parentId: first.id,
      },
      { organizationId, leadId: otherLeadId, userId: user.id, content: '別のリード', type: 'note' },
      { organizationId: other.id, leadId, userId: null, content: '別の組織の行', type: 'note' },
    ]);
  });

  afterAll(async () => {
    if (organizationIds.length > 0) {
      await pg.delete(organizations).where(inArray(organizations.id, organizationIds));
    }
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  const scope = () => ({ organizationId, leadId });

  it('counts every type of the lead whatever type is listed, replies not', async () => {
    const counts = { all: 54, comment: 51, note: 2, activity: 1 };
    for (const type of ['all', 'comment', 'note', 'activity'] as const) {
      const page = await member.comments.list({ ...scope(), type });
      expect(page.counts).toEqual(counts);
      expect(page.total).toBe(counts[type]);
    }
    expect((await member.comments.list({ organizationId, leadId: otherLeadId })).counts).toEqual({
      all: 1,
      comment: 0,
      note: 1,
      activity: 0,
    });
  });

  it('reads past the 50th comment with the cursor, each once, pinned first and then the newest', async () => {
    const first = await member.comments.list(scope());
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).toBe(50);
    const second = await member.comments.list({ ...scope(), cursor: first.nextCursor });
    expect(second.items).toHaveLength(4);
    expect(second.nextCursor).toBeNull();

    const items = [...first.items, ...second.items];
    expect(new Set(items.map((item) => item.id)).size).toBe(54);
    expect(items[0].id).toBe(pinnedId);
    const times = items.slice(1).map((item) => item.createdAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
    // The reply comes inside its comment, not as one of the list
    expect(items.some((item) => item.content === '返信')).toBe(false);
    const thread = items.find((item) => item.content === 'コメント1');
    expect(thread?.replies.map((reply) => reply.content)).toEqual(['返信']);
    expect(JSON.stringify(items)).not.toContain('別の組織の行');
  });

  it('pages one type to its end', async () => {
    const first = await member.comments.list({ ...scope(), type: 'comment' });
    expect(first.items).toHaveLength(50);
    expect(first.items.every((item) => item.type === 'comment')).toBe(true);
    const second = await member.comments.list({
      ...scope(),
      type: 'comment',
      cursor: first.nextCursor,
    });
    expect(second.items.map((item) => item.content)).toEqual(['コメント1']);
    expect(second.nextCursor).toBeNull();

    const notes = await member.comments.list({ ...scope(), type: 'note' });
    expect(notes.items.map((item) => item.content)).toEqual(['ピン留めのメモ', 'メモ']);
    expect(notes.nextCursor).toBeNull();
  });

  it('keeps one order for comments written at the same moment, page after page', async () => {
    const lead = await insertLead();
    const moment = at(300);
    await pg.insert(leadComments).values(
      Array.from({ length: 5 }, (_, i) => ({
        organizationId,
        leadId: lead,
        userId: authorId,
        content: `同時${i + 1}`,
        type: 'comment' as const,
        createdAt: moment,
        updatedAt: moment,
      }))
    );

    const seen: string[] = [];
    let cursor: number | null = 0;
    while (cursor !== null) {
      const page: Awaited<ReturnType<Caller['comments']['list']>> = await member.comments.list({
        organizationId,
        leadId: lead,
        limit: 1,
        cursor,
      });
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect(seen).toEqual([...seen].sort().reverse());
  });
});
