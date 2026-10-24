/**
 * Changing the password in the settings page ends the user's other sessions (#591): the real
 * better-auth handler and configuration on PostgreSQL, called with the body the settings page
 * sends (revokeOtherSessions: true). The browser that changes the password is signed in again
 * with a new session; every other session of the user is deleted. Other users are left alone.
 *
 * The browsers that lose their session can still hold a signed session_data cookie
 * (session.cookieCache); better-auth answers from it without the database until it expires
 * (#578), so these checks read the session from the database.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_test \
 *     bunx vitest --run test/unit/integration/password-change-sessions.db.test.ts
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
const OLD_PASSWORD = 'Password123';
const NEW_PASSWORD = 'NewPassword456';

describe.skipIf(!url)('password change ends the other sessions (better-auth + PostgreSQL)', () => {
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
  /** The session token cookie a browser keeps from a response that signs it in */
  const sessionCookie = (res: Response) => {
    const cookie = res.headers
      .getSetCookie()
      .map((header) => header.split(';')[0])
      .find((pair) => pair.startsWith('better-auth.session_token='));
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
  const signIn = (email: string, password: string) => call('/sign-in/email', { email, password });
  /** What the settings page sends (app/[locale]/(dashboard)/settings/page.tsx) */
  const changePassword = (cookie: string, currentPassword: string) =>
    call(
      '/change-password',
      { currentPassword, newPassword: NEW_PASSWORD, revokeOtherSessions: true },
      cookie
    );

  /** An invited person who signs up (this browser) and then signs in elsewhere (other browser) */
  async function userWithTwoSessions() {
    const email = `change-${unique()}@example.com`;
    const { token } = await createInvitation(db, {
      organizationId,
      email,
      role: 'member',
      invitedBy: inviterId,
    });
    const signUp = await call('/sign-up/email', {
      name: '変更 花子',
      email,
      password: OLD_PASSWORD,
      invitationToken: token,
    });
    expect(signUp.status).toBe(200);
    const otherBrowser = await signIn(email, OLD_PASSWORD);
    expect(otherBrowser.status).toBe(200);
    const [user] = await pg.select().from(users).where(eq(users.email, email));
    userIds.push(user.id);
    const rows = await sessionRows(user.id);
    expect(rows).toHaveLength(2);
    return {
      email,
      userId: user.id,
      thisBrowser: sessionCookie(signUp),
      otherBrowser: sessionCookie(otherBrowser),
      sessionIds: rows.map((row) => row.id),
    };
  }

  beforeAll(async () => {
    const [org] = await pg
      .insert(organizations)
      .values({ name: 'パスワード変更テスト', slug: `change-${unique()}` })
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

  it('keeps only a new session for the browser that changed it; other users stay', async () => {
    const someone = await userWithTwoSessions();
    const bystander = await userWithTwoSessions();

    const res = await changePassword(someone.thisBrowser, OLD_PASSWORD);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string | null; user: { id: string } };
    expect(body.user.id).toBe(someone.userId);
    // The browser gets a new session cookie in the same response
    const renewed = sessionCookie(res);
    expect(renewed).not.toBe(someone.thisBrowser);

    const rows = await sessionRows(someone.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].token).toBe(body.token);
    expect(someone.sessionIds).not.toContain(rows[0].id);
    // The changing browser stays signed in with the new cookie; both old cookies are dead
    expect((await sessionOf(renewed))?.session.id).toBe(rows[0].id);
    expect(await sessionOf(someone.thisBrowser)).toBeNull();
    expect(await sessionOf(someone.otherBrowser)).toBeNull();
    // Another user's sessions are untouched
    expect((await sessionRows(bystander.userId)).map((row) => row.id).sort()).toEqual(
      [...bystander.sessionIds].sort()
    );
    for (const cookie of [bystander.thisBrowser, bystander.otherBrowser]) {
      expect((await sessionOf(cookie))?.user.id).toBe(bystander.userId);
    }

    // Only the new password signs in from now on
    expect((await signIn(someone.email, OLD_PASSWORD)).status).toBe(401);
    expect((await signIn(someone.email, NEW_PASSWORD)).status).toBe(200);
  });

  it('ends nothing when the current password is wrong', async () => {
    const someone = await userWithTwoSessions();

    const res = await changePassword(someone.thisBrowser, 'WrongPassword789');

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'INVALID_PASSWORD' });
    expect((await sessionRows(someone.userId)).map((row) => row.id).sort()).toEqual(
      [...someone.sessionIds].sort()
    );
    for (const cookie of [someone.thisBrowser, someone.otherBrowser]) {
      expect((await sessionOf(cookie))?.user.id).toBe(someone.userId);
    }
    expect((await signIn(someone.email, OLD_PASSWORD)).status).toBe(200);
  });

  it('refuses a browser that is not signed in', async () => {
    const someone = await userWithTwoSessions();

    const res = await call('/change-password', {
      currentPassword: OLD_PASSWORD,
      newPassword: NEW_PASSWORD,
      revokeOtherSessions: true,
    });

    expect(res.status).toBe(401);
    expect(await sessionRows(someone.userId)).toHaveLength(2);
  });
});
