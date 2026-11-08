/**
 * 商談が未作成のリード (#854) on a real PostgreSQL: the count of the list page's cards
 * (leads.statusCounts' missingDeal) and the list filter missingDeal (and the export with it) find
 * the same leads: no deal at all, and 商談中 or 成約, or 新規 with a deal phase. 失注 and
 * ナーチャリング are left out, and so is a lead with any deal of its organization. Never another
 * organization's leads or deals, and nothing for those who may not read deals (#448).
 * Every row is made up and belongs to the organizations this file creates, since the DB tests
 * run side by side on one database.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/diagnoleads_test \
 *     bunx vitest --run test/unit/integration/leads-missing-deal.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import { auditLogs, deals, leads, organizationMembers, organizations, users } from '@/lib/db/schema';
import { appRouter } from '@/server/routers/_app';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

/** The leads of organization A in a deal by hand that have no deal */
const MISSING = ['negotiating', 'won', 'new-phase', 'new-won-phase', 'other-org-deal'];

describe.skipIf(!url)('leads missing a deal (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organizationIds: string[] = [];
  const userIds: string[] = [];
  const labelOf = new Map<string, string>();
  let orgA: string;
  let orgB: string;
  let otherOrgLeadId: string;
  let adminAId: string;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
  let adminA: any;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
  let memberA: any;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
  let viewerA: any;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
  let adminB: any;

  async function createOrganization(name: string) {
    const [org] = await pg
      .insert(organizations)
      .values({ name, slug: `missing-deal-${unique()}` })
      .returning();
    organizationIds.push(org.id);
    return org.id;
  }

  async function callerFor(organizationId: string, role: schema.OrganizationRole) {
    const [user] = await pg
      .insert(users)
      .values({ email: `missing-deal-${unique()}@example.com`, name: '商談 確認' })
      .returning();
    userIds.push(user.id);
    await pg.insert(organizationMembers).values({ organizationId, userId: user.id, role });
    const caller = appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId: user.id }, user },
      user,
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);
    return { caller, userId: user.id };
  }

  async function insertLead(
    organizationId: string,
    label: string,
    values: Partial<typeof leads.$inferInsert>
  ) {
    const [row] = await pg
      .insert(leads)
      .values({
        organizationId,
        email: `${label}-${unique()}@example.com`,
        company: '架空工業',
        ...values,
      })
      .returning();
    labelOf.set(row.id, label);
    return row;
  }

  /** A deal row as it is stored; written directly so the lead keeps its hand-set values */
  async function insertDeal(organizationId: string, leadId: string, stage: string) {
    await pg.insert(deals).values({
      organizationId,
      leadId,
      name: '現行調査',
      stage,
      ...(stage === 'lost' ? { closedOn: '2026-10-20', lostReason: 'timing' } : {}),
      ...(stage === 'won' ? { closedOn: '2026-10-20' } : {}),
    });
  }

  const labels = (items: { id: string }[]) =>
    items.map((item) => labelOf.get(item.id) ?? item.id).sort();

  beforeAll(async () => {
    orgA = await createOrganization('商談記録テストA');
    orgB = await createOrganization('商談記録テストB');
    ({ caller: adminA, userId: adminAId } = await callerFor(orgA, 'admin'));
    ({ caller: memberA } = await callerFor(orgA, 'member'));
    ({ caller: viewerA } = await callerFor(orgA, 'parent_viewer'));
    ({ caller: adminB } = await callerFor(orgB, 'admin'));

    // In a deal by hand, without any deal: counted
    await insertLead(orgA, 'negotiating', { status: 'negotiating' });
    await insertLead(orgA, 'won', { status: 'won', dealPhase: 'survey_won' });
    await insertLead(orgA, 'new-phase', { status: 'new', dealPhase: 'initial_hearing' });
    await insertLead(orgA, 'new-won-phase', { status: 'new', dealPhase: 'survey_won' });
    // Not in a deal: not counted
    await insertLead(orgA, 'new', { status: 'new' });
    await insertLead(orgA, 'nurturing-phase', { status: 'nurturing', dealPhase: 'simple_diagnosis' });
    await insertLead(orgA, 'lost-phase', { status: 'lost', dealPhase: 'proposal' });
    // Any deal of the lead's organization, open, won or lost: not counted
    const withOpenDeal = await insertLead(orgA, 'open-deal', {
      status: 'negotiating',
      dealPhase: 'initial_hearing',
    });
    await insertDeal(orgA, withOpenDeal.id, 'qualification');
    const withWonDeal = await insertLead(orgA, 'won-deal', { status: 'won', dealPhase: 'survey_won' });
    await insertDeal(orgA, withWonDeal.id, 'won');
    const withLostDeal = await insertLead(orgA, 'lost-deal', { status: 'new', dealPhase: 'proposal' });
    await insertDeal(orgA, withLostDeal.id, 'lost');
    // A deal row of another organization is not this lead's deal: counted
    const otherOrgDeal = await insertLead(orgA, 'other-org-deal', { status: 'negotiating' });
    await insertDeal(orgB, otherOrgDeal.id, 'qualification');

    // Another organization's lead in a deal without any deal
    const other = await insertLead(orgB, 'org-b-negotiating', { status: 'negotiating' });
    otherOrgLeadId = other.id;
  });

  afterAll(async () => {
    if (organizationIds.length > 0) {
      await pg.delete(organizations).where(inArray(organizations.id, organizationIds));
    }
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  it('counts exactly the leads the list filter shows', async () => {
    const counts = await adminA.leads.statusCounts({ organizationId: orgA });
    const list = await adminA.leads.list({ organizationId: orgA, missingDeal: true, limit: 100 });

    expect(labels(list.items)).toEqual([...MISSING].sort());
    expect(list.total).toBe(MISSING.length);
    expect(counts.missingDeal).toBe(list.total);
    // The status cards count the whole organization as before
    expect(counts.total).toBe(11);
  });

  it('filters nothing with false, and combines with the other filters', async () => {
    const all = await adminA.leads.list({ organizationId: orgA, missingDeal: false, limit: 100 });
    expect(all.total).toBe(11);
    const won = await adminA.leads.list({
      organizationId: orgA,
      missingDeal: true,
      status: ['won'],
    });
    expect(labels(won.items)).toEqual(['won']);
  });

  it('exports the same leads and records the filter in the audit row', async () => {
    const result = await adminA.leads.export({
      organizationId: orgA,
      format: 'json',
      missingDeal: true,
    });
    expect(result).toMatchObject({ rowCount: MISSING.length, total: MISSING.length });
    expect(labels(JSON.parse(result.content))).toEqual([...MISSING].sort());

    const [log] = await pg
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.organizationId, orgA),
          eq(auditLogs.userId, adminAId),
          eq(auditLogs.action, 'export')
        )
      );
    expect(log.metadata).toMatchObject({ filters: { missingDeal: true } });
  });

  it('never counts or lists another organization’s leads', async () => {
    const counts = await adminB.leads.statusCounts({ organizationId: orgB });
    expect(counts.missingDeal).toBe(1);
    const list = await adminB.leads.list({ organizationId: orgB, missingDeal: true });
    expect(list.items.map((item: { id: string }) => item.id)).toEqual([otherOrgLeadId]);

    const listA = await adminA.leads.list({ organizationId: orgA, missingDeal: true, limit: 100 });
    expect(listA.items.map((item: { id: string }) => item.id)).not.toContain(otherOrgLeadId);
  });

  it('gives no count to those who may not read deals and refuses them the filter (#448)', async () => {
    const counts = await viewerA.leads.statusCounts({ organizationId: orgA });
    expect(counts).toMatchObject({ total: 11, missingDeal: null });
    await expect(
      viewerA.leads.list({ organizationId: orgA, missingDeal: true })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      viewerA.leads.export({ organizationId: orgA, format: 'csv', missingDeal: true })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // The list itself stays theirs to read
    const list = await viewerA.leads.list({ organizationId: orgA, limit: 100 });
    expect(list.total).toBe(11);

    // A member may read deals
    const member = await memberA.leads.statusCounts({ organizationId: orgA });
    expect(member.missingDeal).toBe(MISSING.length);
  });
});
