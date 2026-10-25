/**
 * "Sign out other devices" in the settings page (#647): the real better-auth handler and
 * configuration on PostgreSQL, called the way the page calls it (authClient.revokeOtherSessions,
 * POST /api/auth/revoke-other-sessions with the session cookie of this browser). Every other
 * session of the user is deleted; the session of this browser stays as it was (same row, same
 * cookie, nothing re-issued), so this browser stays signed in. Other users are left alone.
 *
 * The checks read the session from the database (disableCookieCache), so they hold whether or not
 * session.cookieCache is on; it is off since #578, so the signed-out browsers are signed out at
 * their next request (session-revocation.db.test.ts).
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_test \
 *     bunx vitest --run test/unit/integration/sign-out-other-devices.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import { organizations, sessions, users } from '@/lib/db/schema';
import { createInvitation } from '@/lib/features/members/invitations';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const url = process.env.TEST_DATABASE_URL;

// The auth configuration uses the app's database client; point it at the test database
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

describe.skipIf(!url)('sign out other devices (better-auth + PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  const database = client ? drizzle(client, { schema }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = database!;
  const db = pg as unknown as Parameters<typeof createInvitation>[0];
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const userIds: string[] = [];
  let organizationId: string;
  let inviterId: string;

  const call = async (path: string, body: Record<string, unknown>, cookie?: string) => {
    const { auth } = await import('@/lib/auth/config');
    const headers: Record<string, string> = { 'content-type': 'application/json', origin: APP };
    if (cookie) headers.cookie = cookie;
    return auth.handler(
      new Request(`${APP}/api/auth${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
    );
  };
  /** The session token cookies a response sets (name=value) */
  const sessionCookiesSet = (res: Response) =>
    res.headers
      .getSetCookie()
      .map((header) => header.split(';')[0])
      .filter((pair) => pair.startsWith(SESSION_COOKIE));
  /** The session token cookie a browser keeps from a response that signs it in */
  const sessionCookie = (res: Response) => {
    const [cookie] = sessionCookiesSet(res);
    if (!cookie) throw new Error(`no session cookie in the response (${res.status})`);
    return cookie;
  };
  /** The session that cookie stands for, read from the database (not the cookie cache) */
  const sessionOf = async (cookie: string) => {
    const { auth } = await import('@/lib/auth/config');
    return auth.api.getSession({
      headers: new Headers({ cookie }),
      query: { disableCookieCache: true },
    });
  };
  const sessionRows = (userId: string) =>
    pg.select().from(sessions).where(eq(sessions.userId, userId));
  const signIn = (email: string) => call('/sign-in/email', { email, password: PASSWORD });
  /** What the settings page sends (components/features/account/sign-out-other-devices-card.tsx) */
  const signOutOtherDevices = (cookie?: string) => call('/revoke-other-sessions', {}, cookie);

  /** An invited person who signs up in this browser, then signs in on a phone and another PC */
  async function userOnThreeDevices() {
    const email = `devices-${unique()}@example.com`;
    const { token } = await createInvitation(db, {
      organizationId,
      email,
      role: 'member',
      invitedBy: inviterId,
    });
    const signUp = await call('/sign-up/email', {
      name: '端末 次郎',
      email,
      password: PASSWORD,
      invitationToken: token,
    });
    expect(signUp.status).toBe(200);
    const phone = await signIn(email);
    expect(phone.status).toBe(200);
    const otherPc = await signIn(email);
    expect(otherPc.status).toBe(200);
    const [user] = await pg.select().from(users).where(eq(users.email, email));
    userIds.push(user.id);
    const rows = await sessionRows(user.id);
    expect(rows).toHaveLength(3);
    const thisBrowser = sessionCookie(signUp);
    const thisSession = await sessionOf(thisBrowser);
    const thisRow = rows.find((row) => row.id === thisSession?.session.id);
    if (!thisRow) throw new Error('no session row for this browser');
    return {
      userId: user.id,
      thisBrowser,
      thisRow,
      phone: sessionCookie(phone),
      otherPc: sessionCookie(otherPc),
      sessionIds: rows.map((row) => row.id),
    };
  }

  beforeAll(async () => {
    const [org] = await pg
      .insert(organizations)
      .values({ name: 'ほかの端末のログアウトテスト', slug: `devices-${unique()}` })
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

  it('deletes the other sessions of the user and keeps the session of this browser as it was', async () => {
    const someone = await userOnThreeDevices();
    const bystander = await userOnThreeDevices();

    const res = await signOutOtherDevices(someone.thisBrowser);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: true });
    // Only the row of this browser is left, unchanged: same token, same expiry
    expect(await sessionRows(someone.userId)).toEqual([someone.thisRow]);
    // This browser keeps its cookie (nothing re-issued) and stays signed in with it
    expect(sessionCookiesSet(res)).toEqual([]);
    expect((await sessionOf(someone.thisBrowser))?.session.id).toBe(someone.thisRow.id);
    // The phone and the other PC are signed out
    expect(await sessionOf(someone.phone)).toBeNull();
    expect(await sessionOf(someone.otherPc)).toBeNull();
    // Another user's sessions are untouched
    expect((await sessionRows(bystander.userId)).map((row) => row.id).sort()).toEqual(
      [...bystander.sessionIds].sort()
    );
    for (const cookie of [bystander.thisBrowser, bystander.phone, bystander.otherPc]) {
      expect((await sessionOf(cookie))?.user.id).toBe(bystander.userId);
    }
  });

  it('does not let a signed-out device sign out the browser that is left', async () => {
    const someone = await userOnThreeDevices();
    expect((await signOutOtherDevices(someone.thisBrowser)).status).toBe(200);

    // e.g. someone who had copied the phone's cookie tries it after the owner signed it out
    const res = await signOutOtherDevices(someone.phone);

    expect(res.status).toBe(401);
    expect(await sessionRows(someone.userId)).toEqual([someone.thisRow]);
    expect((await sessionOf(someone.thisBrowser))?.session.id).toBe(someone.thisRow.id);
  });

  it('refuses a browser that is not signed in', async () => {
    const someone = await userOnThreeDevices();

    const res = await signOutOtherDevices();

    expect(res.status).toBe(401);
    expect((await sessionRows(someone.userId)).map((row) => row.id).sort()).toEqual(
      [...someone.sessionIds].sort()
    );
  });
});
