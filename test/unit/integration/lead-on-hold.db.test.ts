/**
 * 保留 is not a loss (#445) on a real PostgreSQL: 保留 sent as the reason of a lost lead is
 * refused, a lead on hold that is lost (one at a time or in bulk) drops the reason 保留 with an
 * audit row, and a lead lost on hold before #445 keeps saving. All names are made up.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/lead-on-hold.db.test.ts
 */
import type { Database } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import { auditLogs, leads, organizationMembers, organizations, users } from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('on hold is not lost (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)! as unknown as Database;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let org: string;
  let userId: string;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let caller: any;

  const insertLead = async (values: Partial<typeof leads.$inferInsert>) => {
    const [lead] = await pg
      .insert(leads)
      .values({ organizationId: org, email: `hold-${unique()}@example.co.jp`, company: '架空商事', ...values })
      .returning({ id: leads.id });
    return lead.id;
  };
  const leadOf = async (leadId: string) =>
    (
      await pg
        .select({ status: leads.status, lostReason: leads.lostReason, name: leads.name })
        .from(leads)
        .where(eq(leads.id, leadId))
    )[0];

  beforeAll(async () => {
    const [row] = await pg
      .insert(organizations)
      .values({ name: '保留テスト', slug: `hold-${unique()}` })
      .returning();
    org = row.id;
    const [user] = await pg
      .insert(users)
      .values({ email: `hold-member-${unique()}@example.com`, name: 'member' })
      .returning();
    userId = user.id;
    await pg.insert(organizationMembers).values({ organizationId: org, userId, role: 'member' });
    caller = appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId }, user },
      user,
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);
  });

  afterAll(async () => {
    await pg.delete(organizations).where(eq(organizations.id, org));
    await pg.delete(users).where(inArray(users.id, [userId]));
    await client?.end();
  });

  it('refuses on hold as the reason of a lost lead, and writes nothing', async () => {
    const leadId = await insertLead({ status: 'negotiating' });
    await expect(
      caller.leads.update({ organizationId: org, id: leadId, status: 'lost', lostReason: 'on_hold' })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await leadOf(leadId)).toMatchObject({ status: 'negotiating', lostReason: null });
  });

  it('drops on hold when a lead on hold is lost, with the change in the audit log', async () => {
    const leadId = await insertLead({ status: 'nurturing', lostReason: 'on_hold' });
    await caller.leads.update({ organizationId: org, id: leadId, status: 'lost' });
    expect(await leadOf(leadId)).toMatchObject({ status: 'lost', lostReason: null });

    const [audit] = await pg
      .select({ changes: auditLogs.changes })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, org), eq(auditLogs.resourceId, leadId)));
    expect(audit.changes).toMatchObject({
      before: { status: 'nurturing', lostReason: 'on_hold' },
      after: { status: 'lost', lostReason: null },
    });
  });

  it('drops on hold in bulk only for the leads on hold, and keeps the other reasons', async () => {
    const onHold = await insertLead({ status: 'nurturing', lostReason: 'on_hold' });
    const timing = await insertLead({ status: 'nurturing', lostReason: 'timing' });
    const legacy = await insertLead({ status: 'lost', lostReason: 'on_hold' });
    await caller.leads.bulkUpdateStatus({ organizationId: org, ids: [onHold, timing, legacy], status: 'lost' });

    expect(await leadOf(onHold)).toMatchObject({ status: 'lost', lostReason: null });
    expect(await leadOf(timing)).toMatchObject({ status: 'lost', lostReason: 'timing' });
    // Already lost on hold before #445: left as it was
    expect(await leadOf(legacy)).toMatchObject({ status: 'lost', lostReason: 'on_hold' });

    const [audit] = await pg
      .select({ changes: auditLogs.changes })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, org), eq(auditLogs.resourceId, onHold)));
    expect(audit.changes).toMatchObject({ after: { status: 'lost', lostReason: null } });
  });

  it('keeps saving a lead lost on hold before #445 while it stays so', async () => {
    const leadId = await insertLead({ status: 'lost', lostReason: 'on_hold' });
    await caller.leads.update({ organizationId: org, id: leadId, name: '架空 太郎' });
    expect(await leadOf(leadId)).toEqual({ status: 'lost', lostReason: 'on_hold', name: '架空 太郎' });
  });
});
