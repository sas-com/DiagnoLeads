/**
 * Ids sent to the admin API must belong to the caller's organization (#350): lead tags,
 * comments and activities, the template of an embed config, and the parent of an organization.
 * Rows of another organization answer NOT_FOUND and nothing is read or changed.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_test \
 *     bunx vitest --run test/unit/integration/tenant-scope.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import {
  diagnosticTemplates,
  embedConfigs,
  leadComments,
  leadTags,
  leads,
  organizationMembers,
  organizations,
  tags,
  users,
} from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

// The embed router uses the app's database client; point it at the test database
const { connection } = vi.hoisted(() => ({ connection: { url: process.env.TEST_DATABASE_URL } }));
vi.mock('@/lib/db/client', async () => {
  const pg = await import('postgres');
  const { drizzle: connect } = await import('drizzle-orm/postgres-js');
  const dbSchema = await import('@/lib/db/schema');
  const client = pg.default(connection.url ?? 'postgres://unused@127.0.0.1:1/unused', { max: 2 });
  return { db: connect(client, { schema: dbSchema }) };
});

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('tenant scope of ids sent to the admin API (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organizationIds: string[] = [];
  const userIds: string[] = [];

  let orgA: string;
  let orgB: string;
  let adminA: string;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let asA: any;
  let leadA: string;
  let leadA2: string;
  let leadB: string;
  let tagA: string;
  let tagB: string;

  async function createOrganization(name: string) {
    const [org] = await pg
      .insert(organizations)
      .values({ name, slug: `scope-${unique()}` })
      .returning();
    organizationIds.push(org.id);
    return org.id;
  }

  async function createMember(organizationId: string, role: schema.OrganizationRole) {
    const [user] = await pg
      .insert(users)
      .values({ email: `scope-${unique()}@example.com`, name: 'Scope' })
      .returning();
    userIds.push(user.id);
    await pg.insert(organizationMembers).values({ organizationId, userId: user.id, role });
    return user.id;
  }

  function callerFor(userId: string) {
    const user = { id: userId, email: 'scope@example.com', name: 'Scope' };
    return appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId }, user },
      user,
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);
  }

  async function insertLead(organizationId: string) {
    const [row] = await pg
      .insert(leads)
      .values({ organizationId, email: `lead-${unique()}@example.com`, status: 'new' })
      .returning();
    return row.id;
  }

  async function insertTag(organizationId: string, name: string) {
    const [row] = await pg.insert(tags).values({ organizationId, name }).returning();
    return row.id;
  }

  async function insertTemplate(organizationId: string) {
    const [row] = await pg
      .insert(diagnosticTemplates)
      .values({ organizationId, name: 'Template', slug: `t-${unique()}`, title: 'Template' })
      .returning();
    return row.id;
  }

  const tagIdsOf = async (leadId: string) =>
    (await pg.select().from(leadTags).where(eq(leadTags.leadId, leadId))).map((r) => r.tagId);

  beforeAll(async () => {
    orgA = await createOrganization('Scope A');
    orgB = await createOrganization('Scope B');
    adminA = await createMember(orgA, 'admin');
    await createMember(orgB, 'admin');
    asA = callerFor(adminA);
    leadA = await insertLead(orgA);
    leadA2 = await insertLead(orgA);
    leadB = await insertLead(orgB);
    tagA = await insertTag(orgA, 'A tag');
    tagB = await insertTag(orgB, 'B tag');
    await pg.insert(leadTags).values({ leadId: leadB, tagId: tagB });
  });

  afterAll(async () => {
    if (organizationIds.length > 0) {
      await pg.delete(organizations).where(inArray(organizations.id, organizationIds));
    }
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  describe('lead tags', () => {
    it('tags, reads and replaces the tags of its own leads', async () => {
      await asA.tags.addToLead({ organizationId: orgA, leadId: leadA, tagId: tagA });
      expect(await tagIdsOf(leadA)).toEqual([tagA]);

      const read = await asA.tags.getLeadTags({ organizationId: orgA, leadId: leadA });
      expect(read.map((t: { id: string }) => t.id)).toEqual([tagA]);

      await asA.tags.setLeadTags({ organizationId: orgA, leadId: leadA, tagIds: [] });
      expect(await tagIdsOf(leadA)).toEqual([]);

      await asA.tags.bulkSetLeadTags({
        organizationId: orgA,
        leadIds: [leadA, leadA2],
        tagIds: [tagA],
      });
      expect(await tagIdsOf(leadA)).toEqual([tagA]);
      expect(await tagIdsOf(leadA2)).toEqual([tagA]);

      await asA.tags.removeFromLead({ organizationId: orgA, leadId: leadA2, tagId: tagA });
      expect(await tagIdsOf(leadA2)).toEqual([]);
    });

    it('refuses a lead or a tag of another organization and changes nothing', async () => {
      const notFound = { code: 'NOT_FOUND' };
      await expect(
        asA.tags.addToLead({ organizationId: orgA, leadId: leadB, tagId: tagA })
      ).rejects.toMatchObject(notFound);
      await expect(
        asA.tags.addToLead({ organizationId: orgA, leadId: leadA, tagId: tagB })
      ).rejects.toMatchObject(notFound);
      await expect(
        asA.tags.removeFromLead({ organizationId: orgA, leadId: leadB, tagId: tagB })
      ).rejects.toMatchObject(notFound);
      await expect(
        asA.tags.setLeadTags({ organizationId: orgA, leadId: leadB, tagIds: [] })
      ).rejects.toMatchObject(notFound);
      await expect(
        asA.tags.setLeadTags({ organizationId: orgA, leadId: leadA, tagIds: [tagB] })
      ).rejects.toMatchObject(notFound);
      await expect(
        asA.tags.getLeadTags({ organizationId: orgA, leadId: leadB })
      ).rejects.toMatchObject(notFound);
      await expect(
        asA.tags.bulkSetLeadTags({ organizationId: orgA, leadIds: [leadA, leadB], tagIds: [] })
      ).rejects.toMatchObject(notFound);
      await expect(
        asA.tags.bulkSetLeadTags({ organizationId: orgA, leadIds: [leadA], tagIds: [tagB] })
      ).rejects.toMatchObject(notFound);

      expect(await tagIdsOf(leadB)).toEqual([tagB]);
      // The refused bulk call did not clear the tags of its own lead either
      expect(await tagIdsOf(leadA)).toEqual([tagA]);
    });
  });

  describe('comments and activities', () => {
    it('comments on its own lead and replies inside the same lead', async () => {
      const parent = await asA.comments.create({
        organizationId: orgA,
        leadId: leadA,
        content: 'first',
      });
      const reply = await asA.comments.create({
        organizationId: orgA,
        leadId: leadA,
        content: 'reply',
        parentId: parent.id,
      });
      expect(reply).toMatchObject({ leadId: leadA, parentId: parent.id });

      const activity = await asA.comments.addActivity({
        organizationId: orgA,
        leadId: leadA,
        content: 'called',
      });
      expect(activity).toMatchObject({ leadId: leadA, type: 'activity' });
    });

    it('refuses a lead or a parent comment it does not own and saves nothing', async () => {
      const [foreign] = await pg
        .insert(leadComments)
        .values({ organizationId: orgB, leadId: leadB, content: 'B only' })
        .returning();
      const [otherLead] = await pg
        .insert(leadComments)
        .values({ organizationId: orgA, leadId: leadA2, content: 'on another lead' })
        .returning();
      const before = await pg.select().from(leadComments);

      const notFound = { code: 'NOT_FOUND' };
      await expect(
        asA.comments.create({ organizationId: orgA, leadId: leadB, content: 'x' })
      ).rejects.toMatchObject(notFound);
      await expect(
        asA.comments.create({
          organizationId: orgA,
          leadId: leadA,
          content: 'x',
          parentId: foreign.id,
        })
      ).rejects.toMatchObject(notFound);
      await expect(
        asA.comments.create({
          organizationId: orgA,
          leadId: leadA,
          content: 'x',
          parentId: otherLead.id,
        })
      ).rejects.toMatchObject(notFound);
      await expect(
        asA.comments.addActivity({ organizationId: orgA, leadId: leadB, content: 'x' })
      ).rejects.toMatchObject(notFound);

      expect(await pg.select().from(leadComments)).toHaveLength(before.length);
    });
  });

  describe('embed config template', () => {
    const config = { name: 'Widget', allowedOrigins: ['https://example.com'] };

    it('uses a template of its own organization', async () => {
      const own = await insertTemplate(orgA);
      const created = await asA.embed.create({
        organizationId: orgA,
        ...config,
        diagnosticTemplateId: own,
      });
      expect(created.diagnosticTemplateId).toBe(own);
    });

    it('refuses a template of another organization on create and update', async () => {
      const foreign = await insertTemplate(orgB);
      const notFound = { code: 'NOT_FOUND' };
      await expect(
        asA.embed.create({ organizationId: orgA, ...config, diagnosticTemplateId: foreign })
      ).rejects.toMatchObject(notFound);

      const created = await asA.embed.create({ organizationId: orgA, ...config });
      await expect(
        asA.embed.update({
          organizationId: orgA,
          id: created.id,
          data: { diagnosticTemplateId: foreign },
        })
      ).rejects.toMatchObject(notFound);

      const [row] = await pg.select().from(embedConfigs).where(eq(embedConfigs.id, created.id));
      expect(row.diagnosticTemplateId).toBeNull();
      const linked = await pg
        .select()
        .from(embedConfigs)
        .where(eq(embedConfigs.diagnosticTemplateId, foreign));
      expect(linked).toHaveLength(0);
    });
  });

  describe('parent organization', () => {
    it('refuses a parent the caller cannot manage and leaves the hierarchy alone', async () => {
      const child = await createOrganization('Scope child');
      const groupOwner = await createMember(child, 'group_owner');

      await expect(
        callerFor(groupOwner).hierarchy.setParent({
          organizationId: child,
          parentOrganizationId: orgB,
        })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      const [row] = await pg.select().from(organizations).where(eq(organizations.id, child));
      expect(row.parentOrganizationId).toBeNull();
    });

    it('sets a parent the caller is a group owner of', async () => {
      const parent = await createOrganization('Scope parent');
      const child = await createOrganization('Scope child 2');
      const groupOwner = await createMember(parent, 'group_owner');
      await pg
        .insert(organizationMembers)
        .values({ organizationId: child, userId: groupOwner, role: 'group_owner' });

      await callerFor(groupOwner).hierarchy.setParent({
        organizationId: child,
        parentOrganizationId: parent,
      });

      const [row] = await pg.select().from(organizations).where(eq(organizations.id, child));
      expect(row.parentOrganizationId).toBe(parent);
    });
  });
});
