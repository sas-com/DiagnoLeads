/**
 * Content editors granted from the settings screen (#91), through the tRPC routers on a real
 * PostgreSQL: who may grant, membership of the operating organization, audit logs, cascades.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_test \
 *     bunx vitest --run test/unit/integration/content-editors.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import { auditLogs, contentEditors, organizationMembers, organizations, users } from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const { orgState } = vi.hoisted(() => ({ orgState: { id: null as string | null } }));
vi.mock('@/lib/features/diagnostics/organization', () => ({
  resolveDiagnosisOrganizationId: () => orgState.id,
}));
vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('content editors (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/suspicious/noExplicitAny: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const orgIds: string[] = [];
  const userIds: string[] = [];
  let operatingOrg: string;
  let otherOrg: string;
  type TestUser = typeof users.$inferSelect;
  let owner: TestUser;
  let member: TestUser;
  let otherAdmin: TestUser;

  const callerFor = (user: TestUser) =>
    appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId: user.id }, user },
      user,
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);

  const createUser = async (label: string) => {
    const [user] = await pg
      .insert(users)
      .values({ email: `editors-${label}-${unique()}@example.com`, name: `Test ${label}` })
      .returning();
    userIds.push(user.id);
    return user;
  };

  const auditRows = (resourceId: string) =>
    pg
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.resource, 'content_editor'), eq(auditLogs.resourceId, resourceId)));

  beforeAll(async () => {
    const [operating, other] = await pg
      .insert(organizations)
      .values([
        { name: 'Operating Org', slug: `editors-op-${unique()}` },
        { name: 'Other Org', slug: `editors-other-${unique()}` },
      ])
      .returning();
    operatingOrg = operating.id;
    otherOrg = other.id;
    orgIds.push(operatingOrg, otherOrg);
    orgState.id = operatingOrg;

    owner = await createUser('owner');
    member = await createUser('member');
    otherAdmin = await createUser('other-admin');
    await pg.insert(organizationMembers).values([
      { organizationId: operatingOrg, userId: owner.id, role: 'owner' },
      { organizationId: operatingOrg, userId: member.id, role: 'member' },
      { organizationId: otherOrg, userId: otherAdmin.id, role: 'admin' },
    ]);
  });

  afterAll(async () => {
    if (userIds.length) await pg.delete(users).where(inArray(users.id, userIds));
    if (orgIds.length) await pg.delete(organizations).where(inArray(organizations.id, orgIds));
    await client?.end();
  });

  it('an owner is not an editor until granted; candidates are the members', async () => {
    await expect(callerFor(owner).content.canEdit()).resolves.toBe(false);
    const candidates = await callerFor(owner).contentEditors.candidates();
    expect(candidates.map((c) => c.userId).sort()).toEqual([owner.id, member.id].sort());
  });

  it('grants a member, idempotently, with one audit log in the operating organization', async () => {
    await expect(callerFor(member).content.canEdit()).resolves.toBe(false);

    await expect(callerFor(owner).contentEditors.grant({ userId: member.id })).resolves.toEqual({
      created: true,
    });
    await expect(callerFor(owner).contentEditors.grant({ userId: member.id })).resolves.toEqual({
      created: false,
    });

    const rows = await pg.select().from(contentEditors).where(eq(contentEditors.userId, member.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].grantedBy).toBe(owner.id);
    const audits = await auditRows(member.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      organizationId: operatingOrg,
      userId: owner.id,
      action: 'create',
    });

    await expect(callerFor(member).content.canEdit()).resolves.toBe(true);
    const candidates = await callerFor(owner).contentEditors.candidates();
    expect(candidates.map((c) => c.userId)).toEqual([owner.id]);
  });

  it('forbids an admin of another organization and refuses non-members', async () => {
    await expect(callerFor(otherAdmin).contentEditors.list()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      callerFor(otherAdmin).contentEditors.grant({ userId: otherAdmin.id })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      callerFor(owner).contentEditors.grant({ userId: otherAdmin.id })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    const rows = await pg
      .select()
      .from(contentEditors)
      .where(eq(contentEditors.userId, otherAdmin.id));
    expect(rows).toHaveLength(0);
  });

  it('a granted user who leaves the operating organization can no longer edit', async () => {
    await pg
      .delete(organizationMembers)
      .where(
        and(
          eq(organizationMembers.userId, member.id),
          eq(organizationMembers.organizationId, operatingOrg)
        )
      );

    await expect(callerFor(member).content.canEdit()).resolves.toBe(false);
    const list = await callerFor(owner).contentEditors.list();
    expect(list).toEqual([expect.objectContaining({ userId: member.id, active: false })]);

    await pg
      .insert(organizationMembers)
      .values({ organizationId: operatingOrg, userId: member.id, role: 'member' });
    await expect(callerFor(member).content.canEdit()).resolves.toBe(true);
  });

  it('revoking removes the grant and writes an audit log', async () => {
    await expect(callerFor(owner).contentEditors.revoke({ userId: member.id })).resolves.toEqual({
      revoked: true,
    });
    await expect(callerFor(member).content.canEdit()).resolves.toBe(false);
    await expect(callerFor(owner).contentEditors.list()).resolves.toEqual([]);
    const audits = await auditRows(member.id);
    expect(audits.map((a) => a.action).sort()).toEqual(['create', 'delete']);
  });

  it('deleting a user removes their grant; deleting the granter keeps it', async () => {
    const granter = await createUser('granter');
    const editor = await createUser('editor');
    await pg.insert(organizationMembers).values([
      { organizationId: operatingOrg, userId: granter.id, role: 'admin' },
      { organizationId: operatingOrg, userId: editor.id, role: 'member' },
    ]);
    await callerFor(granter).contentEditors.grant({ userId: editor.id });

    await pg.delete(users).where(eq(users.id, granter.id));
    const [kept] = await pg
      .select()
      .from(contentEditors)
      .where(eq(contentEditors.userId, editor.id));
    expect(kept.grantedBy).toBeNull();

    await pg.delete(users).where(eq(users.id, editor.id));
    const gone = await pg.select().from(contentEditors).where(eq(contentEditors.userId, editor.id));
    expect(gone).toHaveLength(0);
  });
});
