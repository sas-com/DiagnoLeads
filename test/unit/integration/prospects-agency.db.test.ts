/**
 * Sales agency calls in the customer search (#161) on a real PostgreSQL: importing a call report
 * (updating the same company and agency, adding the rest), the contact shown only to sales and
 * the row's creator, the re-approach list, overdue without turned-down calls, the lead made from
 * an agency row, and who may write the agency's columns. All names are made up.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/prospects-agency.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import { leads, organizationMembers, organizations, prospects, users } from '@/lib/db/schema';
import { jstDate } from '@/lib/features/leads/types/pipeline';
import { appRouter } from '@/server/routers/_app';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('prospects from sales agency calls (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let organizationId: string;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
  const callers: Record<'sales' | 'member', any> = {} as never;
  const today = jstDate();
  const days = (n: number) =>
    new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    const [org] = await pg
      .insert(organizations)
      .values({ name: '架電テスト', slug: `prospects-agency-${unique()}` })
      .returning();
    organizationId = org.id;
    for (const [key, role] of [
      ['sales', 'admin'],
      ['member', 'member'],
    ] as const) {
      const [user] = await pg
        .insert(users)
        .values({ email: `pa-${key}-${unique()}@example.com`, name: key })
        .returning();
      await pg.insert(organizationMembers).values({ organizationId, userId: user.id, role });
      callers[key] = appRouter.createCaller({
        db: pg,
        session: { session: { id: `s-${key}`, userId: user.id }, user },
        user,
        // biome-ignore lint/suspicious/noExplicitAny: test context
      } as any);
    }
  });

  afterAll(async () => {
    if (organizationId) await pg.delete(organizations).where(eq(organizations.id, organizationId));
    await client?.end();
  });

  const agencyRows = () =>
    pg
      .select()
      .from(prospects)
      .where(and(eq(prospects.organizationId, organizationId), eq(prospects.entry, 'sales_agency')));

  it('imports a call report, updating the same company of the same agency', async () => {
    await expect(
      callers.member.prospects.importCalls({ organizationId, rows: [{ company: '架空工業' }] })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(
      await callers.sales.prospects.importCalls({
        organizationId,
        rows: [
          { company: '架空工業株式会社', agencyName: '架空テレアポ', callResult: 'absent', calledOn: '2026-10-01' },
          { company: '架空物産', agencyName: '架空テレアポ', callResult: 'refused', refusalReason: 'budget', nextActionOn: days(10), contactName: '山田 太郎', contactPhone: '03-0000-0000' },
        ],
      })
    ).toEqual({ added: 2, updated: 0 });

    // Same company written differently, same agency: updated; another agency: a new row
    expect(
      await callers.sales.prospects.importCalls({
        organizationId,
        rows: [
          { company: '（株）架空工業', agencyName: '架空テレアポ', callResult: 'refused', refusalReason: 'priority', nextActionOn: days(90) },
          { company: '架空工業', agencyName: '別の代行', callResult: 'appointment' },
        ],
      })
    ).toEqual({ added: 1, updated: 1 });

    const rows = await agencyRows();
    expect(rows).toHaveLength(3);
    const updated = rows.find((row) => row.agencyName === '架空テレアポ' && row.company === '架空工業株式会社');
    expect(updated).toMatchObject({
      callResult: 'refused',
      refusalReason: 'priority',
      // Kept from the first import: the second did not fill it
      calledOn: '2026-10-01',
      contactedOn: '2026-10-01',
      recorderName: '架空テレアポ',
    });
  });

  it('shows the contact only to sales and the row’s creator', async () => {
    const forMember = await callers.member.prospects.list({ organizationId });
    const forSales = await callers.sales.prospects.list({ organizationId });
    const pick = (list: { prospects: { company: string; contactName: string | null; contactPhone: string | null }[] }) =>
      list.prospects.find((row) => row.company === '架空物産');
    expect(pick(forSales)).toMatchObject({ contactName: '山田 太郎', contactPhone: '03-0000-0000' });
    expect(pick(forMember)).toMatchObject({ contactName: null, contactPhone: null });
  });

  it('lists turned-down calls due soon for re-approach, not as overdue', async () => {
    await callers.sales.prospects.importCalls({
      organizationId,
      rows: [{ company: '架空精機', agencyName: '架空テレアポ', callResult: 'refused', refusalReason: 'risk', nextActionOn: days(-5) }],
    });
    const reapproach = await callers.sales.prospects.list({ organizationId, filter: 'reapproach' });
    expect(reapproach.prospects.map((row: { company: string }) => row.company)).toEqual(['架空精機', '架空物産']);
    const overdue = await callers.sales.prospects.list({ organizationId, filter: 'overdue' });
    expect(overdue.prospects.map((row: { company: string }) => row.company)).not.toContain('架空精機');
    const { summary } = await callers.sales.prospects.summary({ organizationId });
    expect(summary.calls.refusals).toMatchObject({ budget: 1, priority: 1, risk: 1 });
    expect(summary.checks.overdue).toBe(0);
  });

  it('makes a lead counted for the agency, with the contact', async () => {
    const [row] = (await agencyRows()).filter((item) => item.company === '架空物産');
    const { leadId } = await callers.sales.prospects.convertToLead({
      organizationId,
      id: row.id,
      email: `pa-lead-${unique()}@example.co.jp`,
    });
    const [lead] = await pg.select().from(leads).where(eq(leads.id, leadId));
    expect(lead).toMatchObject({
      inflowSource: 'telemarketing_agency',
      agencyName: '架空テレアポ',
      name: '山田 太郎',
      phone: '03-0000-0000',
    });
  });

  it('keeps the agency’s columns to sales', async () => {
    const { id } = await callers.member.prospects.create({
      organizationId,
      contactedOn: today,
      entry: 'sales_agency',
      company: '架空電機',
      agencyName: '書けない',
      contactPhone: '03-1111-1111',
    });
    const [row] = await pg.select().from(prospects).where(eq(prospects.id, id));
    expect(row).toMatchObject({ agencyName: null, contactPhone: null });
  });
});
