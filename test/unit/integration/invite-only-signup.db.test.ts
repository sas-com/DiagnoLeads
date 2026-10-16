/**
 * Invitation-only sign-up through the real better-auth handler on PostgreSQL: the sign-up
 * endpoint called directly (as an attacker would) is refused without a valid invitation token.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_test \
 *     bunx vitest --run test/unit/integration/invite-only-signup.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import { organizationInvitations, organizations, users } from '@/lib/db/schema';
import { createInvitation } from '@/lib/features/members/invitations';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const url = process.env.TEST_DATABASE_URL;

// The auth configuration uses the app's database client; point it at the test database
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

describe.skipIf(!url)('invitation-only sign-up (better-auth + PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = drizzle(client!, { schema });
  const db = pg as unknown as Parameters<typeof createInvitation>[0];
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let organizationId: string;
  let inviterId: string;

  const signUp = async (body: Record<string, unknown>) => {
    const { auth } = await import('@/lib/auth/config');
    return auth.handler(
      new Request('http://localhost:3000/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        body: JSON.stringify({ name: '招待 次郎', password: 'Password123', ...body }),
      })
    );
  };
  const userCount = async (email: string) =>
    (await pg.select().from(users).where(eq(users.email, email.toLowerCase()))).length;

  beforeAll(async () => {
    const [org] = await pg
      .insert(organizations)
      .values({ name: '登録テスト', slug: `signup-${unique()}` })
      .returning();
    organizationId = org.id;
    const [inviter] = await pg
      .insert(users)
      .values({ email: `inviter-${unique()}@example.com` })
      .returning();
    inviterId = inviter.id;
  });

  afterAll(async () => {
    if (organizationId) await pg.delete(organizations).where(eq(organizations.id, organizationId));
    await client?.end();
  });

  it('refuses a direct sign-up without an invitation token and creates no user', async () => {
    const email = `nobody-${unique()}@example.com`;

    const res = await signUp({ email });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'INVITATION_REQUIRED' });
    expect(await userCount(email)).toBe(0);
  });

  it('refuses an invited address without its token (the address alone is not enough)', async () => {
    const email = `invited-${unique()}@example.com`;
    await createInvitation(db, { organizationId, email, role: 'member', invitedBy: inviterId });

    const res = await signUp({ email, invitationToken: 'x'.repeat(43) });

    expect(res.status).toBe(403);
    expect(await userCount(email)).toBe(0);
  });

  it('refuses a valid token used for a different address', async () => {
    const { token } = await createInvitation(db, {
      organizationId,
      email: `owner-of-token-${unique()}@example.com`,
      role: 'member',
      invitedBy: inviterId,
    });
    const other = `other-${unique()}@example.com`;

    const res = await signUp({ email: other, invitationToken: token });

    expect(res.status).toBe(403);
    expect(await userCount(other)).toBe(0);
  });

  it('refuses an expired or revoked invitation', async () => {
    const email = `late-${unique()}@example.com`;
    const { invitation, token } = await createInvitation(db, {
      organizationId,
      email,
      role: 'member',
      invitedBy: inviterId,
    });
    await pg
      .update(organizationInvitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(organizationInvitations.id, invitation.id));
    expect((await signUp({ email, invitationToken: token })).status).toBe(403);

    const again = await createInvitation(db, { organizationId, email, role: 'member', invitedBy: inviterId });
    await pg
      .update(organizationInvitations)
      .set({ status: 'revoked' })
      .where(eq(organizationInvitations.id, again.invitation.id));
    expect((await signUp({ email, invitationToken: again.token })).status).toBe(403);
    expect(await userCount(email)).toBe(0);
  });

  it('lets the invited person sign up with the token, whatever the letter case, and sign in', async () => {
    const email = `welcome-${unique()}@example.com`;
    const { token } = await createInvitation(db, { organizationId, email, role: 'member', invitedBy: inviterId });

    const res = await signUp({ email: email.toUpperCase(), invitationToken: token });

    expect(res.status).toBe(200);
    expect(await userCount(email)).toBe(1);

    const { auth } = await import('@/lib/auth/config');
    const signIn = await auth.handler(
      new Request('http://localhost:3000/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        body: JSON.stringify({ email, password: 'Password123' }),
      })
    );
    expect(signIn.status).toBe(200);
  });

  it('refuses to create a user outside the sign-up endpoint (the database hook)', async () => {
    const { auth } = await import('@/lib/auth/config');
    const context = await auth.$context;
    const email = `internal-${unique()}@example.com`;

    await expect(
      context.internalAdapter.createUser({ email, name: '経路外', emailVerified: false })
    ).rejects.toMatchObject({ body: { code: 'INVITATION_REQUIRED' } });
    expect(await userCount(email)).toBe(0);
  });
});
