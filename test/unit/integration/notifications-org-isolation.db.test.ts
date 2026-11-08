/**
 * Isolation of in-app notifications (#356) on a real PostgreSQL. Notifications belong to one
 * user in one organization: a user of organization B passes the ids of the notifications of a
 * user of organization A, and A's organization id. Nothing of A's user is read, marked as read
 * or deleted, and A's notification settings are refused. A member removed from an organization
 * no longer reads, counts or marks its notifications, and its first meeting preferences notice
 * goes to its intake members instead (#974). All values are fictional.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/notifications-org-isolation.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import {
  leads,
  notificationPreferences,
  notifications,
  organizationMembers,
  organizations,
  users,
} from '@/lib/db/schema';
import { INTAKE_SETTINGS_KEY } from '@/lib/features/leads/assignment';
import { notifyPreferencesReceived } from '@/lib/features/meeting-requests/service';
import { appRouter } from '@/server/routers/_app';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

// The notification service uses the app's database client; point it at the test database
const { connection } = vi.hoisted(() => ({ connection: { url: process.env.TEST_DATABASE_URL } }));
vi.mock('@/lib/db/client', async () => {
  const pg = await import('postgres');
  const { drizzle: connect } = await import('drizzle-orm/postgres-js');
  const dbSchema = await import('@/lib/db/schema');
  const client = pg.default(connection.url ?? 'postgres://unused@127.0.0.1:1/unused', { max: 2 });
  return { db: connect(client, { schema: dbSchema }) };
});

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('notifications: isolation (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let orgA: string;
  let orgB: string;
  let userA: string;
  const userIds: string[] = [];
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let asB: any;
  /** Two unread notifications of A's user */
  const notificationsA: string[] = [];

  const rowsOfA = () =>
    pg
      .select({ id: notifications.id, read: notifications.read })
      .from(notifications)
      .where(eq(notifications.userId, userA));

  beforeAll(async () => {
    const created = await pg
      .insert(organizations)
      .values([
        { name: '通知切り分けA', slug: `notify-iso-a-${unique()}` },
        { name: '通知切り分けB', slug: `notify-iso-b-${unique()}` },
      ])
      .returning({ id: organizations.id });
    orgA = created[0].id;
    orgB = created[1].id;
    const [a, b] = await pg
      .insert(users)
      .values([
        { email: `notify-iso-a-${unique()}@example.com`, name: 'A の社員' },
        { email: `notify-iso-b-${unique()}@example.com`, name: 'B の社員' },
      ])
      .returning();
    userA = a.id;
    userIds.push(a.id, b.id);
    await pg.insert(organizationMembers).values([
      { organizationId: orgA, userId: a.id, role: 'admin' },
      { organizationId: orgB, userId: b.id, role: 'admin' },
    ]);
    asB = appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId: b.id }, user: b },
      user: b,
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);

    const rows = await pg
      .insert(notifications)
      .values(
        ['相談の申込がありました', 'リードの点数が変わりました'].map((title) => ({
          userId: a.id,
          organizationId: orgA,
          type: 'consultation_requested' as const,
          title,
          message: '架空商事',
          data: {},
        }))
      )
      .returning({ id: notifications.id });
    notificationsA.push(...rows.map((row) => row.id));
    await pg
      .insert(notificationPreferences)
      .values({ userId: a.id, organizationId: orgA, emailDailyDigest: true });
  });

  afterAll(async () => {
    if (orgA) await pg.delete(organizations).where(inArray(organizations.id, [orgA, orgB]));
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  it("reads none of A's notifications, even with A's organization id (list, unreadCount)", async () => {
    expect(await asB.notifications.list({ organizationId: orgA })).toEqual([]);
    expect(await asB.notifications.list({})).toEqual([]);
    expect(await asB.notifications.unreadCount({ organizationId: orgA })).toEqual({ count: 0 });
    expect(await asB.notifications.unreadCount({})).toEqual({ count: 0 });
  });

  it("marks none of A's notifications as read (markAsRead, markAllAsRead)", async () => {
    for (const notificationId of notificationsA) {
      await asB.notifications.markAsRead({ notificationId });
    }
    await asB.notifications.markAllAsRead({ organizationId: orgA });
    await asB.notifications.markAllAsRead({});
    expect((await rowsOfA()).map((row) => row.read)).toEqual([false, false]);
  });

  it("deletes none of A's notifications by their ids (delete)", async () => {
    for (const notificationId of notificationsA) {
      await asB.notifications.delete({ notificationId });
    }
    expect((await rowsOfA()).map((row) => row.id).sort()).toEqual([...notificationsA].sort());
  });

  // A member removed from an organization keeps their account, and their notifications of it name
  // its leads (#974)
  describe('a member removed from an organization', () => {
    let orgLeft: string;
    let orgKept: string;
    let leaving: string;
    let intake: string;
    // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
    let asLeaving: any;
    // What they read while still a member
    let readBefore: string[];
    const titles = (rows: { title: string }[]) => rows.map((row) => row.title).sort();
    const caller = (user: typeof users.$inferSelect) =>
      appRouter.createCaller({
        db: pg,
        session: { session: { id: 's', userId: user.id }, user },
        user,
        // biome-ignore lint/suspicious/noExplicitAny: test context
      } as any);

    beforeAll(async () => {
      const created = await pg
        .insert(organizations)
        .values([
          { name: '通知の退出元', slug: `notify-left-${unique()}` },
          { name: '通知の残る先', slug: `notify-kept-${unique()}` },
        ])
        .returning({ id: organizations.id });
      [orgLeft, orgKept] = created.map((org) => org.id);
      const [leavingUser, intakeUser] = await pg
        .insert(users)
        .values([
          { email: `notify-left-${unique()}@example.com`, name: '退出 一郎' },
          { email: `notify-intake-${unique()}@example.com`, name: '窓口 花子' },
        ])
        .returning();
      leaving = leavingUser.id;
      intake = intakeUser.id;
      userIds.push(leaving, intake);
      await pg.insert(organizationMembers).values([
        { organizationId: orgLeft, userId: leaving, role: 'member' },
        { organizationId: orgKept, userId: leaving, role: 'member' },
        { organizationId: orgLeft, userId: intake, role: 'admin' },
      ]);
      asLeaving = caller(leavingUser);
      await pg.insert(notifications).values([
        ...['退出元の割り当て', '退出元の期限'].map((title) => ({
          userId: leaving,
          organizationId: orgLeft,
          type: 'lead_assigned' as const,
          title,
          message: '架空商事 山田 太郎 様',
        })),
        {
          userId: leaving,
          organizationId: orgKept,
          type: 'lead_assigned' as const,
          title: '残る先の割り当て',
          message: '架空工業',
        },
        // Of no organization: still theirs
        { userId: leaving, type: 'system' as const, title: '組織のない通知', message: 'お知らせ' },
      ]);

      // Then they are removed by an admin of the organization
      readBefore = titles(await asLeaving.notifications.list({}));
      const [membership] = await pg
        .select({ id: organizationMembers.id })
        .from(organizationMembers)
        .where(
          and(eq(organizationMembers.organizationId, orgLeft), eq(organizationMembers.userId, leaving))
        );
      await caller(intakeUser).members.remove({ organizationId: orgLeft, membershipId: membership.id });
    });

    afterAll(async () => {
      if (orgLeft) await pg.delete(organizations).where(inArray(organizations.id, [orgLeft, orgKept]));
    });

    it('no longer reads, counts or marks its notifications, but keeps the others', async () => {
      expect(readBefore).toHaveLength(4);

      const kept = ['残る先の割り当て', '組織のない通知'];
      expect(titles(await asLeaving.notifications.list({}))).toEqual(kept);
      expect(titles(await asLeaving.notifications.list({ unreadOnly: true }))).toEqual(kept);
      expect(await asLeaving.notifications.list({ organizationId: orgLeft })).toEqual([]);
      expect(await asLeaving.notifications.unreadCount({})).toEqual({ count: 2 });
      expect(await asLeaving.notifications.unreadCount({ organizationId: orgLeft })).toEqual({
        count: 0,
      });

      await asLeaving.notifications.markAllAsRead({ organizationId: orgLeft });
      await asLeaving.notifications.markAllAsRead({});
      const rows = await pg
        .select({ organizationId: notifications.organizationId, read: notifications.read })
        .from(notifications)
        .where(eq(notifications.userId, leaving));
      expect(rows.filter((row) => row.organizationId === orgLeft).map((row) => row.read)).toEqual([
        false,
        false,
      ]);
      expect(rows.filter((row) => row.organizationId !== orgLeft).every((row) => row.read)).toBe(true);
    });

    it('is not told of the first meeting preferences of a lead still assigned to them', async () => {
      await pg
        .update(organizations)
        .set({ settings: { [INTAKE_SETTINGS_KEY]: [intake] } })
        .where(eq(organizations.id, orgLeft));
      const [lead] = await pg
        .insert(leads)
        .values({
          organizationId: orgLeft,
          email: `notify-lead-${unique()}@example.co.jp`,
          name: '山田 太郎',
          company: '架空商事',
          assigneeUserId: leaving,
        })
        .returning({ id: leads.id });

      await notifyPreferencesReceived(pg, {
        organizationId: orgLeft,
        leadId: lead.id,
        identityVerified: true,
        preferences: {
          candidates: [{ date: '2026-10-22', time: '14:00' }],
          attendeeRoles: [],
          meetingFormat: 'online',
          topics: [],
          topicNote: null,
        },
      });

      const told = await pg
        .select({ userId: notifications.userId })
        .from(notifications)
        .where(
          and(
            eq(notifications.organizationId, orgLeft),
            eq(notifications.type, 'consultation_requested')
          )
        );
      expect(told).toEqual([{ userId: intake }]);
    });
  });

  it("refuses A's organization for notification settings (getPreferences, updatePreferences)", async () => {
    await expect(
      asB.notifications.getPreferences({ organizationId: orgA })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      asB.notifications.updatePreferences({ organizationId: orgA, emailDailyDigest: false })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const [prefs] = await pg
      .select({ emailDailyDigest: notificationPreferences.emailDailyDigest })
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userA));
    expect(prefs.emailDailyDigest).toBe(true);
    // B's own settings are B's, made on first read
    expect(await asB.notifications.getPreferences({ organizationId: orgB })).toMatchObject({
      organizationId: orgB,
      emailDailyDigest: false,
    });
  });
});
