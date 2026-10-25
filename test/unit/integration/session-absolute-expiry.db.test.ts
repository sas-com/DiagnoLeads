/**
 * A session ends 7 days after sign-in, however often it is used (#647, session.disableSessionRefresh,
 * decision 2026-10-25-session-absolute-expiry): the real better-auth handler, auth configuration
 * and tRPC context on PostgreSQL. Time is moved by rewriting the session row (created_at,
 * updated_at, expires_at shifted into the past, as if signed in that many days ago and never
 * refreshed), not by waiting.
 *
 * With refresh on, better-auth (1.6.33) moves expires_at to "now + 7 days" on a session read once
 * updated_at is more than updateAge (1 day) old (api/routes/session.mjs), and re-issues the
 * session cookie; then these tests fail.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_test \
 *     bunx vitest --run test/unit/integration/session-absolute-expiry.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import { organizations, sessions, users } from '@/lib/db/schema';
import { createInvitation } from '@/lib/features/members/invitations';
import type { FetchCreateContextFnOptions } from '@trpc/server/adapters/fetch';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const url = process.env.TEST_DATABASE_URL;

// The auth configuration and the tRPC context use the app's database client; point it at the
// test database
const { connection } = vi.hoisted(() => ({ connection: { url: process.env.TEST_DATABASE_URL } }));
vi.mock('@/lib/db/client', async () => {
  const pg = await import('postgres');
  const { drizzle: connect } = await import('drizzle-orm/postgres-js');
  const dbSchema = await import('@/lib/db/schema');
  const client = pg.default(connection.url ?? 'postgres://unused@127.0.0.1:1/unused', { max: 2 });
  return { db: connect(client, { schema: dbSchema }) };
});
// No email is sent here; keep the email module from loading its provider
vi.mock('@/lib/features/email', () => ({ sendEmail: vi.fn() }));

const APP = 'http://localhost:3000';
const PASSWORD = 'Password123';
const SESSION_COOKIE = 'better-auth.session_token=';
const DAY = 24 * 60 * 60 * 1000;
const SEVEN_DAYS = 7 * DAY;

type SessionAnswer = { session: { id: string; expiresAt: string }; user: { id: string } } | null;

describe.skipIf(!url)('sessions end 7 days after sign-in (better-auth + PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  const database = client ? drizzle(client, { schema }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = database!;
  const db = pg as unknown as Parameters<typeof createInvitation>[0];
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const userIds: string[] = [];
  let organizationId: string;
  let inviterId: string;

  const authRequest = async (path: string, init: RequestInit = {}) => {
    const { auth } = await import('@/lib/auth/config');
    return auth.handler(new Request(`${APP}/api/auth${path}`, init));
  };
  const sessionRow = async (sessionId: string) => {
    const [row] = await pg.select().from(sessions).where(eq(sessions.id, sessionId));
    return row;
  };
  /** What the admin pages ask for (useSession): the answer and the session cookies it re-issued */
  const getSession = async (cookie: string) => {
    const res = await authRequest('/get-session', { headers: { cookie } });
    expect(res.status).toBe(200);
    const reissued = res.headers
      .getSetCookie()
      .filter((header) => header.startsWith(SESSION_COOKIE));
    return { answer: (await res.json()) as SessionAnswer, reissued };
  };
  /** The session the tRPC context reads for a request with this cookie */
  const contextSession = async (cookie: string) => {
    const { createContext } = await import('@/lib/trpc/context');
    const req = new Request(`${APP}/api/trpc/account.soleOwnedOrganizations`, {
      headers: { cookie },
    });
    return (await createContext({ req } as FetchCreateContextFnOptions)).session;
  };

  /** An invited person who signs up; returns their session cookie and session row */
  async function signedUpBrowser() {
    const email = `expiry-${unique()}@example.com`;
    const { token } = await createInvitation(db, {
      organizationId,
      email,
      role: 'member',
      invitedBy: inviterId,
    });
    const res = await authRequest('/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: APP },
      body: JSON.stringify({ name: '期限 三郎', email, password: PASSWORD, invitationToken: token }),
    });
    expect(res.status).toBe(200);
    const [user] = await pg.select().from(users).where(eq(users.email, email));
    userIds.push(user.id);
    const cookie = res.headers
      .getSetCookie()
      .map((header) => header.split(';')[0])
      .find((pair) => pair.startsWith(SESSION_COOKIE));
    if (!cookie) throw new Error('no session cookie in the sign-up response');
    const [row] = await pg.select().from(sessions).where(eq(sessions.userId, user.id));
    return { userId: user.id, cookie, signedInRow: row };
  }

  /** Moves the session back in time by `ms`, as if signed in that much earlier and never refreshed */
  async function moveBack(sessionId: string, ms: number) {
    const row = await sessionRow(sessionId);
    const [moved] = await pg
      .update(sessions)
      .set({
        createdAt: new Date(row.createdAt.getTime() - ms),
        updatedAt: new Date(row.updatedAt.getTime() - ms),
        expiresAt: new Date(row.expiresAt.getTime() - ms),
      })
      .where(eq(sessions.id, sessionId))
      .returning();
    return moved;
  }

  beforeAll(async () => {
    const [org] = await pg
      .insert(organizations)
      .values({ name: 'セッションの期限テスト', slug: `expiry-${unique()}` })
      .returning();
    organizationId = org.id;
    const [inviter] = await pg
      .insert(users)
      .values({ email: `inviter-${unique()}@example.com` })
      .returning();
    inviterId = inviter.id;
    userIds.push(inviter.id);
  });

  afterAll(async () => {
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    if (organizationId) await pg.delete(organizations).where(eq(organizations.id, organizationId));
    await client?.end();
  });

  it('gives a new session 7 days from sign-in', async () => {
    const { signedInRow } = await signedUpBrowser();

    const lifetime = signedInRow.expiresAt.getTime() - signedInRow.createdAt.getTime();

    expect(Math.abs(lifetime - SEVEN_DAYS)).toBeLessThan(60 * 1000);
  });

  it('does not extend a session past updateAge when the admin pages read it (get-session)', async () => {
    const browser = await signedUpBrowser();
    // Signed in 2 days ago, last refreshed then: past updateAge (1 day), 5 days left
    const aged = await moveBack(browser.signedInRow.id, 2 * DAY);

    const { answer, reissued } = await getSession(browser.cookie);

    expect(answer?.user.id).toBe(browser.userId);
    expect(new Date(answer?.session.expiresAt ?? 0).getTime()).toBe(aged.expiresAt.getTime());
    expect(reissued).toEqual([]);
    expect(await sessionRow(aged.id)).toEqual(aged);
  });

  it('does not extend a session past updateAge when the tRPC context reads it', async () => {
    const browser = await signedUpBrowser();
    const aged = await moveBack(browser.signedInRow.id, 2 * DAY);

    const session = await contextSession(browser.cookie);

    expect(session?.user.id).toBe(browser.userId);
    expect(await sessionRow(aged.id)).toEqual(aged);
  });

  it('ends the session 7 days after sign-in although it was used every day', async () => {
    const browser = await signedUpBrowser();
    const { id, expiresAt: signedInExpiry } = browser.signedInRow;

    // Days 1 to 6 after sign-in: used once a day, still signed in, the expiry never moves
    for (let day = 1; day <= 6; day += 1) {
      await moveBack(id, DAY);
      const { answer } = await getSession(browser.cookie);
      expect(answer?.session.id).toBe(id);
      expect((await sessionRow(id)).expiresAt.getTime()).toBe(signedInExpiry.getTime() - day * DAY);
    }

    // Day 7 (and a minute): the session has expired and signs no one in any more
    await moveBack(id, DAY + 60 * 1000);
    expect((await getSession(browser.cookie)).answer).toBeNull();
    expect(await contextSession(browser.cookie)).toBeNull();
    // better-auth deletes the expired row when it finds it
    expect(await sessionRow(id)).toBeUndefined();
  });
});
