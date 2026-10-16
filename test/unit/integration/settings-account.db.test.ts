/**
 * Personal settings (#164) on a real PostgreSQL through the tRPC routers: notification
 * preferences, account deletion (last-owner rule, records kept with a null author, sign-in data
 * gone, audit log) and the header lead search (organization isolation).
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_settings164 \
 *     bunx vitest --run test/unit/integration/settings-account.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import {
  accounts,
  auditLogs,
  leadComments,
  leadHearings,
  leads,
  notificationPreferences,
  organizationMembers,
  organizations,
  scheduledReports,
  sessions,
  users,
  verification,
  workflows,
} from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { hashPassword } from 'better-auth/crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;
type CallerContext = Parameters<typeof appRouter.createCaller>[0];
type TestUser = typeof users.$inferSelect;
const PASSWORD = 'correct-horse-battery';

describe.skipIf(!url)('personal settings (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  const pg = client ? drizzle(client, { schema }) : (null as unknown as ReturnType<typeof drizzle<typeof schema>>);
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const orgIds: string[] = [];
  const userIds: string[] = [];

  const callerFor = (user: TestUser) =>
    appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId: user.id }, user },
      user,
    } as unknown as CallerContext);

  const createUser = async (label: string, withPassword = true) => {
    const [user] = await pg
      .insert(users)
      .values({ email: `settings-${label}-${unique()}@example.com`, name: `Test ${label}` })
      .returning();
    userIds.push(user.id);
    if (withPassword) {
      await pg.insert(accounts).values({
        userId: user.id,
        accountId: user.id,
        providerId: 'credential',
        password: await hashPassword(PASSWORD),
      });
    }
    await pg.insert(sessions).values({
      userId: user.id,
      token: `token-${unique()}`,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    return user;
  };

  const createOrg = async (label: string) => {
    const [org] = await pg
      .insert(organizations)
      .values({ name: `Org ${label}`, slug: `settings-${label}-${unique()}` })
      .returning();
    orgIds.push(org.id);
    return org;
  };

  afterAll(async () => {
    if (userIds.length) await pg.delete(users).where(inArray(users.id, userIds));
    if (orgIds.length) await pg.delete(organizations).where(inArray(organizations.id, orgIds));
    await client?.end();
  });

  describe('notification preferences', () => {
    let member: TestUser;
    let orgId: string;
    let otherOrgId: string;

    beforeAll(async () => {
      member = await createUser('prefs');
      orgId = (await createOrg('prefs')).id;
      otherOrgId = (await createOrg('prefs-other')).id;
      await pg
        .insert(organizationMembers)
        .values({ organizationId: orgId, userId: member.id, role: 'member' });
    });

    it('returns the work notifications on by default and stores a change per user', async () => {
      const prefs = await callerFor(member).notifications.getPreferences({ organizationId: orgId });
      expect(prefs).toMatchObject({
        inAppConsultationRequested: true,
        inAppLeadCreated: true,
        inAppAssignedToMe: true,
        inAppNextActionDue: true,
        inAppHearingNextMeeting: true,
      });

      await callerFor(member).notifications.updatePreferences({
        organizationId: orgId,
        inAppAssignedToMe: false,
        inAppConsultationRequested: false,
      });
      const [row] = await pg
        .select()
        .from(notificationPreferences)
        .where(
          and(
            eq(notificationPreferences.userId, member.id),
            eq(notificationPreferences.organizationId, orgId)
          )
        );
      expect(row).toMatchObject({
        inAppAssignedToMe: false,
        inAppConsultationRequested: false,
        inAppNextActionDue: true,
      });
    });

    it('refuses an organization the user does not belong to', async () => {
      await expect(
        callerFor(member).notifications.getPreferences({ organizationId: otherOrgId })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        callerFor(member).notifications.updatePreferences({
          organizationId: otherOrgId,
          inAppAssignedToMe: false,
        })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      const rows = await pg
        .select()
        .from(notificationPreferences)
        .where(eq(notificationPreferences.organizationId, otherOrgId));
      expect(rows).toHaveLength(0);
    });
  });

  describe('account deletion', () => {
    let owner: TestUser;
    let colleague: TestUser;
    let orgId: string;
    let leadId: string;

    beforeAll(async () => {
      owner = await createUser('owner');
      colleague = await createUser('colleague');
      orgId = (await createOrg('deletion')).id;
      await pg.insert(organizationMembers).values([
        { organizationId: orgId, userId: owner.id, role: 'owner' },
        { organizationId: orgId, userId: colleague.id, role: 'member' },
      ]);
      const [lead] = await pg
        .insert(leads)
        .values({ organizationId: orgId, email: `lead-${unique()}@example.com`, name: 'Lead' })
        .returning();
      leadId = lead.id;
      await pg.insert(leadHearings).values({
        organizationId: orgId,
        leadId,
        heldOn: '2026-10-01',
        catalogVersion: 1,
        createdBy: owner.id,
        updatedBy: owner.id,
      });
      await pg
        .insert(leadComments)
        .values({ organizationId: orgId, leadId, userId: owner.id, content: 'Called back' });
      await pg.insert(auditLogs).values({
        organizationId: orgId,
        userId: owner.id,
        action: 'update',
        resource: 'lead',
        resourceId: leadId,
        changes: { before: { status: 'new' }, after: { status: 'nurturing' } },
      });
      await pg
        .insert(workflows)
        .values({ organizationId: orgId, createdById: owner.id, name: 'Flow', trigger: 'manual' });
      await pg.insert(scheduledReports).values({
        organizationId: orgId,
        createdById: owner.id,
        name: 'Weekly',
        recipients: 'sales@example.com',
      });
      await pg.insert(verification).values({
        identifier: `reset-password:${unique()}`,
        value: owner.id,
        expiresAt: new Date(Date.now() + 3_600_000),
      });
    });

    it('blocks the last owner and keeps everything', async () => {
      await expect(callerFor(owner).account.soleOwnedOrganizations()).resolves.toEqual([
        { id: orgId, name: expect.any(String) },
      ]);
      const result = await callerFor(owner).account.delete({
        confirmation: owner.email,
        password: PASSWORD,
      });
      expect(result).toMatchObject({ ok: false, reason: 'sole_owner' });
      const [still] = await pg.select().from(users).where(eq(users.id, owner.id));
      expect(still).toBeDefined();
      const memberships = await pg
        .select()
        .from(organizationMembers)
        .where(eq(organizationMembers.userId, owner.id));
      expect(memberships).toHaveLength(1);
    });

    it('requires the matching email and the current password', async () => {
      await pg
        .update(organizationMembers)
        .set({ role: 'owner' })
        .where(
          and(
            eq(organizationMembers.organizationId, orgId),
            eq(organizationMembers.userId, colleague.id)
          )
        );
      await expect(callerFor(owner).account.soleOwnedOrganizations()).resolves.toEqual([]);

      await expect(
        callerFor(owner).account.delete({ confirmation: 'someone@example.com', password: PASSWORD })
      ).resolves.toEqual({ ok: false, reason: 'confirmation_mismatch' });
      await expect(
        callerFor(owner).account.delete({ confirmation: owner.email })
      ).resolves.toEqual({ ok: false, reason: 'password_required' });
      await expect(
        callerFor(owner).account.delete({ confirmation: owner.email, password: 'wrong-password' })
      ).resolves.toEqual({ ok: false, reason: 'invalid_password' });
      const [still] = await pg.select().from(users).where(eq(users.id, owner.id));
      expect(still).toBeDefined();
    });

    it('deletes the personal data and keeps the organization records with a null author', async () => {
      const result = await callerFor(owner).account.delete({
        confirmation: ` ${owner.email.toUpperCase()} `,
        password: PASSWORD,
      });
      expect(result).toEqual({ ok: true });

      expect(await pg.select().from(users).where(eq(users.id, owner.id))).toHaveLength(0);
      expect(await pg.select().from(sessions).where(eq(sessions.userId, owner.id))).toHaveLength(0);
      expect(await pg.select().from(accounts).where(eq(accounts.userId, owner.id))).toHaveLength(
        0
      );
      expect(
        await pg.select().from(organizationMembers).where(eq(organizationMembers.userId, owner.id))
      ).toHaveLength(0);
      expect(
        await pg.select().from(verification).where(eq(verification.value, owner.id))
      ).toHaveLength(0);

      // Organization records stay, the author becomes null
      const [lead] = await pg.select().from(leads).where(eq(leads.id, leadId));
      expect(lead).toBeDefined();
      const [hearing] = await pg.select().from(leadHearings).where(eq(leadHearings.leadId, leadId));
      expect(hearing).toMatchObject({ createdBy: null, updatedBy: null });
      const [comment] = await pg
        .select()
        .from(leadComments)
        .where(eq(leadComments.leadId, leadId));
      expect(comment).toMatchObject({ userId: null, content: 'Called back' });
      const [flow] = await pg.select().from(workflows).where(eq(workflows.organizationId, orgId));
      expect(flow).toMatchObject({ createdById: null });
      const [report] = await pg
        .select()
        .from(scheduledReports)
        .where(eq(scheduledReports.organizationId, orgId));
      expect(report).toMatchObject({ createdById: null });

      const logs = await pg.select().from(auditLogs).where(eq(auditLogs.organizationId, orgId));
      const leadLog = logs.find((log) => log.resource === 'lead');
      expect(leadLog).toMatchObject({ userId: null, action: 'update' });
      const deletionLog = logs.find((log) => log.resource === 'user');
      expect(deletionLog).toMatchObject({
        userId: null,
        action: 'delete',
        resourceId: owner.id,
        metadata: { reason: 'account_deleted_by_self', role: 'owner' },
      });
      // No personal data in the deletion log
      expect(JSON.stringify(deletionLog)).not.toContain(owner.email);

      // The colleague still sees the organization
      const remaining = await pg
        .select()
        .from(organizationMembers)
        .where(eq(organizationMembers.organizationId, orgId));
      expect(remaining.map((m) => m.userId)).toEqual([colleague.id]);

      // The comment list shows the comment without an author
      const comments = await callerFor(colleague).comments.list({ organizationId: orgId, leadId });
      expect(comments.items).toHaveLength(1);
      expect(comments.items[0].user).toBeNull();

      // The activity history names the author "deleted user" for staff-written rows
      const activity = await callerFor(colleague).leadActivity.list({
        organizationId: orgId,
        leadId,
        limit: 50,
      });
      const deleted = { id: null, name: null, deleted: true };
      const kinds = ['comment', 'hearing_recorded', 'lead_updated'];
      for (const kind of kinds) {
        expect(activity.items.find((event) => event.kind === kind)?.actor).toEqual(deleted);
      }
    });
  });

  describe('header lead search', () => {
    let member: TestUser;
    let orgId: string;
    let otherOrgId: string;

    beforeAll(async () => {
      member = await createUser('search', false);
      orgId = (await createOrg('search')).id;
      otherOrgId = (await createOrg('search-other')).id;
      await pg
        .insert(organizationMembers)
        .values({ organizationId: orgId, userId: member.id, role: 'member' });
      await pg.insert(leads).values([
        { organizationId: orgId, email: 'taro@alpha.example.com', name: 'Taro Yamada', company: 'Alpha Systems' },
        { organizationId: orgId, email: 'hanako@beta.example.com', name: 'Hanako Sato', company: 'Beta 100% Works' },
        { organizationId: orgId, email: 'ken@gamma.example.com', name: null, company: 'Gamma' },
        { organizationId: otherOrgId, email: 'taro@other.example.com', name: 'Taro Other', company: 'Alpha Rival' },
      ]);
    });

    it('matches name, email and company within the organization only', async () => {
      const byName = await callerFor(member).leadSearch.suggest({ organizationId: orgId, query: 'taro' });
      expect(byName.map((l) => l.email)).toEqual(['taro@alpha.example.com']);

      const byEmail = await callerFor(member).leadSearch.suggest({ organizationId: orgId, query: 'gamma.example' });
      expect(byEmail.map((l) => l.email)).toEqual(['ken@gamma.example.com']);

      const byCompany = await callerFor(member).leadSearch.suggest({ organizationId: orgId, query: 'ALPHA' });
      expect(byCompany.map((l) => l.email)).toEqual(['taro@alpha.example.com']);
    });

    it('treats % and _ literally', async () => {
      const percent = await callerFor(member).leadSearch.suggest({ organizationId: orgId, query: '100%' });
      expect(percent.map((l) => l.email)).toEqual(['hanako@beta.example.com']);
      const underscore = await callerFor(member).leadSearch.suggest({ organizationId: orgId, query: '_' });
      expect(underscore).toEqual([]);
    });

    it('refuses another organization', async () => {
      await expect(
        callerFor(member).leadSearch.suggest({ organizationId: otherOrgId, query: 'taro' })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });
});
