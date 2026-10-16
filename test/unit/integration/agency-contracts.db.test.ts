/**
 * Agency contracts (#148) on a real PostgreSQL: who may manage them, overlapping terms, and the
 * report counting leads by the Japan day they were created. All names and fees are made up.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/agency-contracts.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import { leads, organizationMembers, organizations, users } from '@/lib/db/schema';
import { getAgencyContractReport } from '@/lib/features/agency-contracts/service';
import { appRouter } from '@/server/routers/_app';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('agency contracts (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const db = pg as unknown as Parameters<typeof getAgencyContractReport>[0];
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const orgIds: string[] = [];
  let organizationId: string;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC callers
  const callers: Record<'admin' | 'member', any> = {} as never;

  const terms = (values: Record<string, unknown>) => ({
    agencyName: '契約テスト代行',
    startsOn: '2026-10-01',
    endsOn: '2026-10-31',
    initialFee: 100_000,
    monthlyFee: 0,
    prepayment: 0,
    feePerAppointment: 20_000,
    planAppointments: null,
    planCostPerAppointment: null,
    note: '',
    ...values,
  });

  beforeAll(async () => {
    for (const name of ['契約テスト', '契約テスト別組織']) {
      const [org] = await pg
        .insert(organizations)
        .values({ name, slug: `contracts-${unique()}` })
        .returning();
      orgIds.push(org.id);
    }
    organizationId = orgIds[0];
    for (const role of ['admin', 'member'] as const) {
      const [user] = await pg
        .insert(users)
        .values({ email: `contracts-${role}-${unique()}@example.com`, name: role })
        .returning();
      await pg.insert(organizationMembers).values({ organizationId, userId: user.id, role });
      callers[role] = appRouter.createCaller({
        db: pg,
        session: { session: { id: 's', userId: user.id }, user },
        user,
        // biome-ignore lint/suspicious/noExplicitAny: test context
      } as any);
    }
  });

  afterAll(async () => {
    for (const id of orgIds) await pg.delete(organizations).where(eq(organizations.id, id));
    await client?.end();
  });

  it('lets an admin register contracts and refuses an overlapping term of the same agency', async () => {
    const first = await callers.admin.agencyContracts.create({
      organizationId,
      contract: terms({}),
    });
    expect(first.id).toBeTruthy();

    await expect(
      callers.admin.agencyContracts.create({
        organizationId,
        contract: terms({ startsOn: '2026-10-31', endsOn: null }),
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    // The next day is fine, and so is the same term for another agency
    await callers.admin.agencyContracts.create({
      organizationId,
      contract: terms({ startsOn: '2026-11-01', endsOn: null, initialFee: 0, monthlyFee: 50_000, feePerAppointment: 0 }),
    });
    await callers.admin.agencyContracts.create({
      organizationId,
      contract: terms({ agencyName: '別の代行' }),
    });

    const listed = await callers.admin.agencyContracts.list({ organizationId });
    expect(listed.map((c: { agencyName: string; startsOn: string }) => `${c.agencyName}:${c.startsOn}`)).toEqual([
      '別の代行:2026-10-01',
      '契約テスト代行:2026-10-01',
      '契約テスト代行:2026-11-01',
    ]);
  });

  it('keeps the fees from members, but shows them the report', async () => {
    await expect(callers.member.agencyContracts.list({ organizationId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      callers.member.agencyContracts.create({ organizationId, contract: terms({ agencyName: 'X' }) })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const report = await callers.member.agencyContracts.report({ organizationId });
    expect(report.canManage).toBe(false);
  });

  it('counts a lead by the Japan day it was created', async () => {
    await pg.insert(leads).values([
      // 2026-10-31 23:30 JST = 14:30 UTC: still the October contract
      {
        organizationId,
        email: `c1-${unique()}@example.com`,
        agencyName: '契約テスト代行',
        sqlDecision: 'qualified',
        createdAt: new Date('2026-10-31T14:30:00Z'),
      },
      // 2026-11-01 00:30 JST = 2026-10-31 15:30 UTC: the November contract
      {
        organizationId,
        email: `c2-${unique()}@example.com`,
        agencyName: ' 契約テスト代行 ',
        hasNegotiated: true,
        createdAt: new Date('2026-10-31T15:30:00Z'),
      },
      // Before every contract: no contract, no cost
      {
        organizationId,
        email: `c3-${unique()}@example.com`,
        agencyName: '契約テスト代行',
        createdAt: new Date('2026-09-15T03:00:00Z'),
      },
    ]);
    // Another organization's lead with the same agency never counts
    await pg.insert(leads).values({
      organizationId: orgIds[1],
      email: `c4-${unique()}@example.com`,
      agencyName: '契約テスト代行',
      createdAt: new Date('2026-10-10T03:00:00Z'),
    });

    const report = await getAgencyContractReport(db, organizationId, new Date('2026-12-15T03:00:00Z'));
    const byStart = (start: string) =>
      report.contracts.find(
        (row) => row.contract.agencyName === '契約テスト代行' && row.contract.startsOn === start
      );
    expect(byStart('2026-10-01')).toMatchObject({
      funnel: { appointments: 1, sqls: 1 },
      // 100,000 + 20,000 × 1
      totalCost: 120_000,
    });
    expect(byStart('2026-11-01')).toMatchObject({
      funnel: { appointments: 1, meetings: 1 },
      // 50,000 × 2 months (Nov, Dec)
      months: 2,
      totalCost: 100_000,
    });
    expect(report.uncontracted).toEqual([
      {
        agencyName: '契約テスト代行',
        funnel: { appointments: 1, meetings: 0, sqls: 0, phase1Won: 0, migrationWon: 0 },
      },
    ]);
  });

  it('updates and removes only contracts of the caller organization', async () => {
    const [other] = await pg
      .insert(schema.agencyContracts)
      .values({ organizationId: orgIds[1], agencyName: '別組織の代行', startsOn: '2026-10-01' })
      .returning();
    await expect(
      callers.admin.agencyContracts.update({ organizationId, id: other.id, contract: terms({ agencyName: '乗っ取り' }) })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      callers.admin.agencyContracts.remove({ organizationId, id: other.id })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const listed = await callers.admin.agencyContracts.list({ organizationId });
    const target = listed.find((c: { agencyName: string }) => c.agencyName === '別の代行');
    await callers.admin.agencyContracts.update({
      organizationId,
      id: target.id,
      contract: terms({ agencyName: '別の代行', planAppointments: 5, note: '  ' }),
    });
    const after = await callers.admin.agencyContracts.list({ organizationId });
    expect(after.find((c: { id: string }) => c.id === target.id)).toMatchObject({
      planAppointments: 5,
      note: null,
    });
    await callers.admin.agencyContracts.remove({ organizationId, id: target.id });
    expect(
      (await callers.admin.agencyContracts.list({ organizationId })).some(
        (c: { id: string }) => c.id === target.id
      )
    ).toBe(false);
  });
});
