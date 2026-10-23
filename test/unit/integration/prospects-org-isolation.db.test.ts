/**
 * Organization isolation of the customer search list (#356) on a real PostgreSQL: a member of
 * organization B, even sales there, never reads, changes, deletes, converts or counts the rows of
 * organization A by passing their ids (or the ids of A's leads and members). All values are
 * fictional.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/prospects-org-isolation.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import type { OrganizationRole } from '@/lib/db/schema';
import {
  leadComments,
  leads,
  organizationMembers,
  organizations,
  prospectMeetingTargets,
  prospects,
  users,
} from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('prospects: organization isolation (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let orgA: string;
  let orgB: string;
  const userIds: Record<string, string> = {};
  // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
  const callers: Record<string, any> = {};
  /** A's rows: a plain one, an agency call, and the lead A already has */
  let rowA: string;
  let agencyRowA: string;
  let leadA: { id: string; email: string };

  const addUser = async (key: string, organizationId: string, role: OrganizationRole) => {
    const [user] = await pg
      .insert(users)
      .values({ email: `prospects-iso-${key}-${unique()}@example.com`, name: `テスト ${key}` })
      .returning();
    await pg.insert(organizationMembers).values({ organizationId, userId: user.id, role });
    userIds[key] = user.id;
    callers[key] = appRouter.createCaller({
      db: pg,
      session: { session: { id: `s-${key}`, userId: user.id }, user },
      user,
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);
  };

  const rowOf = async (id: string) => {
    const [row] = await pg.select().from(prospects).where(eq(prospects.id, id));
    return row;
  };

  beforeAll(async () => {
    const created = await pg
      .insert(organizations)
      .values([
        { name: '切り分けテストA', slug: `prospects-iso-a-${unique()}` },
        { name: '切り分けテストB', slug: `prospects-iso-b-${unique()}` },
      ])
      .returning({ id: organizations.id });
    orgA = created[0].id;
    orgB = created[1].id;
    await addUser('salesA', orgA, 'admin');
    await addUser('salesB', orgB, 'admin');
    await addUser('memberB', orgB, 'member');

    const [lead] = await pg
      .insert(leads)
      .values({ organizationId: orgA, email: `iso-${unique()}@example.co.jp`, name: '架空 一郎' })
      .returning();
    leadA = { id: lead.id, email: lead.email };
    const [row] = await pg
      .insert(prospects)
      .values({
        organizationId: orgA,
        contactedOn: '2026-10-14',
        entry: 'member_network',
        company: '架空切り分け製作所',
        heard: 'A の社員が聞いたこと',
        leadId: lead.id,
        createdBy: userIds.salesA,
        updatedBy: userIds.salesA,
      })
      .returning();
    rowA = row.id;
    const [agencyRow] = await pg
      .insert(prospects)
      .values({
        organizationId: orgA,
        contactedOn: '2026-10-15',
        entry: 'sales_agency',
        company: '架空架電商事',
        agencyName: '架空代行',
        nextStep: 'hand_over',
        createdBy: userIds.salesA,
        updatedBy: userIds.salesA,
      })
      .returning();
    agencyRowA = agencyRow.id;
    await pg
      .insert(prospectMeetingTargets)
      .values({ organizationId: orgA, month: '2026-11-01', meetings: 7, updatedBy: userIds.salesA });
  });

  afterAll(async () => {
    if (orgA) await pg.delete(organizations).where(inArray(organizations.id, [orgA, orgB]));
    const ids = Object.values(userIds);
    if (ids.length > 0) await pg.delete(users).where(inArray(users.id, ids));
    await client?.end();
  });

  it("refuses B's members when they name organization A itself", async () => {
    await expect(callers.salesB.prospects.list({ organizationId: orgA })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it("lists, summarizes and finds none of A's rows (list, summary, similar)", async () => {
    const { prospects: listed } = await callers.salesB.prospects.list({ organizationId: orgB });
    expect(listed.map((row: { id: string }) => row.id)).not.toContain(rowA);
    expect(listed.map((row: { id: string }) => row.id)).not.toContain(agencyRowA);
    for (const filter of ['overdue', 'handed_over', 'reapproach', 'mine'] as const) {
      const { prospects: filtered } = await callers.salesB.prospects.list({
        organizationId: orgB,
        filter,
      });
      expect(filtered).toEqual([]);
    }

    const { summary, targets } = await callers.salesB.prospects.summary({ organizationId: orgB });
    // B has no rows yet: A's two rows and A's target are not counted
    expect(targets).toEqual([]);
    expect(summary.overall).toMatchObject({ total: 0, handOver: 0 });

    // The same company name, and A's row as the one to leave out
    expect(
      await callers.memberB.prospects.similar({
        organizationId: orgB,
        company: '架空切り分け製作所',
        excludeId: agencyRowA,
      })
    ).toEqual([]);
  });

  it("reads nothing of A's lead by its id (forLead)", async () => {
    expect(
      await callers.salesB.prospects.forLead({ organizationId: orgB, leadId: leadA.id })
    ).toEqual([]);
  });

  it("does not change or delete A's rows by their ids (update, delete)", async () => {
    const before = await rowOf(agencyRowA);
    await expect(
      callers.salesB.prospects.update({
        organizationId: orgB,
        id: agencyRowA,
        contactedOn: '2026-10-20',
        entry: 'sales_agency',
        company: '書き換え',
        stage: 'contract',
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      callers.salesB.prospects.delete({ organizationId: orgB, id: agencyRowA })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await rowOf(agencyRowA)).toEqual(before);
  });

  it("does not turn A's row into a lead, nor link B's row to A's lead (convertToLead)", async () => {
    const before = await rowOf(agencyRowA);
    const leadsOf = () =>
      pg.select({ id: leads.id }).from(leads).where(inArray(leads.organizationId, [orgA, orgB]));
    const leadsBefore = await leadsOf();
    await expect(
      callers.salesB.prospects.convertToLead({
        organizationId: orgB,
        id: agencyRowA,
        email: `iso-convert-${unique()}@example.co.jp`,
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await rowOf(agencyRowA)).toEqual(before);
    expect(await leadsOf()).toEqual(leadsBefore);

    // B's own row with the email of A's lead: a new lead in B, never A's lead
    const { id: rowB } = await callers.salesB.prospects.create({
      organizationId: orgB,
      contactedOn: '2026-10-16',
      entry: 'member_network',
      company: '架空切り分け製作所',
    });
    const converted = await callers.salesB.prospects.convertToLead({
      organizationId: orgB,
      id: rowB,
      email: leadA.email,
    });
    expect(converted.linkedExisting).toBe(false);
    expect(converted.leadId).not.toBe(leadA.id);
    const [created] = await pg.select().from(leads).where(eq(leads.id, converted.leadId));
    expect(created.organizationId).toBe(orgB);
    // Nothing was written on A's lead
    expect(await pg.select().from(leadComments).where(eq(leadComments.leadId, leadA.id))).toEqual(
      []
    );
  });

  it("does not take A's member as B's sales person (create, update)", async () => {
    await expect(
      callers.salesB.prospects.create({
        organizationId: orgB,
        contactedOn: '2026-10-16',
        entry: 'member_network',
        company: '架空担当テスト',
        salesUserId: userIds.salesA,
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    const { id } = await callers.salesB.prospects.create({
      organizationId: orgB,
      contactedOn: '2026-10-16',
      entry: 'member_network',
      company: '架空担当テスト',
    });
    await expect(
      callers.salesB.prospects.update({
        organizationId: orgB,
        id,
        contactedOn: '2026-10-16',
        entry: 'member_network',
        company: '架空担当テスト',
        salesUserId: userIds.salesA,
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect((await rowOf(id))?.salesUserId).toBeNull();
  });

  it("adds B's own rows on import, never updating A's row of the same company (importCalls, import)", async () => {
    const before = await rowOf(agencyRowA);
    const result = await callers.salesB.prospects.importCalls({
      organizationId: orgB,
      rows: [{ company: '架空架電商事', agencyName: '架空代行', heard: 'B の代行の報告' }],
    });
    expect(result).toEqual({ added: 1, updated: 0 });
    expect(await rowOf(agencyRowA)).toEqual(before);

    const imported = await callers.salesB.prospects.import({
      organizationId: orgB,
      rows: [{ contactedOn: '2026-10-17', entry: 'member_network', company: '架空架電商事' }],
    });
    expect(imported).toEqual({ imported: 1 });
    const aRows = await pg.select().from(prospects).where(eq(prospects.organizationId, orgA));
    expect(aRows.map((row) => row.id).sort()).toEqual([rowA, agencyRowA].sort());
  });

  it("replaces B's meeting targets only, leaving A's (setMeetingTargets)", async () => {
    await callers.salesB.prospects.setMeetingTargets({
      organizationId: orgB,
      targets: [{ month: '2026-11-01', meetings: 3 }],
    });
    await callers.salesB.prospects.setMeetingTargets({ organizationId: orgB, targets: [] });
    expect(
      await pg
        .select({ month: prospectMeetingTargets.month, meetings: prospectMeetingTargets.meetings })
        .from(prospectMeetingTargets)
        .where(eq(prospectMeetingTargets.organizationId, orgA))
    ).toEqual([{ month: '2026-11-01', meetings: 7 }]);
  });

  it("counts only B's leads on B's referral link (myReferralLink)", async () => {
    const link = await callers.salesB.prospects.myReferralLink({ organizationId: orgB });
    expect(link.leads).toBe(0);
  });
});
