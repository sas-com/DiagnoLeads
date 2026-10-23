/**
 * Organization isolation of members and invitations (#356) on a real PostgreSQL: the owner of
 * organization B passes the ids of A's memberships and A's invitation. A's members keep their
 * roles and stay, A's invitation stays pending, and B's lists show nothing of A. All values are
 * fictional.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/members-org-isolation.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import type { OrganizationRole } from '@/lib/db/schema';
import { organizationInvitations, organizationMembers, organizations, users } from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('members: organization isolation (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let orgA: string;
  let orgB: string;
  const userIds: string[] = [];
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let ownerB: any;
  /** A's memberships: a member and an admin */
  const membershipsA: { id: string; role: string }[] = [];
  let invitationA: string;

  async function addMember(organizationId: string, role: OrganizationRole) {
    const [user] = await pg
      .insert(users)
      .values({ email: `members-iso-${unique()}@example.com`, name: 'テスト' })
      .returning();
    userIds.push(user.id);
    const [membership] = await pg
      .insert(organizationMembers)
      .values({ organizationId, userId: user.id, role })
      .returning({ id: organizationMembers.id, role: organizationMembers.role });
    const caller = appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId: user.id }, user },
      user,
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);
    return { membership, caller };
  }

  const membershipOf = async (id: string) =>
    (await pg.select().from(organizationMembers).where(eq(organizationMembers.id, id)))[0];

  beforeAll(async () => {
    const created = await pg
      .insert(organizations)
      .values([
        { name: 'メンバー切り分けA', slug: `members-iso-a-${unique()}` },
        { name: 'メンバー切り分けB', slug: `members-iso-b-${unique()}` },
      ])
      .returning({ id: organizations.id });
    orgA = created[0].id;
    orgB = created[1].id;
    for (const role of ['member', 'admin'] as const) {
      membershipsA.push((await addMember(orgA, role)).membership);
    }
    ownerB = (await addMember(orgB, 'owner')).caller;
    const [invitation] = await pg
      .insert(organizationInvitations)
      .values({
        organizationId: orgA,
        email: `invited-${unique()}@example.com`,
        role: 'member',
        tokenHash: `hash-${unique()}`,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      })
      .returning({ id: organizationInvitations.id });
    invitationA = invitation.id;
  });

  afterAll(async () => {
    if (orgA) await pg.delete(organizations).where(inArray(organizations.id, [orgA, orgB]));
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  it("refuses B's owner when it names organization A itself (list, listInvitations)", async () => {
    await expect(ownerB.members.list({ organizationId: orgA })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(ownerB.members.listInvitations({ organizationId: orgA })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it("lists none of A's members or invitations (list, listInvitations)", async () => {
    const { members, total } = await ownerB.members.list({ organizationId: orgB });
    expect(total).toBe(1);
    expect(members.map((m: { id: string }) => m.id)).not.toEqual(
      expect.arrayContaining(membershipsA.map((m) => m.id))
    );
    const invitations = await ownerB.members.listInvitations({ organizationId: orgB });
    expect(JSON.stringify(invitations)).not.toContain(invitationA);
  });

  it("changes no role of A's members by their membership ids (updateRole)", async () => {
    for (const { id, role } of membershipsA) {
      for (const next of ['member', 'admin', 'owner'] as const) {
        await expect(
          ownerB.members.updateRole({ organizationId: orgB, membershipId: id, role: next })
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      }
      expect((await membershipOf(id))?.role).toBe(role);
    }
  });

  it("removes none of A's members by their membership ids (remove)", async () => {
    for (const { id } of membershipsA) {
      await expect(
        ownerB.members.remove({ organizationId: orgB, membershipId: id })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(await membershipOf(id)).toBeDefined();
    }
  });

  it("does not revoke A's invitation by its id (revokeInvitation)", async () => {
    await expect(
      ownerB.members.revokeInvitation({ organizationId: orgB, invitationId: invitationA })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [invitation] = await pg
      .select({ status: organizationInvitations.status })
      .from(organizationInvitations)
      .where(eq(organizationInvitations.id, invitationA));
    expect(invitation.status).toBe('pending');
  });
});
