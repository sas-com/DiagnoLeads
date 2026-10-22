/**
 * Lead events for webhooks (#308): only the allowlisted columns leave DiagnoLeads, an update
 * becomes the events of what changed, and one call sends at most LEAD_WEBHOOK_EVENT_LIMIT
 * events. All names are made up.
 */
import type { leads } from '@/lib/db/schema';
import {
  LEAD_WEBHOOK_EVENT_LIMIT,
  LEAD_WEBHOOK_FIELDS,
  type LeadEvent,
  leadChangeEvents,
  leadWebhookData,
  sendLeadEvents,
} from '@/lib/features/webhooks/services/lead-events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { triggerWebhookBatch, reportServerError } = vi.hoisted(() => ({
  triggerWebhookBatch: vi.fn().mockResolvedValue({ sent: 0, failed: 0, queued: 0 }),
  reportServerError: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/features/webhooks/services/webhook-service', () => ({ triggerWebhookBatch }));
vi.mock('@/lib/ops/alert', () => ({ reportServerError }));

type LeadRow = typeof leads.$inferSelect;

/** A full lead row, internal columns included */
function leadRow(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    organizationId: '00000000-0000-4000-8000-0000000000aa',
    email: 'taro@example.com',
    name: '架空 太郎',
    company: '架空商事',
    phone: '000-0000-0000',
    status: 'new',
    score: 40,
    source: 'website',
    inflowSource: 'web_diagnosis',
    conversionPoint: 'diagnosis',
    dealPhase: null,
    targetSystem: 'other',
    referrerName: '紹介 花子',
    lostReason: null,
    agencyName: '架空代理店',
    agencyLinkId: null,
    acquisitionCost: 10000,
    dealPhaseReachedAt: null,
    hasNegotiated: false,
    mqlQualifiedAt: null,
    sqlDecision: null,
    sqlDecidedAt: null,
    actBy: null,
    assigneeUserId: '00000000-0000-4000-8000-0000000000bb',
    responses: { answer: '社外に出さない回答' },
    customFields: { secret: 'x' },
    embedding: null,
    searchVector: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-02T00:00:00Z'),
    ...overrides,
  } as LeadRow;
}

describe('leadWebhookData', () => {
  it('keeps the allowlisted columns only, dates as ISO strings', () => {
    const data = leadWebhookData(leadRow());
    expect(Object.keys(data).sort()).toEqual([...LEAD_WEBHOOK_FIELDS].sort());
    for (const internal of [
      'responses',
      'customFields',
      'referrerName',
      'agencyName',
      'agencyLinkId',
      'acquisitionCost',
      'assigneeUserId',
      'actBy',
      'sqlDecision',
      'embedding',
      'organizationId',
    ]) {
      expect(data).not.toHaveProperty(internal);
    }
    expect(data.createdAt).toBe('2026-10-01T00:00:00.000Z');
  });
});

describe('leadChangeEvents', () => {
  it('is lead.updated for a contact change', () => {
    const events = leadChangeEvents(leadRow(), leadRow({ company: '別の商事' }));
    expect(events.map((e) => e.type)).toEqual(['lead.updated']);
  });

  it('is lead.status_changed with the previous status', () => {
    const events = leadChangeEvents(leadRow(), leadRow({ status: 'negotiating' }));
    expect(events).toEqual([
      expect.objectContaining({ type: 'lead.status_changed', previousStatus: 'new' }),
    ]);
  });

  it('is lead.scored with the previous score, also from no score', () => {
    expect(leadChangeEvents(leadRow({ score: null }), leadRow({ score: 70 }))).toEqual([
      expect.objectContaining({ type: 'lead.scored', previousScore: null }),
    ]);
  });

  it('is nothing when only columns that are not sent changed', () => {
    const after = leadRow({
      responses: { answer: 'changed' },
      assigneeUserId: null,
      updatedAt: new Date('2026-10-03T00:00:00Z'),
    });
    expect(leadChangeEvents(leadRow(), after)).toEqual([]);
  });

  it('gives each event of a change that touches all three', () => {
    const events = leadChangeEvents(
      leadRow(),
      leadRow({ name: '別名', status: 'won', score: 90 })
    );
    expect(events.map((e) => e.type)).toEqual(['lead.updated', 'lead.status_changed', 'lead.scored']);
  });
});

describe('sendLeadEvents', () => {
  beforeEach(() => {
    triggerWebhookBatch.mockClear();
    reportServerError.mockClear();
  });

  it('sends a deletion with the id and time only', async () => {
    const deletedAt = new Date('2026-10-04T00:00:00Z');
    await sendLeadEvents('org', [{ type: 'lead.deleted', leadId: 'lead-1', deletedAt }]);
    expect(triggerWebhookBatch).toHaveBeenCalledWith(
      'org',
      [{ eventType: 'lead.deleted', data: { id: 'lead-1', deletedAt: deletedAt.toISOString() } }],
      {}
    );
  });

  it('adds the previous status to lead.status_changed', async () => {
    await sendLeadEvents('org', [
      { type: 'lead.status_changed', lead: leadRow({ status: 'won' }), previousStatus: 'new' },
    ]);
    const [, [event]] = triggerWebhookBatch.mock.calls[0];
    expect(event.data).toMatchObject({ status: 'won', previousStatus: 'new' });
    expect(event.data).not.toHaveProperty('responses');
  });

  it('sends at most the limit and reports the rest once, as a count', async () => {
    const events: LeadEvent[] = Array.from({ length: LEAD_WEBHOOK_EVENT_LIMIT + 3 }, (_, i) => ({
      type: 'lead.deleted' as const,
      leadId: `lead-${i}`,
      deletedAt: new Date(),
    }));
    await sendLeadEvents('org', events);

    expect(triggerWebhookBatch.mock.calls[0][1]).toHaveLength(LEAD_WEBHOOK_EVENT_LIMIT);
    expect(reportServerError).toHaveBeenCalledTimes(1);
    const [where, error] = reportServerError.mock.calls[0];
    expect(where).toBe('webhooks/lead-events-limit');
    expect(String(error)).toContain(`3 of ${LEAD_WEBHOOK_EVENT_LIMIT + 3}`);
  });

  it('sends nothing for no events', async () => {
    await sendLeadEvents('org', []);
    expect(triggerWebhookBatch).not.toHaveBeenCalled();
  });
});
