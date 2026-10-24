/**
 * Deals (#435): stage probabilities, the forecast category, the weighted amount, how deals move
 * their lead forward and the input schemas. The DB behaviour is covered by
 * test/unit/integration/deals.db.test.ts.
 */
import { defineAbilitiesFor } from '@/lib/auth/permissions';
import type { OrganizationMember, User } from '@/lib/db/schema';
import { canReadDeals } from '@/lib/features/deals/access';
import {
  type SyncDeal,
  furtherPhase,
  latestLostReason,
  leadChangesFromDeals,
  leadPhaseOfDeal,
  statusFromDeals,
} from '@/lib/features/deals/lead-sync';
import {
  DEAL_LOST_REASONS,
  DEAL_STAGES,
  OPEN_DEAL_STAGES,
  STAGE_PROBABILITY,
  forecastCategory,
  isOpenStage,
  weightedAmount,
} from '@/lib/features/deals/types/pipeline';
import {
  DEAL_LIMITS,
  boardSchema,
  createDealSchema,
  updateDealSchema,
} from '@/lib/features/deals/types/schemas';
import { describe, expect, it } from 'vitest';

const ORG = '660e8400-e29b-41d4-a716-446655440000';
const LEAD = '770e8400-e29b-41d4-a716-446655440001';
const DEAL = '880e8400-e29b-41d4-a716-446655440002';

const deal = (overrides: Partial<SyncDeal> = {}): SyncDeal => ({
  kind: 'survey',
  stage: 'qualification',
  lostReason: null,
  closedOn: null,
  updatedAt: new Date('2026-10-20T00:00:00Z'),
  ...overrides,
});

describe('stages', () => {
  it('has the open stages first, then won and lost', () => {
    expect(DEAL_STAGES).toEqual([...OPEN_DEAL_STAGES, 'won', 'lost']);
    expect(isOpenStage('proposal')).toBe(true);
    expect(isOpenStage('won')).toBe(false);
    expect(isOpenStage('unknown')).toBe(false);
  });

  it('raises the default probability stage by stage', () => {
    const open = OPEN_DEAL_STAGES.map((stage) => STAGE_PROBABILITY[stage]);
    expect(open).toEqual([...open].sort((a, b) => a - b));
    expect(STAGE_PROBABILITY.won).toBe(100);
    expect(STAGE_PROBABILITY.lost).toBe(0);
  });
});

describe('forecastCategory', () => {
  it.each([
    [{ stage: 'proposal', probability: 10, forecastOverride: null }, 'pipeline'],
    [{ stage: 'proposal', probability: 40, forecastOverride: null }, 'best_case'],
    [{ stage: 'negotiation', probability: 70, forecastOverride: null }, 'commit'],
    [{ stage: 'negotiation', probability: 90, forecastOverride: 'omitted' }, 'omitted'],
    [{ stage: 'qualification', probability: 10, forecastOverride: 'commit' }, 'commit'],
    [{ stage: 'won', probability: 100, forecastOverride: 'pipeline' }, 'closed'],
    [{ stage: 'lost', probability: 0, forecastOverride: 'commit' }, 'lost'],
  ])('%o is %s', (input, expected) => {
    expect(forecastCategory(input)).toBe(expected);
  });

  it('ignores an override it does not know', () => {
    expect(forecastCategory({ stage: 'proposal', probability: 40, forecastOverride: 'x' })).toBe(
      'best_case'
    );
  });
});

describe('weightedAmount', () => {
  it('weights the amount by the probability and rounds down', () => {
    expect(weightedAmount({ amount: 1_000_001, probability: 40 })).toBe(400_000);
    expect(weightedAmount({ amount: null, probability: 70 })).toBe(0);
    expect(weightedAmount({ amount: 500_000, probability: 0 })).toBe(0);
  });
});

describe('leadPhaseOfDeal', () => {
  it.each([
    ['survey', 'qualification', 'initial_hearing'],
    ['survey', 'discovery', 'simple_diagnosis'],
    ['migration', 'proposal', 'proposal'],
    ['ax', 'negotiation', 'proposal'],
    ['survey', 'won', 'survey_won'],
    ['migration', 'won', 'migration_won'],
    ['ax', 'won', 'ax'],
    ['maintenance', 'won', null],
    ['survey', 'lost', null],
  ])('a %s deal at %s stands for %s', (kind, stage, expected) => {
    expect(leadPhaseOfDeal({ kind, stage })).toBe(expected);
  });
});

describe('furtherPhase', () => {
  it('is the furthest phase of the deals when it is further than the lead', () => {
    const deals = [deal({ stage: 'discovery' }), deal({ kind: 'survey', stage: 'won' })];
    expect(furtherPhase(null, deals)).toBe('survey_won');
    expect(furtherPhase('proposal', deals)).toBe('survey_won');
  });

  it('never moves the lead back', () => {
    expect(furtherPhase('migration_won', [deal({ stage: 'proposal' })])).toBeNull();
    expect(furtherPhase('proposal', [deal({ stage: 'proposal' })])).toBeNull();
    expect(furtherPhase('initial_hearing', [deal({ stage: 'lost' })])).toBeNull();
  });
});

describe('statusFromDeals', () => {
  it('is won when a deal is won, negotiating while one is open, lost when all are lost', () => {
    expect(statusFromDeals('new', [deal({ stage: 'won' }), deal({ stage: 'lost' })])).toBe('won');
    expect(statusFromDeals('new', [deal({ stage: 'lost' }), deal({ stage: 'proposal' })])).toBe(
      'negotiating'
    );
    expect(statusFromDeals('negotiating', [deal({ stage: 'lost' })])).toBe('lost');
  });

  it('keeps a won lead won and leaves a lead without deals alone', () => {
    expect(statusFromDeals('won', [deal({ stage: 'proposal' })])).toBeNull();
    expect(statusFromDeals('won', [deal({ stage: 'lost' })])).toBeNull();
    expect(statusFromDeals('nurturing', [])).toBeNull();
  });

  it('revives a lost lead when a new deal opens', () => {
    expect(statusFromDeals('lost', [deal({ stage: 'lost' }), deal()])).toBe('negotiating');
  });
});

describe('latestLostReason', () => {
  it('takes the reason of the deal lost last', () => {
    const reasons = latestLostReason([
      deal({ stage: 'lost', lostReason: 'budget', closedOn: '2026-10-01' }),
      deal({ stage: 'lost', lostReason: 'timing', closedOn: '2026-10-15' }),
      deal({ stage: 'won', lostReason: 'competitor', closedOn: '2026-10-20' }),
    ]);
    expect(reasons).toBe('timing');
  });

  it('breaks a tie on the close day by the last update and skips unknown reasons', () => {
    expect(
      latestLostReason([
        deal({ stage: 'lost', lostReason: 'budget', closedOn: '2026-10-15' }),
        deal({
          stage: 'lost',
          lostReason: 'competitor',
          closedOn: '2026-10-15',
          updatedAt: new Date('2026-10-21T00:00:00Z'),
        }),
        deal({ stage: 'lost', lostReason: 'not-a-reason', closedOn: '2026-10-30' }),
        deal({ stage: 'lost', lostReason: 'on_hold', closedOn: '2026-10-31' }),
      ])
    ).toBe('competitor');
    expect(latestLostReason([deal({ stage: 'proposal' })])).toBeNull();
  });
});

describe('leadChangesFromDeals', () => {
  const lead = {
    status: 'new',
    dealPhase: null,
    lostReason: null,
    hasNegotiated: false,
  };

  it('marks the lead negotiated, moves the phase and the status forward', () => {
    expect(leadChangesFromDeals(lead, [deal({ stage: 'discovery' })])).toEqual({
      hasNegotiated: true,
      dealPhase: 'simple_diagnosis',
      status: 'negotiating',
    });
  });

  it('gives a lead that becomes lost the reason of its latest lost deal', () => {
    expect(
      leadChangesFromDeals({ ...lead, status: 'negotiating', hasNegotiated: true }, [
        deal({ stage: 'lost', lostReason: 'budget', closedOn: '2026-10-10' }),
      ])
    ).toEqual({ status: 'lost', lostReason: 'budget' });
  });

  it('keeps a lost reason the lead already has', () => {
    expect(
      leadChangesFromDeals(
        { ...lead, status: 'negotiating', hasNegotiated: true, lostReason: 'timing' },
        [deal({ stage: 'lost', lostReason: 'budget', closedOn: '2026-10-10' })]
      )
    ).toEqual({ status: 'lost' });
  });

  // 保留 is not a loss (#445): a lead lost through its deals is not left as 失注 + 保留
  it('replaces 保留 with the reason of the latest lost deal', () => {
    const lostDeal = deal({ stage: 'lost', lostReason: 'timing', closedOn: '2026-10-10' });
    expect(
      leadChangesFromDeals(
        { ...lead, status: 'negotiating', hasNegotiated: true, lostReason: 'on_hold' },
        [lostDeal]
      )
    ).toEqual({ status: 'lost', lostReason: 'timing' });
    // A lost deal without a reason (only written around the API) drops 保留 instead
    expect(
      leadChangesFromDeals(
        { ...lead, status: 'nurturing', hasNegotiated: true, lostReason: 'on_hold' },
        [deal({ stage: 'lost', lostReason: null, closedOn: '2026-10-10' })]
      )
    ).toEqual({ status: 'lost', lostReason: null });
    expect(
      leadChangesFromDeals(
        { ...lead, status: 'nurturing', hasNegotiated: true, lostReason: 'on_hold' },
        [deal({ stage: 'proposal' })]
      )
    ).toEqual({ status: 'negotiating', dealPhase: 'proposal' });
  });

  it('changes nothing when the lead is up to date or has no deals', () => {
    expect(
      leadChangesFromDeals(
        { status: 'negotiating', dealPhase: 'proposal', lostReason: null, hasNegotiated: true },
        [deal({ stage: 'proposal' })]
      )
    ).toEqual({});
    expect(leadChangesFromDeals(lead, [])).toEqual({});
  });
});

describe('createDealSchema', () => {
  const base = { organizationId: ORG, leadId: LEAD, name: '  AS/400 現行調査  ' };

  it('defaults to a survey at the first stage and trims the name', () => {
    const parsed = createDealSchema.parse(base);
    expect(parsed).toMatchObject({ name: 'AS/400 現行調査', kind: 'survey', stage: 'qualification' });
    expect(parsed.probability).toBeUndefined();
  });

  it('turns empty optional text into null', () => {
    const parsed = createDealSchema.parse({ ...base, nextStep: '  ', competitor: '' });
    expect(parsed.nextStep).toBeNull();
    expect(parsed.competitor).toBeNull();
  });

  it.each([
    [{ name: '' }],
    [{ name: 'x'.repeat(DEAL_LIMITS.name + 1) }],
    [{ amount: -1 }],
    [{ amount: 1.5 }],
    [{ amount: DEAL_LIMITS.amount + 1 }],
    [{ probability: 101 }],
    [{ kind: 'consulting' }],
    [{ stage: 'closed' }],
    [{ expectedCloseOn: '2026-02-30' }],
    [{ lostReason: 'unknown' }],
    [{ lostReason: 'on_hold' }],
    [{ ownerUserId: 'not-a-uuid' }],
  ])('rejects %o', (overrides) => {
    expect(createDealSchema.safeParse({ ...base, ...overrides }).success).toBe(false);
  });

  it('takes the lost reasons of the leads except 保留 (#445)', () => {
    expect(DEAL_LOST_REASONS).not.toContain('on_hold');
    expect(DEAL_LOST_REASONS).toContain('timing');
    expect(createDealSchema.parse({ ...base, stage: 'lost', lostReason: 'timing' }).lostReason).toBe(
      'timing'
    );
  });
});

describe('updateDealSchema', () => {
  it('leaves out what is not sent and keeps null to clear', () => {
    const parsed = updateDealSchema.parse({
      organizationId: ORG,
      dealId: DEAL,
      amount: null,
      stage: 'proposal',
    });
    expect(parsed).toEqual({ organizationId: ORG, dealId: DEAL, amount: null, stage: 'proposal' });
  });
});

describe('boardSchema', () => {
  it('shows everyone and the last 30 days of closed deals by default', () => {
    expect(boardSchema.parse({ organizationId: ORG })).toEqual({
      organizationId: ORG,
      owner: 'all',
      closedWithinDays: 30,
    });
  });

  it('accepts mine or a member id and rejects a reversed period', () => {
    expect(boardSchema.safeParse({ organizationId: ORG, owner: 'mine' }).success).toBe(true);
    expect(boardSchema.safeParse({ organizationId: ORG, owner: LEAD }).success).toBe(true);
    expect(boardSchema.safeParse({ organizationId: ORG, owner: 'someone' }).success).toBe(false);
    expect(
      boardSchema.safeParse({ organizationId: ORG, closeFrom: '2026-12-01', closeTo: '2026-11-01' })
        .success
    ).toBe(false);
  });
});

describe('canReadDeals', () => {
  const user: User = {
    id: 'user-1',
    name: '営業 花子',
    email: 'rep@example.com',
    emailVerified: true,
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const ctxFor = (role: string) => {
    const membership: OrganizationMember = {
      id: 'membership-1',
      organizationId: ORG,
      userId: user.id,
      role: role as OrganizationMember['role'],
      createdAt: new Date(),
      updatedAt: null,
    };
    return { ability: defineAbilitiesFor(user, membership), membership };
  };

  it.each(['owner', 'admin', 'member', 'group_owner', 'group_admin'])('lets %s read deals', (role) => {
    expect(canReadDeals(ctxFor(role))).toBe(true);
  });

  it("keeps a parent organization's viewers out, though they can read leads", () => {
    const ctx = ctxFor('parent_viewer');
    expect(ctx.ability.can('read', 'Lead')).toBe(true);
    expect(canReadDeals(ctx)).toBe(false);
  });
});
