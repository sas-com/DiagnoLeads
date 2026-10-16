/**
 * Member invitations on a real PostgreSQL.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_test \
 *     bunx vitest --run test/unit/integration/member-invitations.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import { organizationInvitations, organizationMembers, organizations, users } from '@/lib/db/schema';
import {
  INVITATION_TTL_MS,
  acceptInvitation,
  createInvitation,
  getInvitationPreview,
  hashInvitationToken,
  isDuplicatePendingInvitation,
  listPendingInvitations,
  revokeInvitation,
} from '@/lib/features/members/invitations';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('member invitations (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 4 }) : null;
  const database = client ? drizzle(client, { schema }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = database!;
  const db = pg as unknown as Parameters<typeof createInvitation>[0];
  const now = new Date('2026-10-15T01:00:00Z');
  const later = (ms: number) => new Date(now.getTime() + ms);
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let organizationId: string;
  let otherOrganizationId: string;
  let inviterId: string;

  const newUser = async (email = `user-${unique()}@example.com`, name: string | null = null) => {
    const [user] = await pg.insert(users).values({ email, name }).returning();
    return user;
  };
  const invite = (email: string, role: 'member' | 'admin' = 'member', at = now, orgId = organizationId) =>
    createInvitation(db, { organizationId: orgId, email, role, invitedBy: inviterId }, at);
  const membershipOf = async (userId: string, orgId = organizationId) => {
    const [row] = await pg
      .select()
      .from(organizationMembers)
      .where(and(eq(organizationMembers.userId, userId), eq(organizationMembers.organizationId, orgId)));
    return row;
  };

  beforeAll(async () => {
    const [org] = await pg
      .insert(organizations)
      .values({ name: '招待テスト株式会社', slug: `inv-${unique()}` })
      .returning();
    const [other] = await pg
      .insert(organizations)
      .values({ name: '別組織', slug: `inv-other-${unique()}` })
      .returning();
    organizationId = org.id;
    otherOrganizationId = other.id;
    inviterId = (await newUser(`owner-${unique()}@example.com`, '招待 太郎')).id;
    await pg.insert(organizationMembers).values({ organizationId, userId: inviterId, role: 'owner' });
  });

  afterAll(async () => {
    if (organizationId) await pg.delete(organizations).where(eq(organizations.id, organizationId));
    if (otherOrganizationId) {
      await pg.delete(organizations).where(eq(organizations.id, otherOrganizationId));
    }
    await client?.end();
  });

  it('stores only a hash of the token, lower-cases the address and expires in 7 days', async () => {
    const { invitation, token } = await invite('  New.Person@Example.COM ');

    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(invitation.tokenHash).toBe(hashInvitationToken(token));
    expect(invitation.tokenHash).not.toContain(token);
    expect(invitation.email).toBe('new.person@example.com');
    expect(invitation.status).toBe('pending');
    expect(invitation.expiresAt.getTime()).toBe(now.getTime() + INVITATION_TTL_MS);
  });

  it('shows the organization and inviter on the invite page', async () => {
    const { token } = await invite(`preview-${unique()}@example.com`, 'admin');

    const preview = await getInvitationPreview(db, token, now);

    expect(preview).toMatchObject({
      state: 'valid',
      organizationName: '招待テスト株式会社',
      inviterName: '招待 太郎',
      role: 'admin',
    });
    expect(await getInvitationPreview(db, 'unknown-token-value-unknown-token-value', now)).toBeNull();
    // An invitation that can no longer be used reveals nothing but its state
    expect(await getInvitationPreview(db, token, later(INVITATION_TTL_MS))).toEqual({
      state: 'expired',
    });
  });

  it('adds the invited user with the invited role and marks the invitation accepted', async () => {
    const user = await newUser(`Accept-${unique()}@Example.com`);
    const { invitation, token } = await invite(user.email, 'admin');

    const result = await acceptInvitation(db, token, user, later(1000));

    expect(result).toEqual({ ok: true, organizationId });
    expect((await membershipOf(user.id))?.role).toBe('admin');
    const [stored] = await pg
      .select()
      .from(organizationInvitations)
      .where(eq(organizationInvitations.id, invitation.id));
    expect(stored).toMatchObject({ status: 'accepted', acceptedBy: user.id });
    expect(stored.acceptedAt?.getTime()).toBe(later(1000).getTime());
  });

  it('accepting twice as the same user succeeds without a second membership', async () => {
    const user = await newUser();
    const { token } = await invite(user.email);

    await acceptInvitation(db, token, user, now);
    const again = await acceptInvitation(db, token, user, now);

    expect(again).toEqual({ ok: true, organizationId });
    const rows = await pg
      .select()
      .from(organizationMembers)
      .where(and(eq(organizationMembers.userId, user.id), eq(organizationMembers.organizationId, organizationId)));
    expect(rows).toHaveLength(1);
  });

  it('refuses a user whose email differs from the invited address', async () => {
    const invited = `invited-${unique()}@example.com`;
    const someoneElse = await newUser();
    const { token } = await invite(invited);

    expect(await acceptInvitation(db, token, someoneElse, now)).toEqual({
      ok: false,
      reason: 'email_mismatch',
    });
    expect(await membershipOf(someoneElse.id)).toBeUndefined();
  });

  it('refuses an expired, revoked, already used or unknown invitation', async () => {
    const user = await newUser();
    const { token: expiredToken } = await invite(user.email);
    expect(await acceptInvitation(db, expiredToken, user, later(INVITATION_TTL_MS))).toEqual({
      ok: false,
      reason: 'expired',
    });

    const { invitation, token: revokedToken } = await invite(user.email);
    expect(await revokeInvitation(db, organizationId, invitation.id, now)).toBe(true);
    expect(await acceptInvitation(db, revokedToken, user, now)).toEqual({
      ok: false,
      reason: 'revoked',
    });

    const first = await newUser();
    const { token: usedToken } = await invite(first.email);
    await acceptInvitation(db, usedToken, first, now);
    const second = await newUser(first.email.replace('user-', 'second-'));
    expect(await acceptInvitation(db, usedToken, { ...second, email: first.email }, now)).toEqual({
      ok: false,
      reason: 'already_used',
    });

    expect(await acceptInvitation(db, 'x'.repeat(43), user, now)).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(await membershipOf(user.id)).toBeUndefined();
  });

  it('a new invitation to the same address replaces the pending one', async () => {
    const user = await newUser();
    const { token: oldToken } = await invite(user.email);
    const { token: newToken } = await invite(user.email.toUpperCase(), 'admin');

    expect(await acceptInvitation(db, oldToken, user, now)).toEqual({ ok: false, reason: 'revoked' });
    expect(await acceptInvitation(db, newToken, user, now)).toEqual({ ok: true, organizationId });
    expect((await membershipOf(user.id))?.role).toBe('admin');
  });

  it('keeps the role of someone who is already a member', async () => {
    const user = await newUser();
    await pg.insert(organizationMembers).values({ organizationId, userId: user.id, role: 'owner' });
    const { token } = await invite(user.email, 'member');

    expect(await acceptInvitation(db, token, user, now)).toEqual({ ok: true, organizationId });
    expect((await membershipOf(user.id))?.role).toBe('owner');
  });

  it('lists only pending invitations of the organization and revokes only its own', async () => {
    const email = `list-${unique()}@example.com`;
    const { invitation } = await invite(email);
    const { invitation: elsewhere } = await invite(email, 'member', now, otherOrganizationId);

    const listed = await listPendingInvitations(db, organizationId, later(INVITATION_TTL_MS));
    const mine = listed.find((row) => row.id === invitation.id);
    expect(mine).toMatchObject({ email, role: 'member', expired: true });
    expect(listed.some((row) => row.id === elsewhere.id)).toBe(false);

    expect(await revokeInvitation(db, organizationId, elsewhere.id, now)).toBe(false);
    expect(await revokeInvitation(db, organizationId, invitation.id, now)).toBe(true);
    expect(await revokeInvitation(db, organizationId, invitation.id, now)).toBe(false);
    expect((await listPendingInvitations(db, organizationId, now)).some((r) => r.id === invitation.id)).toBe(
      false
    );
  });

  it('waits for a concurrent acceptance instead of adding the member twice', async () => {
    const user = await newUser();
    const { invitation, token } = await invite(user.email);
    let pending: Promise<unknown> | undefined;

    // Another request accepts the invitation while holding its row; ours must wait and see it
    await client?.begin(async (sql) => {
      await sql`select id from organization_invitations where id = ${invitation.id} for no key update`;
      await sql`insert into organization_members (organization_id, user_id, role)
        values (${organizationId}, ${user.id}, 'member')`;
      await sql`update organization_invitations
        set status = 'accepted', accepted_by = ${user.id}, accepted_at = now()
        where id = ${invitation.id}`;
      pending = acceptInvitation(db, token, user, now);
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    expect(await pending).toEqual({ ok: true, organizationId });
    const rows = await pg
      .select()
      .from(organizationMembers)
      .where(and(eq(organizationMembers.userId, user.id), eq(organizationMembers.organizationId, organizationId)));
    expect(rows).toHaveLength(1);
  });

  it('two invitations to the same address at once: the later one is a recognizable conflict', async () => {
    const email = `dup-${unique()}@example.com`;
    let pending: Promise<unknown> | undefined;

    // Another request has inserted a pending invitation but not committed yet; ours runs meanwhile
    await client?.begin(async (sql) => {
      await sql`insert into organization_invitations
        (organization_id, email, role, token_hash, invited_by, expires_at)
        values (${organizationId}, ${email}, 'member', ${`held-${unique()}`}, ${inviterId}, now() + interval '7 days')`;
      pending = invite(email).then(
        () => null,
        (error: unknown) => error
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    const error = await pending;
    expect(error).not.toBeNull();
    expect(isDuplicatePendingInvitation(error)).toBe(true);
    const rows = (await listPendingInvitations(db, organizationId, now)).filter(
      (row) => row.email === email
    );
    expect(rows).toHaveLength(1);
  });

});
