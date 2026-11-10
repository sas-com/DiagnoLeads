/**
 * Importing the agency's appointment report (lib/features/agency-handovers/service.ts, #152)
 * without a database: the leads of the rows to save are locked first, in one statement in the
 * order of their ids and in the organization, before the appointment days saved before are read
 * and the handovers written; which rows set a lead's first meeting and create its deal in 見極め
 * (#854: a new appointment day or another day than before, not the same day again nor a row
 * without one), all of them in one call in the import's transaction, the webhooks after the
 * commit, and the deals counted in the answer; a row without an appointment day keeps the day
 * saved before, and every row of a lead deleted meanwhile is reported. The database is
 * test/mocks/recording-db.ts and the
 * deals feature is mocked; the same on a real PostgreSQL is covered by
 * test/unit/integration/agency-handovers.db.test.ts and deals-auto-qualification.db.test.ts.
 * Made-up values.
 */
import { agencyHandovers, leads } from '@/lib/db/schema';
import { importHandovers } from '@/lib/features/agency-handovers/service';
import { HANDOVER_LIMITS } from '@/lib/features/agency-handovers/types/schemas';
import type { QualificationDealOutcome } from '@/lib/features/deals/service';
import { QUALIFICATION_DEALS_MAX } from '@/lib/features/deals/types/pipeline';
import {
  type RecordingDb,
  type RecordingExecutor,
  recordingDb,
  sqlOf,
} from '@/test/mocks/recording-db';
import type { SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const deals = vi.hoisted(() => ({
  ensureQualificationDeals: vi.fn(),
  afterDealChanges: vi.fn(),
}));
vi.mock('@/lib/features/deals/service', () => deals);

type Database = Parameters<typeof importHandovers>[0];

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
// Ids in the order the leads are locked
const LEAD_A = '770e8400-e29b-41d4-a716-44665544000a';
const LEAD_B = '770e8400-e29b-41d4-a716-44665544000b';
const LEAD_C = '770e8400-e29b-41d4-a716-44665544000c';
const LEAD_D = '770e8400-e29b-41d4-a716-44665544000d';
const NOW = new Date('2026-11-08T03:00:00Z');

const createdA: QualificationDealOutcome = { created: true, dealId: 'deal-a', lead: null };

let fake: RecordingDb;
const db = () => fake.db as unknown as Database;
const input = (rows: unknown[]) => ({ organizationId: ORG_ID, userId: USER_ID, rows });
const writes = () => fake.calls.filter((call) => call.op !== 'select');

beforeEach(() => {
  fake = recordingDb();
  deals.ensureQualificationDeals.mockReset().mockResolvedValue([]);
  deals.afterDealChanges.mockReset().mockResolvedValue(undefined);
});

describe('importHandovers: the deals of the first meetings (#854)', () => {
  it('locks the leads first, reads the days saved before, and creates the deals of new or changed days in one call', async () => {
    fake.results.push(
      // The leads found by email address, out of the order of their ids
      [
        { id: LEAD_C, email: 'c@example.co.jp' },
        { id: LEAD_A, email: 'a@example.co.jp' },
        { id: LEAD_B, email: 'b@example.co.jp' },
        { id: LEAD_D, email: 'd@example.co.jp' },
      ],
      // The lock
      [{ id: LEAD_A }, { id: LEAD_B }, { id: LEAD_C }, { id: LEAD_D }],
      // The days saved before: B the same day, C another day, D one without a day this time
      [
        { leadId: LEAD_B, appointmentOn: '2026-11-06' },
        { leadId: LEAD_C, appointmentOn: '2026-11-01' },
        { leadId: LEAD_D, appointmentOn: '2026-10-30' },
      ],
      [{ id: 'handover-c' }],
      [{ id: 'handover-a' }],
      [{ id: 'handover-b' }],
      [{ id: 'handover-d' }]
    );
    const order: string[] = [];
    const transaction = fake.db.transaction;
    fake.db.transaction = async <T>(fn: (tx: RecordingExecutor) => Promise<T>) => {
      const result = await transaction(fn);
      order.push('commit');
      return result;
    };
    deals.ensureQualificationDeals.mockImplementation(async () => {
      order.push('deals');
      return [createdA, { created: false, skipped: 'open_deal' }];
    });
    deals.afterDealChanges.mockImplementation(async () => {
      order.push('webhooks');
    });

    const outcome = await importHandovers(
      db(),
      input([
        { email: 'c@example.co.jp', appointmentOn: '2026-11-07' },
        { email: 'a@example.co.jp', appointmentOn: '2026-11-05' },
        { email: 'b@example.co.jp', appointmentOn: '2026-11-06' },
        { email: 'd@example.co.jp', machineModel: 'IBM Power 9' },
      ]),
      NOW
    );

    expect(outcome).toEqual({
      results: [
        { index: 0, status: 'saved', leadId: LEAD_C },
        { index: 1, status: 'saved', leadId: LEAD_A },
        { index: 2, status: 'saved', leadId: LEAD_B },
        { index: 3, status: 'saved', leadId: LEAD_D },
      ],
      dealsCreated: 1,
    });

    const [, lock, before, ...upserts] = fake.calls;
    // The leads before their handovers, in one statement in the order of their ids
    expect(lock).toMatchObject({ op: 'select', table: leads, inTransaction: true });
    expect(lock.lock).toEqual({ strength: 'no key update', config: undefined });
    expect(sqlOf(lock.where)).toEqual({
      sql: '("leads"."organization_id" = $1 and "leads"."id" in ($2, $3, $4, $5))',
      params: [ORG_ID, LEAD_C, LEAD_A, LEAD_B, LEAD_D],
    });
    expect(lock.orderBy?.map((column) => sqlOf(column as SQL).sql)).toEqual([
      '"leads"."id" asc',
    ]);
    // Then the days saved before, under the lock and in the organization
    expect(before).toMatchObject({ op: 'select', table: agencyHandovers, inTransaction: true });
    expect(sqlOf(before.where)).toEqual({
      sql: '("agency_handovers"."organization_id" = $1 and "agency_handovers"."lead_id" in ($2, $3, $4, $5))',
      params: [ORG_ID, LEAD_A, LEAD_B, LEAD_C, LEAD_D],
    });
    expect(upserts.map((call) => [call.op, call.table, call.inTransaction])).toEqual(
      Array.from({ length: 4 }, () => ['insert', agencyHandovers, true])
    );

    // One call for the leads whose day is new (A) or another day (C), in the transaction
    expect(order).toEqual(['deals', 'commit', 'webhooks']);
    expect(deals.ensureQualificationDeals).toHaveBeenCalledTimes(1);
    const [tx, values, at] = deals.ensureQualificationDeals.mock.calls[0];
    expect(tx).not.toBe(fake.db);
    expect(values).toEqual({
      organizationId: ORG_ID,
      userId: USER_ID,
      source: 'agency_handover',
      meetings: [
        { leadId: LEAD_C, meetingOn: '2026-11-07' },
        { leadId: LEAD_A, meetingOn: '2026-11-05' },
      ],
    });
    expect(at).toBe(NOW);
    // The webhooks of the deals created only, in one call
    expect(deals.afterDealChanges).toHaveBeenCalledTimes(1);
    expect(deals.afterDealChanges).toHaveBeenCalledWith(
      fake.db,
      { organizationId: ORG_ID, userId: USER_ID },
      [createdA]
    );
  });

  it('keeps the appointment day saved before when a later row leaves it empty, and replaces it with a day', async () => {
    fake.results.push(
      [
        { id: LEAD_A, email: 'a@example.co.jp' },
        { id: LEAD_B, email: 'b@example.co.jp' },
      ],
      [{ id: LEAD_A }, { id: LEAD_B }],
      [
        { leadId: LEAD_A, appointmentOn: '2026-11-05' },
        { leadId: LEAD_B, appointmentOn: '2026-11-05' },
      ],
      [{ id: 'handover-a' }],
      [{ id: 'handover-b' }]
    );

    await importHandovers(
      db(),
      input([
        // A column not mapped, or a day not read
        { email: 'a@example.co.jp', machineModel: 'IBM Power 10' },
        { email: 'b@example.co.jp', appointmentOn: '2026-11-19' },
      ]),
      NOW
    );

    const [keep, replace] = writes();
    // A new handover takes the row as it is
    expect(keep.values).toMatchObject({ leadId: LEAD_A, appointmentOn: null });
    const keepSet = keep.onConflict?.config?.set as Record<string, unknown>;
    expect(keepSet).toMatchObject({ machineModel: 'IBM Power 10' });
    // The handover saved before keeps its day: the column set to itself
    expect(sqlOf(keepSet.appointmentOn as SQL).sql).toBe('"agency_handovers"."appointment_on"');
    expect((replace.onConflict?.config?.set as Record<string, unknown>).appointmentOn).toBe(
      '2026-11-19'
    );
    // The same day is no new first meeting; another day is
    expect(deals.ensureQualificationDeals.mock.calls[0][1].meetings).toEqual([
      { leadId: LEAD_B, meetingOn: '2026-11-19' },
    ]);
  });

  it('reports every row of a lead deleted since the report was matched, and neither saves nor creates anything for it', async () => {
    fake.results.push(
      [
        { id: LEAD_A, email: 'a@example.co.jp' },
        { id: LEAD_B, email: 'b@example.co.jp' },
      ],
      // B is gone
      [{ id: LEAD_A }],
      [],
      [{ id: 'handover-a' }]
    );

    const outcome = await importHandovers(
      db(),
      input([
        { email: 'a@example.co.jp', appointmentOn: '2026-11-05' },
        { email: 'b@example.co.jp', appointmentOn: '2026-11-04' },
        { email: 'b@example.co.jp', appointmentOn: '2026-11-05' },
      ]),
      NOW
    );

    // B's earlier row was replaced by none: no row of B was saved
    expect(outcome.results).toEqual([
      { index: 0, status: 'saved', leadId: LEAD_A },
      { index: 1, status: 'unmatched' },
      { index: 2, status: 'unmatched' },
    ]);
    expect(writes()).toHaveLength(1);
    expect(sqlOf(fake.calls[2].where).params).toEqual([ORG_ID, LEAD_A]);
    expect(deals.ensureQualificationDeals.mock.calls[0][1].meetings).toEqual([
      { leadId: LEAD_A, meetingOn: '2026-11-05' },
    ]);
  });

  it('reports a handover of another organization as unmatched, every row of it, without a deal', async () => {
    fake.results.push([{ id: LEAD_A, email: 'a@example.co.jp' }], [{ id: LEAD_A }], [], []);

    const outcome = await importHandovers(
      db(),
      input([
        { email: 'a@example.co.jp', appointmentOn: '2026-11-04' },
        { email: 'a@example.co.jp', appointmentOn: '2026-11-05' },
      ]),
      NOW
    );

    expect(outcome).toEqual({
      results: [
        { index: 0, status: 'unmatched' },
        { index: 1, status: 'unmatched' },
      ],
      dealsCreated: 0,
    });
    expect(deals.ensureQualificationDeals.mock.calls[0][1].meetings).toEqual([]);
    expect(deals.afterDealChanges).not.toHaveBeenCalled();
  });

  it('sends no webhooks and counts none when no deal was created', async () => {
    fake.results.push([{ id: LEAD_A, email: 'a@example.co.jp' }], [{ id: LEAD_A }], [], [
      { id: 'handover-a' },
    ]);
    deals.ensureQualificationDeals.mockResolvedValue([{ created: false, skipped: 'won' }]);

    expect(
      await importHandovers(
        db(),
        input([{ email: 'a@example.co.jp', appointmentOn: '2026-11-05' }]),
        NOW
      )
    ).toMatchObject({ dealsCreated: 0 });
    expect(deals.afterDealChanges).not.toHaveBeenCalled();
  });

  it('locks and reads nothing when no row finds a lead', async () => {
    fake.results.push([]);

    expect(
      await importHandovers(db(), input([{ email: 'nobody@example.co.jp' }, { note: 'x' }]), NOW)
    ).toEqual({
      results: [
        { index: 0, status: 'unmatched' },
        { index: 1, status: 'invalid' },
      ],
      dealsCreated: 0,
    });
    expect(fake.calls).toHaveLength(1);
    expect(deals.ensureQualificationDeals.mock.calls[0][1].meetings).toEqual([]);
  });
});

describe('importHandovers: the size of a report', () => {
  it('has no more rows than one call creates deals for', () => {
    expect(HANDOVER_LIMITS.rows).toBeLessThanOrEqual(QUALIFICATION_DEALS_MAX);
  });
});
