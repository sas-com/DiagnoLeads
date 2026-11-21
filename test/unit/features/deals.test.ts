/**
 * Deals (#435): stage probabilities, the forecast category, the weighted amount, how deals set
 * their lead's status and deal phase (computed again on every change, #444), whether the first
 * meeting of a lead creates its deal (#854), where a new deal starts in the deal form (#951) and the
 * input schemas. The DB behaviour is covered by
 * test/unit/integration/deals.db.test.ts.
 */
import { type Role, defineAbilitiesFor } from '@/lib/auth/permissions';
import type { OrganizationMember, User } from '@/lib/db/schema';
import {
  DEALS_READ_EXCLUDED_ROLES,
  canReadDeals,
  canWriteDeals,
} from '@/lib/features/deals/access';
import {
  type NewDealStartDeal,
  type SyncDeal,
  latestLostReason,
  leadChangesFromDeals,
  leadPhaseOfDeal,
  newDealStart,
  phaseFromDeals,
  qualificationDealSkip,
  wonWithoutWonDeal,
  statusFromDeals,
} from '@/lib/features/deals/lead-sync';
import {
  DEAL_LOST_REASONS,
  DEAL_STAGES,
  OPEN_DEAL_STAGES,
  STAGE_PROBABILITY,
  forecastCategory,
  isOpenStage,
  moveIsUndoable,
  skipsSqlDecision,
  weightedAmount,
} from '@/lib/features/deals/types/pipeline';
import {
  DEAL_LIMITS,
  boardSchema,
  createDealSchema,
  updateDealSchema,
} from '@/lib/features/deals/types/schemas';
import { DEAL_PHASES, LEAD_STATUSES } from '@/lib/features/leads/types/pipeline';
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

describe('skipsSqlDecision', () => {
  it('is a move out of 見極め to a later stage or a win while the lead has no decision (#801)', () => {
    for (const to of ['discovery', 'proposal', 'negotiation', 'won'] as const) {
      expect(skipsSqlDecision('qualification', to, null)).toBe(true);
      expect(skipsSqlDecision('qualification', to, 'qualified')).toBe(false);
    }
  });

  it('is false for a loss, a move within the later stages and a move back to 見極め', () => {
    expect(skipsSqlDecision('qualification', 'lost', null)).toBe(false);
    expect(skipsSqlDecision('discovery', 'proposal', null)).toBe(false);
    expect(skipsSqlDecision('discovery', 'qualification', null)).toBe(false);
    expect(skipsSqlDecision('lost', 'discovery', null)).toBe(false);
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

describe('phaseFromDeals', () => {
  it('is the furthest phase the deals stand for', () => {
    expect(phaseFromDeals([deal({ stage: 'discovery' }), deal({ kind: 'survey', stage: 'won' })])).toBe(
      'survey_won'
    );
    expect(phaseFromDeals([deal({ stage: 'proposal' })])).toBe('proposal');
  });

  it('is null when no deal stands for a phase (the lead keeps its own)', () => {
    expect(phaseFromDeals([deal({ stage: 'lost' })])).toBeNull();
    expect(phaseFromDeals([deal({ kind: 'maintenance', stage: 'won' })])).toBeNull();
    expect(phaseFromDeals([])).toBeNull();
  });
});

describe('statusFromDeals', () => {
  it('is won when a deal is won, negotiating while one is open, lost when all are lost', () => {
    expect(statusFromDeals([deal({ stage: 'won' }), deal({ stage: 'lost' })])).toBe('won');
    expect(statusFromDeals([deal({ stage: 'lost' }), deal({ stage: 'proposal' })])).toBe(
      'negotiating'
    );
    expect(statusFromDeals([deal({ stage: 'lost' })])).toBe('lost');
  });

  it('stays won while a later deal is open, and leaves a lead without deals alone', () => {
    expect(statusFromDeals([deal({ stage: 'won' }), deal({ kind: 'migration' })])).toBe('won');
    expect(statusFromDeals([])).toBeNull();
  });

  // Computed again on every change (#444): the status follows the deals back too
  it('goes back when the won deal is reopened or only open deals are left', () => {
    expect(statusFromDeals([deal({ stage: 'negotiation' })])).toBe('negotiating');
    expect(statusFromDeals([deal({ stage: 'lost' }), deal()])).toBe('negotiating');
  });
});

describe('wonWithoutWonDeal', () => {
  it('is a lead won by hand without deals (#444)', () => {
    expect(wonWithoutWonDeal({ status: 'won', dealPhase: null }, [])).toBe(true);
    expect(wonWithoutWonDeal({ status: 'negotiating', dealPhase: 'migration_won' }, [])).toBe(true);
  });

  it('is false for a lead with deals, whatever they left on it, or for a lead not won (#977)', () => {
    expect(wonWithoutWonDeal({ status: 'won', dealPhase: null }, [deal({ stage: 'won' })])).toBe(
      false
    );
    // A won deal lost since, or deleted while other deals stay: the deals compute the lead
    expect(wonWithoutWonDeal({ status: 'lost', dealPhase: 'survey_won' }, [deal({ stage: 'lost' })])).toBe(
      false
    );
    expect(wonWithoutWonDeal({ status: 'won', dealPhase: 'survey_won' }, [deal()])).toBe(false);
    expect(wonWithoutWonDeal({ status: 'negotiating', dealPhase: 'proposal' }, [])).toBe(false);
  });
});

// Whether the first meeting of a lead creates its deal in 見極め (#854)
describe('qualificationDealSkip', () => {
  const lead = (values: Partial<{ status: string; dealPhase: string | null }> = {}) => ({
    status: 'new',
    dealPhase: null,
    ...values,
  });

  it('creates one for a lead without deals', () => {
    expect(qualificationDealSkip(lead(), [])).toBeNull();
    expect(qualificationDealSkip(lead({ status: 'nurturing' }), [])).toBeNull();
    expect(qualificationDealSkip(lead({ dealPhase: 'initial_hearing' }), [])).toBeNull();
    // A lead lost by hand before it had deals comes back
    expect(qualificationDealSkip(lead({ status: 'lost' }), [])).toBeNull();
  });

  it.each(OPEN_DEAL_STAGES)('creates none while a deal is open (%s)', (stage) => {
    expect(qualificationDealSkip(lead({ status: 'negotiating' }), [deal({ stage })])).toBe(
      'open_deal'
    );
    expect(
      qualificationDealSkip(lead({ status: 'negotiating' }), [deal({ stage: 'lost' }), deal({ stage })])
    ).toBe('open_deal');
  });

  it('creates none for a won lead: a won deal, or won by hand without one', () => {
    expect(qualificationDealSkip(lead({ status: 'won' }), [deal({ stage: 'won' })])).toBe('won');
    expect(
      qualificationDealSkip(lead({ status: 'won' }), [deal({ stage: 'won' }), deal({ stage: 'lost' })])
    ).toBe('won');
    expect(qualificationDealSkip(lead({ status: 'won' }), [])).toBe('won');
    expect(qualificationDealSkip(lead({ dealPhase: 'survey_won' }), [])).toBe('won');
    // A lead with deals is computed from them: all lost, it is no win by hand (#977)
    expect(qualificationDealSkip(lead({ status: 'won' }), [deal({ stage: 'lost' })])).toBeNull();
  });

  it.each(['simple_diagnosis', 'proposal'])(
    'creates none for a lead without deals whose phase was set past the initial hearing (%s)',
    (dealPhase) => {
      expect(qualificationDealSkip(lead({ status: 'negotiating', dealPhase }), [])).toBe(
        'phase_ahead'
      );
    }
  );

  it('creates one for a lead whose deals are all lost, even at a phase they left on it (#977)', () => {
    expect(qualificationDealSkip(lead({ status: 'lost' }), [deal({ stage: 'lost' })])).toBeNull();
    expect(
      qualificationDealSkip(lead({ status: 'lost', dealPhase: 'proposal' }), [
        deal({ stage: 'lost' }),
        deal({ stage: 'lost', kind: 'migration' }),
      ])
    ).toBeNull();
    // A won phase left on the lead by its won deal, lost since or deleted: not a win by hand
    expect(
      qualificationDealSkip(lead({ status: 'lost', dealPhase: 'survey_won' }), [
        deal({ stage: 'lost' }),
      ])
    ).toBeNull();
  });
});

// Where a new deal of a lead starts in the deal form (#951)
describe('newDealStart', () => {
  const lead = (values: Partial<{ status: string; dealPhase: string | null }> = {}) => ({
    status: 'new',
    dealPhase: null,
    ...values,
  });
  const won = (kind: string | null) => ({ stage: 'won', kind, wonFirst: true, previousDealId: null });
  const open = (stage: string) => ({ stage, kind: null, wonFirst: false, previousDealId: null });
  /** A deal of the lead, as newDealStart reads it */
  const leadDeal = (values: Partial<NewDealStartDeal> = {}): NewDealStartDeal => ({
    id: 'deal-1',
    kind: 'survey',
    stage: 'proposal',
    previousDealId: null,
    ...values,
  });

  it.each([
    ['survey_won', 'survey'],
    ['migration_won', 'migration'],
    ['ax', 'ax'],
  ] as const)('starts a lead won by hand with its win, of the kind of its phase (%s)', (dealPhase, kind) => {
    expect(newDealStart(lead({ status: 'won', dealPhase }), [])).toEqual(won(kind));
    // A won phase set by hand on a lead not won
    expect(newDealStart(lead({ status: 'negotiating', dealPhase }), [])).toEqual(won(kind));
    // Left on a lead whose deals are all lost: it is computed from them, in 見極め (#977)
    expect(newDealStart(lead({ status: 'lost', dealPhase }), [leadDeal({ stage: 'lost' })])).toEqual(
      open('qualification')
    );
  });

  it("keeps the form's kind for a lead won at a phase no win stands for", () => {
    expect(newDealStart(lead({ status: 'won' }), [])).toEqual(won(null));
    expect(newDealStart(lead({ status: 'won', dealPhase: 'proposal' }), [])).toEqual(won(null));
    // With deals, the lead is computed from them (#977)
    expect(newDealStart(lead({ status: 'won' }), [leadDeal({ stage: 'lost' })])).toEqual(
      open('qualification')
    );
  });

  it.each([
    [null, 'qualification'],
    ['initial_hearing', 'qualification'],
    ['simple_diagnosis', 'discovery'],
    ['proposal', 'proposal'],
  ] as const)('starts a lead without deals at its phase (%s)', (dealPhase, stage) => {
    for (const status of ['new', 'negotiating', 'nurturing', 'lost']) {
      expect(newDealStart(lead({ status, dealPhase }), []), status).toEqual(open(stage));
    }
  });

  it('starts in 見極め beside deals: open, won, or all lost (its time come again)', () => {
    expect(
      newDealStart(lead({ status: 'negotiating', dealPhase: 'proposal' }), [
        leadDeal({ stage: 'proposal' }),
      ])
    ).toEqual(open('qualification'));
    // After a win it follows it, of the kind that comes after it (#978)
    expect(
      newDealStart(lead({ status: 'won', dealPhase: 'migration_won' }), [
        leadDeal({ stage: 'won', kind: 'migration' }),
      ])
    ).toEqual({ ...open('qualification'), kind: 'ax', previousDealId: 'deal-1' });
    expect(
      newDealStart(lead({ status: 'lost', dealPhase: 'proposal' }), [leadDeal({ stage: 'lost' })])
    ).toEqual(open('qualification'));
  });

  // After a win, the next deal (the migration, AX) follows it (#978)
  describe('after a win', () => {
    const wonLead = lead({ status: 'won', dealPhase: 'survey_won' });

    it.each([
      ['survey', 'migration'],
      ['migration', 'ax'],
    ] as const)('follows the won %s, as the %s', (kind, next) => {
      expect(newDealStart(wonLead, [leadDeal({ stage: 'won', kind })])).toEqual({
        stage: 'qualification',
        kind: next,
        wonFirst: false,
        previousDealId: 'deal-1',
      });
    });

    it('follows no win no kind comes after (AX, maintenance, other): those are chosen in the form', () => {
      for (const kind of ['ax', 'maintenance', 'other']) {
        expect(newDealStart(wonLead, [leadDeal({ stage: 'won', kind })]), kind).toEqual(
          open('qualification')
        );
      }
    });

    it('follows the migration with AX though maintenance goes on from it', () => {
      const migration = leadDeal({ id: 'migration', stage: 'won', kind: 'migration' });
      const maintenance = leadDeal({
        id: 'maintenance',
        stage: 'won',
        kind: 'maintenance',
        previousDealId: 'migration',
      });
      expect(newDealStart(wonLead, [migration, maintenance])).toMatchObject({
        kind: 'ax',
        previousDealId: 'migration',
      });
      // Once AX goes on from it, none is followed
      const ax = leadDeal({ id: 'ax', stage: 'won', kind: 'ax', previousDealId: 'migration' });
      expect(newDealStart(wonLead, [migration, maintenance, ax])).toEqual(open('qualification'));
    });

    it('follows the last win of a chain: the migration after the survey', () => {
      const survey = leadDeal({ id: 'survey', stage: 'won', kind: 'survey' });
      const migration = leadDeal({
        id: 'migration',
        stage: 'won',
        kind: 'migration',
        previousDealId: 'survey',
      });
      expect(newDealStart(wonLead, [survey, migration])).toMatchObject({
        kind: 'ax',
        previousDealId: 'migration',
      });
    });

    it('follows a win again once the deal that went on from it was lost', () => {
      const survey = leadDeal({ id: 'survey', stage: 'won', kind: 'survey' });
      const lostMigration = leadDeal({
        id: 'lost',
        stage: 'lost',
        kind: 'migration',
        previousDealId: 'survey',
      });
      expect(newDealStart(wonLead, [survey, lostMigration])).toMatchObject({
        kind: 'migration',
        previousDealId: 'survey',
      });
    });

    it('follows no deal while one goes on from the win, or when wins are several', () => {
      const survey = leadDeal({ id: 'survey', stage: 'won', kind: 'survey' });
      const openMigration = leadDeal({
        id: 'open',
        stage: 'proposal',
        kind: 'migration',
        previousDealId: 'survey',
      });
      expect(newDealStart(wonLead, [survey, openMigration])).toEqual(open('qualification'));
      const otherSurvey = leadDeal({ id: 'survey-2', stage: 'won', kind: 'survey' });
      expect(newDealStart(wonLead, [survey, otherSurvey])).toEqual(open('qualification'));
    });
  });

  // Saved as it opens, the deal is one createDeal accepts (a lead won by hand takes only its win)
  // and it takes nothing back from the lead without deals
  it.each(LEAD_STATUSES)('opens a lead without deals with a deal that keeps it (%s)', (status) => {
    const phaseIndex = (phase: string | null) =>
      (DEAL_PHASES as readonly (string | null)[]).indexOf(phase);
    for (const dealPhase of [null, ...DEAL_PHASES]) {
      const before = { status, dealPhase, lostReason: null, hasNegotiated: false };
      const start = newDealStart(before, []);
      expect(start.wonFirst, String(dealPhase)).toBe(wonWithoutWonDeal(before, []));
      if (start.wonFirst) expect(start.stage).toBe('won');

      const changes = leadChangesFromDeals(before, [
        deal({ stage: start.stage, kind: start.kind ?? 'survey' }),
      ]);
      const after = changes.dealPhase ?? dealPhase;
      expect(phaseIndex(after), String(dealPhase)).toBeGreaterThanOrEqual(phaseIndex(dealPhase));
      if (start.wonFirst) expect(changes.status ?? status).toBe('won');
    }
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

  // Computed again on every change (#444), not only forward
  it('moves a won lead back when its won deal is reopened or deleted', () => {
    const won = { status: 'won', dealPhase: 'survey_won', lostReason: null, hasNegotiated: true };
    expect(leadChangesFromDeals(won, [deal({ stage: 'negotiation' })])).toEqual({
      status: 'negotiating',
      dealPhase: 'proposal',
    });
    // A lead set by hand to a further phase follows its deals too
    expect(leadChangesFromDeals({ ...won, status: 'negotiating', dealPhase: 'ax' }, [deal()])).toEqual(
      { dealPhase: 'initial_hearing' }
    );
  });

  it('keeps the phase when no deal stands for one, and keeps the lost reason when negotiated again', () => {
    expect(
      leadChangesFromDeals(
        { status: 'negotiating', dealPhase: 'proposal', lostReason: null, hasNegotiated: true },
        [deal({ stage: 'lost', lostReason: 'budget', closedOn: '2026-10-10' })]
      )
    ).toEqual({ status: 'lost', lostReason: 'budget' });
    expect(
      leadChangesFromDeals(
        { status: 'lost', dealPhase: 'proposal', lostReason: 'timing', hasNegotiated: true },
        [deal({ stage: 'lost', lostReason: 'timing' }), deal()]
      )
    ).toEqual({ status: 'negotiating', dealPhase: 'initial_hearing' });
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
    const parsed = createDealSchema.parse({ ...base, lostNote: '  ', competitor: '' });
    expect(parsed.lostNote).toBeNull();
    expect(parsed.competitor).toBeNull();
  });

  it('drops a next step sent, which is no longer an input, without refusing it (#853)', () => {
    // A screen opened before the change sends nextStep: null with each new deal
    for (const nextStep of [null, '見積を送る', 'x'.repeat(1000)]) {
      const parsed = createDealSchema.safeParse({ ...base, nextStep });
      expect(parsed.success).toBe(true);
      expect(parsed.data).not.toHaveProperty('nextStep');
    }
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
    // PostgreSQL has no year 0; no deal closes outside 2000-2100
    [{ expectedCloseOn: '0000-01-01' }],
    [{ expectedCloseOn: '1999-12-31' }],
    [{ expectedCloseOn: '2101-01-01' }],
    [{ lostReason: 'unknown' }],
    [{ lostReason: 'on_hold' }],
    [{ ownerUserId: 'not-a-uuid' }],
  ])('rejects %o', (overrides) => {
    expect(createDealSchema.safeParse({ ...base, ...overrides }).success).toBe(false);
  });

  it.each(['2000-01-01', '2100-12-31'])('takes the close date %s', (expectedCloseOn) => {
    expect(createDealSchema.parse({ ...base, expectedCloseOn }).expectedCloseOn).toBe(expectedCloseOn);
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

  it('drops a next step sent (#853)', () => {
    const parsed = updateDealSchema.parse({ organizationId: ORG, dealId: DEAL, nextStep: '電話' });
    expect(parsed).toEqual({ organizationId: ORG, dealId: DEAL });
  });

  it('bounds the closing date like the close date', () => {
    const scope = { organizationId: ORG, dealId: DEAL };
    expect(updateDealSchema.safeParse({ ...scope, closedOn: '2026-10-25' }).success).toBe(true);
    expect(updateDealSchema.safeParse({ ...scope, closedOn: '0000-01-01' }).success).toBe(false);
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
    expect(boardSchema.safeParse({ organizationId: ORG, closeFrom: '0000-01-01' }).success).toBe(
      false
    );
  });
});

describe('canReadDeals and canWriteDeals', () => {
  const user: User = {
    id: 'user-1',
    name: '営業 花子',
    email: 'rep@example.com',
    emailVerified: true,
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const ctxFor = (role: string, abilityRole = role) => {
    const membershipOf = (name: string): OrganizationMember => ({
      id: 'membership-1',
      organizationId: ORG,
      userId: user.id,
      role: name as OrganizationMember['role'],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return {
      ability: defineAbilitiesFor(user, membershipOf(abilityRole)),
      membership: membershipOf(role),
    };
  };

  it.each(['owner', 'admin', 'member', 'group_owner', 'group_admin'])('lets %s read deals', (role) => {
    expect(canReadDeals(ctxFor(role))).toBe(true);
  });

  it("keeps a parent organization's viewers out, though they can read leads", () => {
    const ctx = ctxFor('parent_viewer');
    expect(ctx.ability.can('read', 'Lead')).toBe(true);
    expect(canReadDeals(ctx)).toBe(false);
  });

  it.each([
    ['owner', true, true],
    ['admin', true, true],
    ['member', true, false],
    ['group_owner', true, true],
    ['group_admin', true, true],
    ['parent_viewer', false, false],
  ])('%s: change %s, delete %s', (role, update, remove) => {
    expect(canWriteDeals(ctxFor(role), 'update')).toBe(update);
    expect(canWriteDeals(ctxFor(role), 'delete')).toBe(remove);
  });

  /*
   * The deal of a first meeting (#854) is created with the permission of its entry point, to
   * update leads, without canWriteDeals (decision 2026-10-28-auto-qualification-deal). That holds
   * only while every role that may update leads may also write deals. A role that may change
   * leads but not read deals, as the agency accounts of #276 may be, has to decide first whether
   * an entry point creates deals for it. Every role is listed here: adding one to the roles fails
   * the type check until it is listed, and then this test when it breaks the rule. The roles left
   * out of reading deals (lib/auth/deal-access.ts) are checked too.
   */
  const ROLES = [
    'owner',
    'admin',
    'member',
    'group_owner',
    'group_admin',
    'parent_viewer',
  ] as const satisfies readonly Role[];
  type Unlisted = Exclude<Role, (typeof ROLES)[number]>;
  const everyRoleListed: [Unlisted] extends [never] ? true : false = true;

  it('lists every role of a member (#854, #276)', () => {
    expect(everyRoleListed).toBe(true);
  });

  it.each([...new Set<string>([...ROLES, ...DEALS_READ_EXCLUDED_ROLES])])(
    '%s: may write deals exactly when it may update leads, as the deal of a first meeting assumes (#854, #276)',
    (role) => {
      const ctx = ctxFor(role);
      expect(canWriteDeals(ctx, 'update')).toBe(ctx.ability.can('update', 'Lead'));
    }
  );

  it('keeps an excluded role from writing even when it may change leads', () => {
    // The abilities of an admin under the excluded role's name (as an agency account would be);
    // a write answers with the whole deal
    const ctx = ctxFor('parent_viewer', 'admin');
    expect(ctx.ability.can('update', 'Lead')).toBe(true);
    expect(ctx.ability.can('delete', 'Lead')).toBe(true);
    expect(canWriteDeals(ctx, 'update')).toBe(false);
    expect(canWriteDeals(ctx, 'delete')).toBe(false);
  });
});

describe('moveIsUndoable', () => {
  it('offers no undo for a move that handed the lead off (#720)', () => {
    expect(moveIsUndoable({ handedOff: false })).toBe(true);
    expect(moveIsUndoable({ handedOff: true })).toBe(false);
  });
});
