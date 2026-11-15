/**
 * The marketing room of the office on a real PostgreSQL (#1215): the prospects a row of the
 * source board counts (`analytics.getAcquisitionCost`, last 30 days) and the prospects the lead
 * board lists when that row is opened (`leads.list` with the room's own filters, #1202) are the
 * same leads. Both sides are asked through the router, as the room asks them.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/marketing-room-source-counts.db.test.ts
 */
import {
  MARKETING_RANGE,
  UNSET_SOURCE,
  leadBoardInputFor,
  marketingPeriodFromDay,
  openableSource,
  sourceLeadFilters,
} from '@/components/features/ai-employees/office-marketing';
import * as schema from '@/lib/db/schema';
import { leads, organizationMembers, organizations, users } from '@/lib/db/schema';
import { analyticsPeriodStart } from '@/lib/features/analytics/period';
import type { AcquisitionCostSummary } from '@/lib/features/analytics/types/schemas';
import { jstDayStart } from '@/lib/features/leads/api/list-sql';
import type { InflowSource } from '@/lib/features/leads/types/pipeline';
import { appRouter } from '@/server/routers/_app';
import { inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('source board counts and the lead board opened from a row (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organizationIds: string[] = [];
  const userIds: string[] = [];
  let orgId: string;
  let otherOrgId: string;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let caller: any;

  // The room fixes its clock when it opens; the analytics API takes no "now" and reads its own.
  // Date is fixed to the same instant for both (see beforeEach), so the two periods are the same
  // whenever the test runs, also across midnight in Japan. A Saturday afternoon in Japan:
  const now = new Date('2026-11-14T06:00:00Z');
  // biome-ignore lint/style/noNonNullAssertion: '30d' always has a start
  const from = analyticsPeriodStart(MARKETING_RANGE, now)!;
  const HOUR = 60 * 60 * 1000;

  async function createOrganization(name: string) {
    const [org] = await pg
      .insert(organizations)
      .values({ name, slug: `room-${unique()}` })
      .returning();
    organizationIds.push(org.id);
    return org.id;
  }

  const lead = (
    inflowSource: string | null,
    createdAt: Date,
    organizationId: string = orgId
  ): typeof leads.$inferInsert => ({
    organizationId,
    email: `room-${unique()}@example.com`,
    status: 'new',
    inflowSource,
    createdAt,
  });

  /** Prospects of the period per source, as the source board shows them */
  async function sourceBoard(): Promise<Map<string, number>> {
    const cost: AcquisitionCostSummary = await caller.analytics.getAcquisitionCost({
      organizationId: orgId,
      dateRange: MARKETING_RANGE,
    });
    return new Map(cost.bySource.map((row) => [row.source, row.leadCount]));
  }

  /** How many prospects the lead board lists when the row of a source is opened */
  async function openedFromRow(source: InflowSource): Promise<number> {
    const result = await caller.leads.list(
      leadBoardInputFor(sourceLeadFilters(source, now), 1, orgId)
    );
    return result.total;
  }

  beforeAll(async () => {
    orgId = await createOrganization('部屋の件数');
    otherOrgId = await createOrganization('別の組織');
    const [user] = await pg
      .insert(users)
      .values({ email: `room-${unique()}@example.com`, name: '部屋 太郎' })
      .returning();
    userIds.push(user.id);
    await pg
      .insert(organizationMembers)
      .values({ organizationId: orgId, userId: user.id, role: 'admin' });
    caller = appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId: user.id }, user },
      user,
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);

    await pg.insert(leads).values([
      // Seminars: the very first instant of the period, a moment later, and a little while ago
      lead('seminar', from),
      lead('seminar', new Date(from.getTime() + 1)),
      lead('seminar', new Date(now.getTime() - HOUR)),
      // One millisecond before the period, and long before: counted by neither side
      lead('seminar', new Date(from.getTime() - 1)),
      lead('seminar', new Date(from.getTime() - 40 * 24 * HOUR)),
      // Advertising: two in the period
      lead('advertising', new Date(from.getTime() + HOUR)),
      lead('advertising', new Date(now.getTime() - 2 * HOUR)),
      // Another source with nothing in the period
      lead('lp_organic', new Date(from.getTime() - HOUR)),
      // No source recorded, and a blank one: the row that cannot be opened
      lead(null, new Date(from.getTime() + HOUR)),
      lead('  ', new Date(from.getTime() + HOUR)),
      // A source typed with spaces around it (not possible from the forms, which offer a list)
      lead(' referral_partner ', new Date(from.getTime() + HOUR)),
      // The same sources in another organization
      lead('seminar', new Date(from.getTime() + HOUR), otherOrgId),
      lead('advertising', new Date(from.getTime() + HOUR), otherOrgId),
    ]);
  });

  // Only Date is faked, so the database client's timers keep running
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
  });

  afterEach(() => vi.useRealTimers());

  afterAll(async () => {
    if (organizationIds.length > 0) {
      await pg.delete(organizations).where(inArray(organizations.id, organizationIds));
    }
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  it('starts the lead board at the instant the analytics period starts', () => {
    expect(jstDayStart(marketingPeriodFromDay(now))).toEqual(from);
  });

  it('counts the prospects of the period by source on the source board', async () => {
    const board = await sourceBoard();
    expect(board.get('seminar')).toBe(3);
    expect(board.get('advertising')).toBe(2);
    // Nothing in the period: no row
    expect(board.has('lp_organic')).toBe(false);
    // No source and a blank source are one row, which cannot be opened
    expect(board.get(UNSET_SOURCE)).toBe(2);
    expect(openableSource(UNSET_SOURCE)).toBeNull();
  });

  it('lists as many prospects from a row as the row counts, for every source typed as offered', async () => {
    const board = await sourceBoard();
    expect(await openedFromRow('seminar')).toBe(board.get('seminar'));
    expect(await openedFromRow('advertising')).toBe(board.get('advertising'));
    // A source without a row lists nothing either
    expect(await openedFromRow('lp_organic')).toBe(0);
  });

  it('leaves out the leads of another organization on both sides', async () => {
    // The other organization has a seminar and an advertising lead in the period
    const board = await sourceBoard();
    expect(board.get('seminar')).toBe(3);
    expect(await openedFromRow('seminar')).toBe(3);
    expect(board.get('advertising')).toBe(2);
    expect(await openedFromRow('advertising')).toBe(2);
  });

  // Known difference (#1215): the analytics trim the source before counting, the list compares
  // it as it is stored. A source stored with spaces around it is counted on the board and not
  // listed from its row. The forms offer the sources as a list, so such a value is not written
  // by the app; whether to align the two is left to #1215.
  it('counts a source stored with spaces on the board, and does not list it from the row', async () => {
    const board = await sourceBoard();
    expect(board.get('referral_partner')).toBe(1);
    expect(await openedFromRow('referral_partner')).toBe(0);
  });
});
