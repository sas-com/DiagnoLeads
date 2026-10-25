/**
 * An ended session ends on the next request (#578): the real better-auth handler, auth
 * configuration, tRPC context and tRPC route on PostgreSQL. The cookies are copied the way a
 * browser holds them, every cookie the sign-up response set, as someone who copied them from the
 * browser would send them. After sign-out, or once the session row is gone (a password reset,
 * #529, and deleting the account delete it), they sign no one in: the session read every admin
 * page makes (GET /api/auth/get-session), the session of the tRPC context, and a protected
 * procedure all see no session.
 *
 * This holds because the session is not cached in a cookie (session.cookieCache is off, decision
 * 2026-10-24-session-cookie-cache-off). With the cache on, sign-up also sets a signed session_data
 * cookie that better-auth trusts without the database until it expires, and these tests fail.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_test \
 *     bunx vitest --run test/unit/integration/session-revocation.db.test.ts
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
const { connection } = vi.hoisted(() => {
  const target = process.env.TEST_DATABASE_URL;
  return { connection: { url: target } };
});
vi.mock('@/lib/db/client', async () => {
  const pg = await import('postgres');
  const { drizzle: connect } = await import('drizzle-orm/postgres-js');
  const dbSchema = await import('@/lib/db/schema');
  const client = pg.default(connection.url ?? 'postgres://unused@127.0.0.1:1/unused', { max: 2 });
  return { db: connect(client, { schema: dbSchema }) };
});
vi.mock('@/lib/ops/alert', () => ({ reportServerError: vi.fn() }));

const APP = 'http://localhost:3000';
const PASSWORD = 'Password123';
/** A protected procedure (signed in, no organization) that only reads */
const PROTECTED_PROCEDURE = 'account.soleOwnedOrganizations';

type SessionAnswer = { session: { userId: string }; user: { id: string } } | null;

describe.skipIf(!url)('ended sessions end on the next request (better-auth + PostgreSQL)', () => {
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
  /** Every cookie the response set, as a browser sends them back (name=value; ...) */
  const cookiesFrom = (res: Response) =>
    res.headers
      .getSetCookie()
      .map((header) => header.split(';')[0])
      .join('; ');
  const sessionRows = (userId: string) =>
    pg.select().from(sessions).where(eq(sessions.userId, userId));

  /** What the admin pages ask for (useSession) */
  const getSession = async (cookie: string): Promise<SessionAnswer> => {
    const res = await authRequest('/get-session', { headers: { cookie } });
    expect(res.status).toBe(200);
    return (await res.json()) as SessionAnswer;
  };
  /** The session the tRPC context reads for a request with these cookies */
  const contextSession = async (cookie: string) => {
    const { createContext } = await import('@/lib/trpc/context');
    const req = new Request(`${APP}/api/trpc/${PROTECTED_PROCEDURE}`, { headers: { cookie } });
    const context = await createContext({ req } as FetchCreateContextFnOptions);
    return context.session;
  };
  /** The protected procedure through the app's tRPC route, as the admin pages call it */
  const callProtected = async (cookie: string) => {
    const { GET } = await import('@/app/api/trpc/[trpc]/route');
    return GET(new Request(`${APP}/api/trpc/${PROTECTED_PROCEDURE}`, { headers: { cookie } }));
  };

  /** An invited person who signs up; returns the cookies their browser now holds */
  async function signedUpBrowser() {
    const email = `revoke-${unique()}@example.com`;
    const { token } = await createInvitation(db, {
      organizationId,
      email,
      role: 'member',
      invitedBy: inviterId,
    });
    const res = await authRequest('/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: APP },
      body: JSON.stringify({ name: '取消 太郎', email, password: PASSWORD, invitationToken: token }),
    });
    expect(res.status).toBe(200);
    const [user] = await pg.select().from(users).where(eq(users.email, email));
    userIds.push(user.id);
    const cookie = cookiesFrom(res);
    expect(cookie).toContain('better-auth.session_token=');
    return { userId: user.id, cookie };
  }

  /** The copied cookies sign the user in everywhere: the checks below are not empty */
  async function expectSignedIn(cookie: string, userId: string) {
    expect((await getSession(cookie))?.user.id).toBe(userId);
    expect((await contextSession(cookie))?.user.id).toBe(userId);
    const res = await callProtected(cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: { data: { json: [] } } });
  }

  /** The copied cookies sign no one in, on the very next request */
  async function expectSignedOut(cookie: string) {
    expect(await getSession(cookie)).toBeNull();
    expect(await contextSession(cookie)).toBeNull();
    const res = await callProtected(cookie);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({
      error: { json: { data: { code: 'UNAUTHORIZED', httpStatus: 401 } } },
    });
  }

  beforeAll(async () => {
    const [org] = await pg
      .insert(organizations)
      .values({ name: 'セッション取消テスト', slug: `revoke-${unique()}` })
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

  it('signs the copied cookies out with sign-out', async () => {
    const browser = await signedUpBrowser();
    await expectSignedIn(browser.cookie, browser.userId);

    const signOut = await authRequest('/sign-out', {
      method: 'POST',
      headers: { cookie: browser.cookie, origin: APP },
    });

    expect(signOut.status).toBe(200);
    expect(await sessionRows(browser.userId)).toHaveLength(0);
    await expectSignedOut(browser.cookie);
  });

  it('signs the copied cookies out once the session row is deleted (password reset, account deletion)', async () => {
    const browser = await signedUpBrowser();
    await expectSignedIn(browser.cookie, browser.userId);

    await pg.delete(sessions).where(eq(sessions.userId, browser.userId));

    await expectSignedOut(browser.cookie);
  });
});
