/**
 * The deals service without a database (lib/features/deals/service.ts):
 * - after the commit of deal changes, the webhooks of every lead that changed go out in one call,
 *   as an import that creates several deals needs (#854), and each lead handed off for the first
 *   time gets its handoff notice (#86). The lead moves are made up, the webhooks and the notice
 *   are mocked
 * - ensureQualificationDeal takes only a calendar day as the meeting day (#854): another value is
 *   a mistake of its caller and throws before anything is read or written
 * How real changes get there is covered by test/unit/integration/deals.db.test.ts and
 * deals-auto-qualification.db.test.ts.
 */
import type { Lead } from '@/lib/db/schema';
import {
  afterDealChange,
  afterDealChanges,
  ensureQualificationDeal,
} from '@/lib/features/deals/service';
import { sqlOf } from '@/test/mocks/recording-db';
import type { SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sent = vi.hoisted(() => ({ emitLeadEvents: vi.fn(), notifyLeadHandoff: vi.fn() }));
vi.mock('@/lib/features/webhooks/services/lead-events', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  emitLeadEvents: sent.emitLeadEvents,
}));
vi.mock('@/lib/features/lead-handoff/notify', () => ({
  notifyLeadHandoff: sent.notifyLeadHandoff,
}));

type Database = Parameters<typeof afterDealChanges>[0];

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '770e8400-e29b-41d4-a716-446655440000';
const db = { name: 'database' } as unknown as Database;
const context = { organizationId: ORG_ID, userId: USER_ID };

/** A lead row with the columns the webhooks send */
const leadRow = (id: string, values: Partial<Lead> = {}): Lead =>
  ({
    id,
    email: `${id}@example.com`,
    name: '山田 花子',
    company: '架空商事',
    phone: null,
    status: 'new',
    score: null,
    source: null,
    inflowSource: null,
    conversionPoint: null,
    dealPhase: null,
    targetSystem: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    ...values,
  }) as Lead;

const entered = {
  before: leadRow('lead-1'),
  after: leadRow('lead-1', { status: 'negotiating', dealPhase: 'initial_hearing' }),
  handedOff: false,
};
const handedOff = {
  before: leadRow('lead-2', { status: 'negotiating', dealPhase: 'initial_hearing' }),
  after: leadRow('lead-2', { status: 'negotiating', dealPhase: 'simple_diagnosis' }),
  handedOff: true,
};

beforeEach(() => {
  sent.emitLeadEvents.mockReset();
  sent.notifyLeadHandoff.mockReset();
  sent.notifyLeadHandoff.mockResolvedValue({ notified: 1 });
});

describe('afterDealChanges', () => {
  it('sends the webhooks of every lead that changed in one call, then the handoff notices', async () => {
    await afterDealChanges(db, context, [{ lead: entered }, { lead: null }, { lead: handedOff }]);

    expect(sent.emitLeadEvents).toHaveBeenCalledTimes(1);
    const [organizationId, events, options] = sent.emitLeadEvents.mock.calls[0];
    expect(organizationId).toBe(ORG_ID);
    expect(options).toEqual({ database: db });
    expect(
      events.map((event: { type: string; lead: Lead }) => [event.type, event.lead.id])
    ).toEqual([
      ['lead.updated', 'lead-1'],
      ['lead.status_changed', 'lead-1'],
      ['lead.updated', 'lead-2'],
    ]);
    // Only the lead that moved on from the initial hearing for the first time
    expect(sent.notifyLeadHandoff).toHaveBeenCalledTimes(1);
    expect(sent.notifyLeadHandoff).toHaveBeenCalledWith(db, {
      organizationId: ORG_ID,
      leadId: 'lead-2',
      userId: USER_ID,
    });
  });

  it('sends nothing when no lead changed', async () => {
    await afterDealChanges(db, context, []);
    await afterDealChanges(db, context, [{ lead: null }, { lead: null }]);

    expect(sent.emitLeadEvents).not.toHaveBeenCalled();
    expect(sent.notifyLeadHandoff).not.toHaveBeenCalled();
  });
});

describe('afterDealChange', () => {
  it('does the same for one change', async () => {
    await afterDealChange(db, context, { lead: handedOff });

    expect(sent.emitLeadEvents).toHaveBeenCalledTimes(1);
    expect(sent.emitLeadEvents.mock.calls[0][1]).toEqual([
      { type: 'lead.updated', lead: handedOff.after },
    ]);
    expect(sent.notifyLeadHandoff).toHaveBeenCalledTimes(1);

    await afterDealChange(db, context, { lead: null });
    expect(sent.emitLeadEvents).toHaveBeenCalledTimes(1);
  });
});

describe('ensureQualificationDeal: the meeting day', () => {
  type Transaction = Parameters<typeof ensureQualificationDeal>[0];
  /** A transaction that finds no lead: enough to see whether the lead is locked and read */
  const transaction = () => ({
    execute: vi.fn(async (_statement: SQL) => []),
    query: { leads: { findFirst: vi.fn(async () => undefined) } },
  });
  const input = (meetingOn: string) => ({
    organizationId: ORG_ID,
    leadId: LEAD_ID,
    userId: USER_ID,
    source: 'agency_handover' as const,
    meetingOn,
  });

  it.each(['2026-02-30', '2026-13-01', '2026/11/10', '2026-11-10T10:00', '20261110', ''])(
    'refuses %j before it reads or writes anything',
    async (meetingOn) => {
      const tx = transaction();

      await expect(
        ensureQualificationDeal(tx as unknown as Transaction, input(meetingOn))
      ).rejects.toThrow('meetingOn must be a calendar day (YYYY-MM-DD)');
      expect(tx.execute).not.toHaveBeenCalled();
      expect(tx.query.leads.findFirst).not.toHaveBeenCalled();
    }
  );

  it('takes a calendar day and locks the lead first', async () => {
    const tx = transaction();

    expect(await ensureQualificationDeal(tx as unknown as Transaction, input('2028-02-29'))).toEqual(
      { created: false, skipped: 'lead_not_found' }
    );
    expect(tx.execute).toHaveBeenCalledTimes(1);
    const lock = sqlOf(tx.execute.mock.calls[0][0]);
    expect(lock.sql).toMatch(/ for no key update$/);
    expect(lock.params).toEqual([LEAD_ID, ORG_ID]);
    expect(tx.query.leads.findFirst).toHaveBeenCalledTimes(1);
  });
});
