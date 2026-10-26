/**
 * Keys notifications.updatePreferences does not declare (#743), on a real PostgreSQL through the
 * tRPC router. organizationInputSchema passes unknown keys through and tRPC merges the parsed
 * inputs, so the resolver's input still carries keys that the procedure's own schema drops. Only
 * the preference switches may reach the update: a member who adds another member's userId or a
 * new id keeps the row their own (user_id, organization_id, id and created_at unchanged, and the
 * other member's row untouched), a value of the wrong type for a column is not an internal error,
 * and the switches sent still change. All values are fictional.
 *
 * The keys sent are the table's property names (userId, id, createdAt): drizzle's .set() writes
 * only those and ignores database column names such as organization_id. organizationId is
 * declared by the procedure (it picks the organization whose membership is checked), so it does
 * not arrive as an unknown key.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/notification-preferences-unknown-keys.db.test.ts
 */
import { randomUUID } from 'node:crypto';
import * as schema from '@/lib/db/schema';
import { notificationPreferences, organizationMembers, organizations, users } from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

type Caller = ReturnType<typeof appRouter.createCaller>;
type UpdateInput = Parameters<Caller['notifications']['updatePreferences']>[0];

/** The input as a caller can send it over HTTP: declared fields plus keys of its own choosing */
const withUnknownKeys = (input: UpdateInput, unknownKeys: Record<string, unknown>): UpdateInput =>
  Object.assign({}, input, unknownKeys);

/** 'ok', or the tRPC error code the call failed with */
async function outcome(call: Promise<unknown>): Promise<string> {
  try {
    await call;
    return 'ok';
  } catch (error) {
    return error instanceof TRPCError ? error.code : String(error);
  }
}

describe.skipIf(!url)('notifications.updatePreferences: keys it does not declare (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  const pg = client
    ? drizzle(client, { schema })
    : (null as unknown as ReturnType<typeof drizzle<typeof schema>>);
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let orgA: string;
  let senderId: string;
  let otherMemberId: string;
  const userIds: string[] = [];
  let asSender: Caller;

  /** Ids shown by name, so a failure reads "other member" rather than a uuid */
  const who = (id: string) =>
    ({ [senderId]: 'sender', [otherMemberId]: 'other member', [orgA]: 'A' })[id] ?? id;

  const rowsOf = (userId: string, organizationId: string) =>
    pg
      .select()
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.userId, userId),
          eq(notificationPreferences.organizationId, organizationId)
        )
      );

  const rowById = async (id: string) =>
    (await pg.select().from(notificationPreferences).where(eq(notificationPreferences.id, id)))[0];

  /** The sender's own row in organization A, made on first read like the settings screen does */
  const senderRow = () => asSender.notifications.getPreferences({ organizationId: orgA });

  beforeAll(async () => {
    const [created] = await pg
      .insert(organizations)
      .values({ name: '通知の設定A', slug: `prefs-keys-a-${unique()}` })
      .returning({ id: organizations.id });
    orgA = created.id;
    const [sender, other] = await pg
      .insert(users)
      .values([
        { email: `prefs-keys-sender-${unique()}@example.com`, name: '送る社員' },
        { email: `prefs-keys-other-${unique()}@example.com`, name: 'ほかの社員' },
      ])
      .returning();
    senderId = sender.id;
    otherMemberId = other.id;
    userIds.push(sender.id, other.id);
    await pg.insert(organizationMembers).values([
      { organizationId: orgA, userId: sender.id, role: 'member' },
      { organizationId: orgA, userId: other.id, role: 'member' },
    ]);
    // The other member already has settings in A: the daily digest off, the weekly report on
    await pg.insert(notificationPreferences).values({
      userId: other.id,
      organizationId: orgA,
      emailDailyDigest: false,
      emailWeeklyReport: true,
    });
    asSender = appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId: sender.id }, user: sender },
      user: sender,
    } as unknown as Parameters<typeof appRouter.createCaller>[0]);
  });

  afterAll(async () => {
    if (orgA) await pg.delete(organizations).where(eq(organizations.id, orgA));
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  it("keeps the row the sender's when another member's userId is sent", async () => {
    const before = await senderRow();

    const result = await outcome(
      asSender.notifications.updatePreferences(
        withUnknownKeys({ organizationId: orgA, emailDailyDigest: true }, { userId: otherMemberId })
      )
    );

    expect(result).toBe('ok');
    const stored = await rowById(before.id);
    expect({
      row: {
        user: who(stored?.userId ?? 'no row'),
        organization: who(stored?.organizationId ?? 'no row'),
        emailDailyDigest: stored?.emailDailyDigest,
        createdAt: stored?.createdAt,
      },
      // One row each: the sender's row did not become a second row of the other member
      senderRowsInA: (await rowsOf(senderId, orgA)).length,
      otherMemberDigestInA: (await rowsOf(otherMemberId, orgA)).map((row) => row.emailDailyDigest),
    }).toEqual({
      row: { user: 'sender', organization: 'A', emailDailyDigest: true, createdAt: before.createdAt },
      senderRowsInA: 1,
      otherMemberDigestInA: [false],
    });
  });

  it('keeps the primary key when a new id is sent', async () => {
    const before = await senderRow();
    const sentId = randomUUID();

    const result = await outcome(
      asSender.notifications.updatePreferences(
        withUnknownKeys({ organizationId: orgA, emailWeeklyReport: false }, { id: sentId })
      )
    );

    expect(result).toBe('ok');
    expect(await rowById(sentId)).toBeUndefined();
    expect(await rowById(before.id)).toMatchObject({
      userId: senderId,
      organizationId: orgA,
      emailWeeklyReport: false,
    });
  });

  it('is not an internal error when a column gets a value of the wrong type (createdAt)', async () => {
    const before = await senderRow();

    const result = await outcome(
      asSender.notifications.updatePreferences(
        withUnknownKeys(
          { organizationId: orgA, inAppLeadCreated: false },
          { createdAt: 'not-a-date' }
        )
      )
    );

    expect(result).toBe('ok');
    expect(await rowById(before.id)).toMatchObject({
      userId: senderId,
      inAppLeadCreated: false,
      createdAt: before.createdAt,
    });
  });

  it('changes nothing but updatedAt when only keys it does not declare are sent', async () => {
    const before = await senderRow();

    const result = await outcome(
      asSender.notifications.updatePreferences(
        withUnknownKeys({ organizationId: orgA }, { userId: otherMemberId, updatedAt: 'x' })
      )
    );

    expect(result).toBe('ok');
    const { updatedAt: _beforeUpdatedAt, ...unchanged } = before;
    expect(await rowById(before.id)).toMatchObject(unchanged);
  });
});
