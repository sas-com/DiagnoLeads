/**
 * Handoff sheet of the first meeting (#86) on a real PostgreSQL: moving a deal on from the
 * initial hearing tells the chosen recipients once (in-app, and by email with the link only),
 * never the member who moved it, never with what the customer said; the sheet's header; and who
 * may choose the recipients. All names are made up.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/lead-handoff.db.test.ts
 */
import type { Database } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import {
  leadHearings,
  leads,
  notifications,
  organizationMembers,
  organizations,
  users,
} from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));
const email = vi.hoisted(() => ({ sendEmail: vi.fn().mockResolvedValue({ id: 'm' }) }));
vi.mock('@/lib/features/email', () => ({
  isEmailConfigured: () => true,
  sendEmail: email.sendEmail,
}));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('lead handoff (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)! as unknown as Database;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let org: string;
  const userIds: Record<'admin' | 'sales' | 'tech' | 'viewer', string> = {} as never;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
  const callers: Record<'admin' | 'sales' | 'tech' | 'viewer', any> = {} as never;

  beforeAll(async () => {
    const [row] = await pg
      .insert(organizations)
      .values({ name: '引き継ぎテスト', slug: `handoff-${unique()}` })
      .returning();
    org = row.id;
    for (const [key, role, name] of [
      ['admin', 'admin', '管理 一郎'],
      ['sales', 'member', '営業 花子'],
      ['tech', 'member', '技術 次郎'],
      ['viewer', 'parent_viewer', '閲覧 三郎'],
    ] as const) {
      const [user] = await pg
        .insert(users)
        // Company addresses: test mode only mails these
        .values({ email: `handoff-${key}-${unique()}@sas-com.com`, name })
        .returning();
      userIds[key] = user.id;
      await pg.insert(organizationMembers).values({ organizationId: org, userId: user.id, role });
      callers[key] = appRouter.createCaller({
        db: pg,
        session: { session: { id: 's', userId: user.id }, user },
        user,
        // biome-ignore lint/suspicious/noExplicitAny: test context
      } as any);
    }
  });

  afterAll(async () => {
    await pg.delete(organizations).where(eq(organizations.id, org));
    await pg.delete(users).where(inArray(users.id, Object.values(userIds)));
    await client?.end();
  });

  beforeEach(() => email.sendEmail.mockClear());

  const handoffNotices = () =>
    pg
      .select({ userId: notifications.userId, title: notifications.title, message: notifications.message, data: notifications.data })
      .from(notifications)
      .where(and(eq(notifications.organizationId, org), eq(notifications.type, 'lead_handoff')));

  it('lets only owners and admins choose the recipients, from assignable members', async () => {
    await expect(
      callers.sales.leadHandoff.setRecipients({ organizationId: org, userIds: [userIds.tech] })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      callers.admin.leadHandoff.setRecipients({ organizationId: org, userIds: [userIds.viewer] })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await callers.admin.leadHandoff.setRecipients({
      organizationId: org,
      userIds: [userIds.tech, userIds.sales],
    });
    expect(await callers.viewer.leadHandoff.recipients({ organizationId: org })).toEqual({
      userIds: [userIds.tech, userIds.sales],
      canEdit: false,
    });
  });

  it('tells the recipients once when the deal moves on, with the link only', async () => {
    const [lead] = await pg
      .insert(leads)
      .values({ organizationId: org, email: `handoff-${unique()}@example.co.jp`, company: '架空商事', name: '山田 太郎' })
      .returning();
    await pg.insert(leadHearings).values({
      organizationId: org,
      leadId: lead.id,
      heldOn: '2026-10-16',
      catalogVersion: 1,
      fields: { impactIfUnaddressed: { value: '受注が止まる秘密の事情', status: 'done', source: null } },
    });

    // Still the initial hearing: nobody is told
    await callers.sales.leads.update({ organizationId: org, id: lead.id, dealPhase: 'initial_hearing' });
    expect(await handoffNotices()).toEqual([]);

    await callers.sales.leads.update({ organizationId: org, id: lead.id, dealPhase: 'proposal' });
    const notices = await handoffNotices();
    // The tech member only: the sales member moved it
    expect(notices).toEqual([
      expect.objectContaining({
        userId: userIds.tech,
        title: '【引き継ぎ】架空商事 山田 太郎 様 の引き継ぎ書ができました',
        data: { leadId: lead.id },
      }),
    ]);
    expect(notices[0].message).toContain('営業 花子 さんが');
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    const mail = email.sendEmail.mock.calls[0][0];
    expect(mail.text).toContain(`/ja/leads/${lead.id}/handoff`);
    // What the customer said stays in the app
    for (const text of [notices[0].title, notices[0].message, mail.subject, mail.text, mail.html]) {
      expect(text).not.toContain('秘密の事情');
    }

    // Moving on again does not tell anyone again
    await callers.sales.leads.update({ organizationId: org, id: lead.id, dealPhase: 'survey_won' });
    expect(await handoffNotices()).toHaveLength(1);
    expect(email.sendEmail).toHaveBeenCalledTimes(1);

    const sheet = await callers.tech.leadHandoff.get({ organizationId: org, leadId: lead.id });
    expect(sheet).toMatchObject({
      lead: { company: '架空商事', dealPhase: 'survey_won', assigneeName: null },
      latestHearing: { heldOn: '2026-10-16' },
    });
    expect(sheet.lead.handedOffOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('does not reach leads of another organization', async () => {
    const [other] = await pg
      .insert(organizations)
      .values({ name: '別組織', slug: `handoff-other-${unique()}` })
      .returning();
    try {
      const [lead] = await pg
        .insert(leads)
        .values({ organizationId: other.id, email: `handoff-${unique()}@example.co.jp` })
        .returning();
      await expect(
        callers.tech.leadHandoff.get({ organizationId: org, leadId: lead.id })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      await pg.delete(organizations).where(eq(organizations.id, other.id));
    }
  });
});
