/**
 * A password reset ends every session of the user (#529): the real better-auth handler and
 * configuration on PostgreSQL, through the same endpoints the reset pages call (request a link,
 * then reset with the token the link carries). Other users' sessions are left alone.
 *
 * These checks send the session token cookie alone and read past the cookie cache, so they look
 * the session up in the database. The cache is off (session.cookieCache, #578); that every cookie
 * a browser holds is signed out once the session row is gone is checked in
 * session-revocation.db.test.ts.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_test \
 *     bunx vitest --run test/unit/integration/password-reset-sessions.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import { organizations, sessions, users, verification } from '@/lib/db/schema';
import { createInvitation } from '@/lib/features/members/invitations';
import { and, eq, inArray, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const url = process.env.TEST_DATABASE_URL;

// The auth configuration uses the app's database client; point it at the test database
const { connection, sendEmail } = vi.hoisted(() => {
  const target = process.env.TEST_DATABASE_URL;
  return { connection: { url: target }, sendEmail: vi.fn() };
});
vi.mock('@/lib/db/client', async () => {
  const pg = await import('postgres');
  const { drizzle: connect } = await import('drizzle-orm/postgres-js');
  const dbSchema = await import('@/lib/db/schema');
  const client = pg.default(connection.url ?? 'postgres://unused@127.0.0.1:1/unused', { max: 2 });
  return { db: connect(client, { schema: dbSchema }) };
});
// The reset email is not sent; its background task runs at once instead of in after()
vi.mock('@/lib/features/email', () => ({ sendEmail }));
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => unknown) => {
    void task();
  },
}));

const APP = 'http://localhost:3000';
const OLD_PASSWORD = 'Password123';
const NEW_PASSWORD = 'NewPassword456';

describe.skipIf(!url)('password reset ends the sessions (better-auth + PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  const database = client ? drizzle(client, { schema }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = database!;
  const db = pg as unknown as Parameters<typeof createInvitation>[0];
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const userIds: string[] = [];
  let organizationId: string;
  let inviterId: string;

  const call = async (path: string, body: Record<string, unknown>) => {
    const { auth } = await import('@/lib/auth/config');
    return auth.handler(
      new Request(`${APP}/api/auth${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: APP },
        body: JSON.stringify(body),
      })
    );
  };
  /** The session token cookie a browser keeps from a sign-up or sign-in response */
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
  /** What the forgot-password form sends (components/auth/ResetPasswordForm.tsx) */
  const requestReset = (email: string) =>
    call('/request-password-reset', { email, redirectTo: `${APP}/reset-password/confirm` });
  const signIn = (email: string, password: string) => call('/sign-in/email', { email, password });

  /** An invited person who signs up (browser A) and then signs in elsewhere (browser B) */
  async function userWithTwoSessions() {
    const email = `reset-${unique()}@example.com`;
    const { token } = await createInvitation(db, {
      organizationId,
      email,
      role: 'member',
      invitedBy: inviterId,
    });
    const signUp = await call('/sign-up/email', {
      name: '再設定 花子',
      email,
      password: OLD_PASSWORD,
      invitationToken: token,
    });
    expect(signUp.status).toBe(200);
    const otherBrowser = await signIn(email, OLD_PASSWORD);
    expect(otherBrowser.status).toBe(200);
    const [user] = await pg.select().from(users).where(eq(users.email, email));
    userIds.push(user.id);
    return {
      email,
      userId: user.id,
      browsers: [sessionCookie(signUp), sessionCookie(otherBrowser)],
    };
  }

  /** The token of the reset link, as better-auth stored it for the link in the email */
  async function resetTokenFor(userId: string) {
    const rows = await pg
      .select()
      .from(verification)
      .where(
        and(eq(verification.value, userId), like(verification.identifier, 'reset-password:%'))
      );
    expect(rows).toHaveLength(1);
    return rows[0].identifier.slice('reset-password:'.length);
  }

  beforeAll(async () => {
    const [org] = await pg
      .insert(organizations)
      .values({ name: '再設定テスト', slug: `reset-${unique()}` })
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
    if (userIds.length > 0) {
      await pg.delete(verification).where(inArray(verification.value, userIds));
      await pg.delete(users).where(inArray(users.id, userIds));
    }
    if (organizationId) await pg.delete(organizations).where(eq(organizations.id, organizationId));
    await client?.end();
  });

  it('deletes every session of the user, in each browser, and keeps other users signed in', async () => {
    const someone = await userWithTwoSessions();
    const bystander = await userWithTwoSessions();
    expect(await sessionRows(someone.userId)).toHaveLength(2);
    for (const cookie of someone.browsers) {
      expect((await sessionOf(cookie))?.user.id).toBe(someone.userId);
    }

    expect((await requestReset(someone.email)).status).toBe(200);
    const token = await resetTokenFor(someone.userId);
    // The link in the email carries the same token
    await vi.waitFor(() =>
      expect(sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: someone.email, text: expect.stringContaining(token) })
      )
    );
    // Asking for the link alone ends nothing
    expect(await sessionRows(someone.userId)).toHaveLength(2);

    const reset = await call('/reset-password', { newPassword: NEW_PASSWORD, token });

    expect(reset.status).toBe(200);
    expect(await reset.json()).toEqual({ status: true });
    expect(await sessionRows(someone.userId)).toHaveLength(0);
    for (const cookie of someone.browsers) expect(await sessionOf(cookie)).toBeNull();
    // Another user's sessions are untouched
    expect(await sessionRows(bystander.userId)).toHaveLength(2);
    for (const cookie of bystander.browsers) {
      expect((await sessionOf(cookie))?.user.id).toBe(bystander.userId);
    }
  });

  it('lets the user sign in again with the new password only, and the link works once', async () => {
    const someone = await userWithTwoSessions();
    await requestReset(someone.email);
    const token = await resetTokenFor(someone.userId);
    expect((await call('/reset-password', { newPassword: NEW_PASSWORD, token })).status).toBe(200);

    expect((await signIn(someone.email, OLD_PASSWORD)).status).toBe(401);
    const signedIn = await signIn(someone.email, NEW_PASSWORD);
    expect(signedIn.status).toBe(200);
    expect(await sessionRows(someone.userId)).toHaveLength(1);
    expect((await sessionOf(sessionCookie(signedIn)))?.user.id).toBe(someone.userId);

    // The used link cannot reset the password again, and the new session stays
    const again = await call('/reset-password', { newPassword: 'ThirdPassword789', token });
    expect(again.status).toBe(400);
    expect(await again.json()).toMatchObject({ code: 'INVALID_TOKEN' });
    expect(await sessionRows(someone.userId)).toHaveLength(1);
  });
});
