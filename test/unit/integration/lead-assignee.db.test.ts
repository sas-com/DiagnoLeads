/**
 * Lead assignee and intake on a real PostgreSQL (#135): assignment only to members of the lead's
 * organization, the audit row, the list filters and sort, the intake setting and the
 * consultation recipients, the dashboard's pending list, and ON DELETE SET NULL.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_test \
 *     bunx vitest --run test/unit/integration/lead-assignee.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import { auditLogs, leads, organizationMembers, organizations, users } from '@/lib/db/schema';
import { getDashboardSummary } from '@/lib/features/analytics/dashboard';
import { consultationRecipients, listIntakeMembers } from '@/lib/features/leads/assignment';
import { appRouter } from '@/server/routers/_app';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const notifyLeadAssigned = vi.hoisted(() => vi.fn());
vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/features/leads/assignment-notify', () => ({ notifyLeadAssigned }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('lead assignee (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organizationIds: string[] = [];
  const userIds: string[] = [];

  let orgA: string;
  let orgB: string;
  type Member = { id: string; email: string; name: string | null };
  let admin: Member; // org A admin (the caller)
  let sales: Member; // org A member
  let viewer: Member; // org A parent_viewer (read-only)
  let outsider: Member; // org B admin
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let asAdmin: any;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let asSales: any;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let asViewer: any;

  async function createOrganization(name: string) {
    const [org] = await pg
      .insert(organizations)
      .values({ name, slug: `assignee-${unique()}`, settings: { keep: 'me' } })
      .returning();
    organizationIds.push(org.id);
    return org.id;
  }

  async function createMember(
    organizationId: string,
    role: schema.OrganizationRole,
    name: string | null
  ): Promise<Member> {
    const [user] = await pg
      .insert(users)
      .values({ email: `assignee-${unique()}@example.com`, name })
      .returning();
    userIds.push(user.id);
    await pg.insert(organizationMembers).values({ organizationId, userId: user.id, role });
    return { id: user.id, email: user.email, name: user.name };
  }

  function callerFor(member: Member) {
    const user = { id: member.id, email: member.email, name: member.name };
    return appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId: member.id }, user },
      user,
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);
  }

  async function insertLead(organizationId: string, values: Partial<typeof leads.$inferInsert> = {}) {
    const [row] = await pg
      .insert(leads)
      .values({ organizationId, email: `lead-${unique()}@example.com`, status: 'new', ...values })
      .returning();
    return row;
  }

  const auditRows = (leadId: string) =>
    pg
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.resource, 'lead'), eq(auditLogs.resourceId, leadId)));

  beforeAll(async () => {
    orgA = await createOrganization('担当テストA株式会社');
    orgB = await createOrganization('担当テストB株式会社');
    admin = await createMember(orgA, 'admin', '窓口 太郎');
    sales = await createMember(orgA, 'member', '佐藤 花子');
    viewer = await createMember(orgA, 'parent_viewer', '閲覧 次郎');
    outsider = await createMember(orgB, 'admin', '他社 三郎');
    asAdmin = callerFor(admin);
    asSales = callerFor(sales);
    asViewer = callerFor(viewer);
  });

  beforeEach(() => {
    notifyLeadAssigned.mockReset();
    notifyLeadAssigned.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    if (!client) return;
    if (organizationIds.length > 0) {
      await pg.delete(organizations).where(inArray(organizations.id, organizationIds));
    }
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client.end();
  });

  describe('leads.assign', () => {
    it('assigns a member of the organization, audits it and tells the assignee', async () => {
      const lead = await insertLead(orgA, { name: '山田', company: '山田製作所' });
      const updated = await asAdmin.leads.assign({
        organizationId: orgA,
        id: lead.id,
        assigneeUserId: sales.id,
      });
      expect(updated.assigneeUserId).toBe(sales.id);

      const rows = await auditRows(lead.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: 'update',
        userId: admin.id,
        organizationId: orgA,
        changes: { before: { assignee: null }, after: { assignee: '佐藤 花子' } },
        metadata: { assigneeUserId: { before: null, after: sales.id } },
      });
      expect(notifyLeadAssigned).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: orgA,
          leadId: lead.id,
          leadName: '山田',
          company: '山田製作所',
          assignee: expect.objectContaining({ userId: sales.id, email: sales.email }),
          assignedByName: '窓口 太郎',
        })
      );

      // The lead views carry the assignee
      const got = await asViewer.leads.get({ organizationId: orgA, id: lead.id });
      expect(got.assignee).toEqual({ id: sales.id, name: '佐藤 花子', email: sales.email });
    });

    it('never assigns a user of another organization (nothing written)', async () => {
      const lead = await insertLead(orgA);
      await expect(
        asAdmin.leads.assign({ organizationId: orgA, id: lead.id, assigneeUserId: outsider.id })
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      const [row] = await pg.select().from(leads).where(eq(leads.id, lead.id));
      expect(row.assigneeUserId).toBeNull();
      expect(await auditRows(lead.id)).toHaveLength(0);
      expect(notifyLeadAssigned).not.toHaveBeenCalled();
    });

    it('does not assign read-only members', async () => {
      const lead = await insertLead(orgA);
      await expect(
        asAdmin.leads.assign({ organizationId: orgA, id: lead.id, assigneeUserId: viewer.id })
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    it("does not touch another organization's lead", async () => {
      const lead = await insertLead(orgB);
      await expect(
        asAdmin.leads.assign({ organizationId: orgA, id: lead.id, assigneeUserId: sales.id })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      const [row] = await pg.select().from(leads).where(eq(leads.id, lead.id));
      expect(row.assigneeUserId).toBeNull();
    });

    it('read-only roles cannot assign', async () => {
      const lead = await insertLead(orgA);
      await expect(
        asViewer.leads.assign({ organizationId: orgA, id: lead.id, assigneeUserId: sales.id })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('unassigns, writes nothing when unchanged and does not notify oneself', async () => {
      const lead = await insertLead(orgA, { assigneeUserId: sales.id });
      await asAdmin.leads.assign({ organizationId: orgA, id: lead.id, assigneeUserId: sales.id });
      expect(await auditRows(lead.id)).toHaveLength(0);

      await asAdmin.leads.assign({ organizationId: orgA, id: lead.id, assigneeUserId: null });
      const rows = await auditRows(lead.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].changes).toEqual({
        before: { assignee: '佐藤 花子' },
        after: { assignee: null },
      });

      await asSales.leads.assign({ organizationId: orgA, id: lead.id, assigneeUserId: sales.id });
      expect(notifyLeadAssigned).not.toHaveBeenCalled();
      expect(await auditRows(lead.id)).toHaveLength(2);
    });

    it('shows the change in the activity timeline', async () => {
      const lead = await insertLead(orgA);
      await asAdmin.leads.assign({ organizationId: orgA, id: lead.id, assigneeUserId: sales.id });
      const activity = await asAdmin.leadActivity.list({ organizationId: orgA, leadId: lead.id });
      const changes = JSON.stringify(activity);
      expect(changes).toContain('"field":"assignee"');
      expect(changes).toContain('佐藤 花子');
    });
  });

  describe('leads.list', () => {
    let mine: string;
    let theirs: string;
    let nobody: string;
    let otherOrg: string;

    beforeAll(async () => {
      mine = (await insertLead(orgA, { name: 'list-mine', assigneeUserId: admin.id })).id;
      theirs = (await insertLead(orgA, { name: 'list-theirs', assigneeUserId: sales.id })).id;
      nobody = (await insertLead(orgA, { name: 'list-nobody' })).id;
      // Another organization's lead assigned to its own member, and one with nobody
      otherOrg = (await insertLead(orgB, { name: 'list-other', assigneeUserId: outsider.id })).id;
      await insertLead(orgB, { name: 'list-other-nobody' });
    });

    const ids = async (input: Record<string, unknown>, caller = asAdmin) => {
      const result = await caller.leads.list({
        organizationId: orgA,
        search: 'list-',
        limit: 100,
        ...input,
      });
      return result.items.map((item: { id: string }) => item.id);
    };

    it("filters 'me' (the member asking)", async () => {
      expect(await ids({ assignee: 'me' })).toEqual([mine]);
      expect(await ids({ assignee: 'me' }, asSales)).toEqual([theirs]);
    });

    it("filters 'unassigned' within the organization", async () => {
      expect(await ids({ assignee: 'unassigned' })).toEqual([nobody]);
    });

    it('filters one member, and finds nothing for a user of another organization', async () => {
      expect(await ids({ assignee: sales.id })).toEqual([theirs]);
      const other = await ids({ assignee: outsider.id });
      expect(other).toEqual([]);
      expect(other).not.toContain(otherOrg);
    });

    it('returns the assignee with each row and sorts by name, nobody last', async () => {
      const result = await asAdmin.leads.list({
        organizationId: orgA,
        search: 'list-',
        sortBy: 'assignee',
        sortOrder: 'asc',
      });
      // 佐藤 花子 < 窓口 太郎 in code point order; nobody last
      expect(result.items.map((item: { id: string }) => item.id)).toEqual([theirs, mine, nobody]);
      expect(result.items[0].assignee).toEqual({ id: sales.id, name: '佐藤 花子', email: sales.email });
      expect(result.items[2].assignee).toBeNull();
    });
  });

  describe('intake (窓口)', () => {
    it('lets admins choose members of the organization only, keeping other settings', async () => {
      await expect(
        asAdmin.leads.setIntake({ organizationId: orgA, userIds: [outsider.id] })
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(
        asSales.leads.setIntake({ organizationId: orgA, userIds: [sales.id] })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      await asAdmin.leads.setIntake({ organizationId: orgA, userIds: [admin.id] });
      const [org] = await pg.select().from(organizations).where(eq(organizations.id, orgA));
      expect(org.settings).toEqual({ keep: 'me', leadIntakeUserIds: [admin.id] });
      expect(await asSales.leads.intake({ organizationId: orgA })).toEqual({
        userIds: [admin.id],
        canEdit: false,
      });
      const [audit] = await pg
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.resource, 'organization'), eq(auditLogs.resourceId, orgA)));
      expect(audit.changes).toEqual({
        before: { leadIntakeUserIds: [] },
        after: { leadIntakeUserIds: [admin.id] },
      });
    });

    it('mails consultation requests to the intake, else to the sales addresses', async () => {
      await asAdmin.leads.setIntake({ organizationId: orgA, userIds: [admin.id, sales.id] });
      expect(await consultationRecipients(pg, orgA, 'sales@example.jp')).toEqual({
        intakeUserIds: [admin.id, sales.id],
        emails: [admin.email, sales.email],
      });
      // Organization B has no intake: every member in-app, the sales addresses by email
      expect(await consultationRecipients(pg, orgB, 'sales@example.jp, x@example.jp')).toEqual({
        intakeUserIds: [],
        emails: ['sales@example.jp', 'x@example.jp'],
      });
    });

    it('skips intake members who left the organization', async () => {
      const leaving = await createMember(orgA, 'member', '退職 予定');
      await asAdmin.leads.setIntake({ organizationId: orgA, userIds: [leaving.id] });
      await pg
        .delete(organizationMembers)
        .where(
          and(eq(organizationMembers.organizationId, orgA), eq(organizationMembers.userId, leaving.id))
        );
      expect(await listIntakeMembers(pg, orgA)).toEqual([]);
      expect(await consultationRecipients(pg, orgA, 'sales@example.jp')).toEqual({
        intakeUserIds: [],
        emails: ['sales@example.jp'],
      });
      await asAdmin.leads.setIntake({ organizationId: orgA, userIds: [] });
    });
  });

  it('shows the assignee in the dashboard pending list', async () => {
    const org = await createOrganization('担当テストC株式会社');
    const member = await createMember(org, 'admin', '担当 四郎');
    const assigned = await insertLead(org, {
      conversionPoint: 'consultation',
      assigneeUserId: member.id,
    });
    const open = await insertLead(org, { conversionPoint: 'consultation' });
    const summary = await getDashboardSummary(pg, org, 30);
    const byId = new Map(summary.pendingConsultations.map((item) => [item.id, item.assigneeName]));
    expect(byId.get(assigned.id)).toBe('担当 四郎');
    expect(byId.get(open.id)).toBeNull();
  });

  it('clears the assignee when the user is deleted', async () => {
    const org = await createOrganization('担当テストD株式会社');
    const member = await createMember(org, 'member', '削除 五郎');
    const lead = await insertLead(org, { assigneeUserId: member.id });
    await pg.delete(users).where(eq(users.id, member.id));
    const [row] = await pg.select().from(leads).where(eq(leads.id, lead.id));
    expect(row.assigneeUserId).toBeNull();
  });
});
