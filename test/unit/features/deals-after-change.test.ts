/**
 * After the commit of deal changes (lib/features/deals/service.ts): the webhooks of every lead
 * that changed go out in one call, as an import that creates several deals needs (#854), and each
 * lead handed off for the first time gets its handoff notice (#86). Without a database: the lead
 * moves are made up, the webhooks and the notice are mocked. How a real change gets there is
 * covered by test/unit/integration/deals.db.test.ts and deals-auto-qualification.db.test.ts.
 */
import type { Lead } from '@/lib/db/schema';
import { afterDealChange, afterDealChanges } from '@/lib/features/deals/service';
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
