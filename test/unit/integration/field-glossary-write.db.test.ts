/**
 * field_glossary write authorization and upsert/delete (Epic #780 P0b, Issue #800) against
 * PostgreSQL. Only an owner/admin of the operator organization (resolveDiagnosisOrganizationId,
 * mocked here) may write; a member of the operator org, an owner/admin of another org, and a
 * non-member are all refused (FORBIDDEN). Reads (getByKeys) stay open to any authenticated user.
 * The orgs, users and rows created here are cleaned up afterwards.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_test \
 *     bunx vitest --run test/unit/integration/field-glossary-write.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import {
  type OrganizationRole,
  fieldGlossary,
  organizationMembers,
  organizations,
  users,
} from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { inArray, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

// The operator organization is read from the environment in production; the test controls it here.
const operator = vi.hoisted(() => ({ id: null as string | null }));
vi.mock('@/lib/multi-tenant/helpers/diagnosis-organization', () => ({
  resolveDiagnosisOrganizationId: () => operator.id,
  isDiagnosisOrganization: (organizationId: string, diagnosisOrganizationId: string | null) =>
    diagnosisOrganizationId !== null &&
    diagnosisOrganizationId.toLowerCase() === organizationId.toLowerCase(),
}));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('field glossary write authorization (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // A field_key segment must start with a letter and be alphanumeric (fieldKeySchema), so the
  // namespace is a single alphanumeric segment — the prefix for every `${ns}.<field>` key below.
  // (unique() keeps its hyphens for the org slug and user email, which allow them.)
  const ns = `fgwrite${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  const organizationIds: string[] = [];
  const userIds: string[] = [];

  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller from createCaller
  type Caller = any;

  async function createOrganization(name: string): Promise<string> {
    const [org] = await pg
      .insert(organizations)
      .values({ name, slug: `glossary-write-${unique()}` })
      .returning();
    organizationIds.push(org.id);
    return org.id;
  }

  async function callerFor(
    membership: { organizationId: string; role: OrganizationRole } | null
  ): Promise<Caller> {
    const [user] = await pg
      .insert(users)
      .values({ email: `glossary-write-${unique()}@example.com`, name: 'Editor' })
      .returning();
    userIds.push(user.id);
    if (membership) {
      await pg.insert(organizationMembers).values({
        organizationId: membership.organizationId,
        userId: user.id,
        role: membership.role,
      });
    }
    return appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId: user.id }, user },
      user,
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);
  }

  let operatorOrg: string;
  let otherOrg: string;
  let owner: Caller;
  let admin: Caller;
  let member: Caller;
  let otherOwner: Caller;
  let outsider: Caller;

  beforeAll(async () => {
    operatorOrg = await createOrganization('運営組織');
    otherOrg = await createOrganization('別の組織');
    operator.id = operatorOrg;
    owner = await callerFor({ organizationId: operatorOrg, role: 'owner' });
    admin = await callerFor({ organizationId: operatorOrg, role: 'admin' });
    member = await callerFor({ organizationId: operatorOrg, role: 'member' });
    otherOwner = await callerFor({ organizationId: otherOrg, role: 'owner' });
    outsider = await callerFor(null);
  });

  afterAll(async () => {
    if (client) {
      await pg.delete(fieldGlossary).where(like(fieldGlossary.fieldKey, `${ns}%`));
      if (userIds.length > 0) {
        await pg.delete(organizationMembers).where(inArray(organizationMembers.userId, userIds));
        await pg.delete(users).where(inArray(users.id, userIds));
      }
      if (organizationIds.length > 0) {
        await pg.delete(organizations).where(inArray(organizations.id, organizationIds));
      }
      await client.end();
    }
  });

  it('lets an owner of the operator organization create, update, list and delete an entry', async () => {
    const created = await owner.fieldGlossary.upsert({
      fieldKey: `${ns}.status`,
      descriptionJa: '説明',
    });
    expect(created.fieldKey).toBe(`${ns}.status`);
    expect(created.value).toBeNull();
    expect(created.updatedBy).toBeTruthy();

    const updated = await owner.fieldGlossary.upsert({
      id: created.id,
      fieldKey: `${ns}.status`,
      descriptionJa: '新しい説明',
    });
    expect(updated.id).toBe(created.id);
    expect(updated.descriptionJa).toBe('新しい説明');

    const listed = await owner.fieldGlossary.list();
    expect(listed.entries.some((e: { id: string }) => e.id === created.id)).toBe(true);

    await owner.fieldGlossary.delete({ id: created.id });
    const after = await owner.fieldGlossary.list();
    expect(after.entries.some((e: { id: string }) => e.id === created.id)).toBe(false);
  });

  it('lets an admin of the operator organization write', async () => {
    const created = await admin.fieldGlossary.upsert({ fieldKey: `${ns}.admin`, descriptionJa: 'x' });
    expect(created.id).toBeTruthy();
    await admin.fieldGlossary.delete({ id: created.id });
  });

  it('refuses a member of the operator organization', async () => {
    await expect(
      member.fieldGlossary.upsert({ fieldKey: `${ns}.member`, descriptionJa: 'x' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(member.fieldGlossary.list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('checks authorization before input: a member sending an invalid field key gets FORBIDDEN, not BAD_REQUEST', async () => {
    await expect(
      member.fieldGlossary.upsert({ fieldKey: 'nodot', descriptionJa: 'x' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses an owner of another organization', async () => {
    await expect(
      otherOwner.fieldGlossary.upsert({ fieldKey: `${ns}.other`, descriptionJa: 'x' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses a user who is not a member of any organization', async () => {
    await expect(
      outsider.fieldGlossary.upsert({ fieldKey: `${ns}.outsider`, descriptionJa: 'x' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses everyone when no operator organization is configured', async () => {
    operator.id = null;
    try {
      await expect(
        owner.fieldGlossary.upsert({ fieldKey: `${ns}.noop`, descriptionJa: 'x' })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    } finally {
      operator.id = operatorOrg;
    }
  });

  it('lets any authenticated user read via getByKeys while writes stay restricted', async () => {
    const created = await owner.fieldGlossary.upsert({
      fieldKey: `${ns}.readable`,
      descriptionJa: '読める',
    });
    const read = await outsider.fieldGlossary.getByKeys({ keys: [`${ns}.readable`] });
    expect(read.entries.some((e: { id: string }) => e.id === created.id)).toBe(true);
    await owner.fieldGlossary.delete({ id: created.id });
  });

  it('validates input: a field key without a dot, and an empty value, are refused', async () => {
    await expect(
      owner.fieldGlossary.upsert({ fieldKey: 'nodot', descriptionJa: 'x' })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      owner.fieldGlossary.upsert({ fieldKey: `${ns}.spaces`, value: '   ', descriptionJa: 'x' })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('refuses a duplicate field and value with CONFLICT', async () => {
    const first = await owner.fieldGlossary.upsert({
      fieldKey: `${ns}.dup`,
      value: 'x',
      descriptionJa: 'a',
    });
    await expect(
      owner.fieldGlossary.upsert({ fieldKey: `${ns}.dup`, value: 'x', descriptionJa: 'b' })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await owner.fieldGlossary.delete({ id: first.id });
  });
});
