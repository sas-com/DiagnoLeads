/**
 * The order of the deals list (#720): the URL's `sort` and `order`, the next order a header asks
 * for, and the deals in that order (the board's order without one, values missing last, and by
 * expected close date the open deals before the won and lost ones)
 */
import {
  DEFAULT_DEAL_SORT,
  dealSortParams,
  nextDealSort,
  parseDealSort,
  sortDeals,
} from '@/components/features/deals/deal-list-sort';
import type { DealCard } from '@/lib/features/deals/service';
import { describe, expect, it } from 'vitest';

const card = (id: string, overrides: Partial<DealCard>): DealCard => ({
  id,
  leadId: 'lead-1',
  name: id,
  kind: 'survey',
  stage: 'proposal',
  amount: null,
  probability: 40,
  weightedAmount: 0,
  forecastOverride: null,
  forecastCategory: 'best_case',
  expectedCloseOn: null,
  closedOn: null,
  lostReason: null,
  lostNote: null,
  competitor: null,
  targetSystem: null,
  nextStep: null,
  ownerUserId: null,
  ownerName: null,
  previousDealId: null,
  stageChangedAt: new Date('2026-10-20T00:00:00Z'),
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-20T00:00:00Z'),
  leadName: null,
  company: '架空商事',
  nextTask: null,
  hasOpenTask: false,
  leadSqlDecision: null,
  ...overrides,
});

describe('parseDealSort', () => {
  it("gives the board's order without a known column", () => {
    expect(parseDealSort(null, null)).toEqual(DEFAULT_DEAL_SORT);
    expect(parseDealSort('score', 'desc')).toEqual(DEFAULT_DEAL_SORT);
  });

  it("starts each column in its first order unless the URL says otherwise", () => {
    expect(parseDealSort('expectedCloseOn', null)).toEqual({ by: 'expectedCloseOn', order: 'asc' });
    expect(parseDealSort('amount', null)).toEqual({ by: 'amount', order: 'desc' });
    expect(parseDealSort('amount', 'asc')).toEqual({ by: 'amount', order: 'asc' });
    expect(parseDealSort('amount', 'sideways')).toEqual({ by: 'amount', order: 'desc' });
  });
});

describe('dealSortParams', () => {
  it('writes the order only when it is not the first one, and nothing for the default', () => {
    expect(dealSortParams(DEFAULT_DEAL_SORT)).toEqual({ sort: null, order: null });
    expect(dealSortParams({ by: 'expectedCloseOn', order: 'asc' })).toEqual({
      sort: 'expectedCloseOn',
      order: null,
    });
    expect(dealSortParams({ by: 'amount', order: 'asc' })).toEqual({ sort: 'amount', order: 'asc' });
    expect(dealSortParams({ by: 'stage', order: 'desc' })).toEqual({ sort: 'stage', order: 'desc' });
  });

  it('reads back what it writes', () => {
    for (const sort of [
      { by: 'amount', order: 'desc' },
      { by: 'amount', order: 'asc' },
      { by: 'expectedCloseOn', order: 'desc' },
      { by: 'stage', order: 'desc' },
    ] as const) {
      const params = dealSortParams(sort);
      expect(parseDealSort(params.sort, params.order)).toEqual(sort);
    }
  });
});

describe('nextDealSort', () => {
  it('flips the same column and starts another in its first order', () => {
    expect(nextDealSort(DEFAULT_DEAL_SORT, 'amount')).toEqual({ by: 'amount', order: 'desc' });
    expect(nextDealSort({ by: 'amount', order: 'desc' }, 'amount')).toEqual({
      by: 'amount',
      order: 'asc',
    });
    expect(nextDealSort({ by: 'amount', order: 'asc' }, 'expectedCloseOn')).toEqual({
      by: 'expectedCloseOn',
      order: 'asc',
    });
  });
});

describe('sortDeals', () => {
  // In the board's order: by stage, then by close date within a stage
  const deals = [
    card('a', { stage: 'qualification', amount: 5_000_000, expectedCloseOn: '2026-12-01' }),
    card('b', { stage: 'proposal', amount: null, expectedCloseOn: '2026-11-01' }),
    card('c', { stage: 'proposal', amount: 1_000_000, expectedCloseOn: null }),
    card('d', { stage: 'won', amount: 5_000_000, expectedCloseOn: '2026-10-01' }),
    card('e', { stage: 'lost', amount: 2_000_000, expectedCloseOn: '2026-09-01' }),
  ];
  const ids = (sorted: DealCard[]) => sorted.map((deal) => deal.id);

  it("keeps the board's order, or turns the stages around", () => {
    expect(ids(sortDeals(deals, { by: 'stage', order: 'asc' }))).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(ids(sortDeals(deals, { by: 'stage', order: 'desc' }))).toEqual([
      'e',
      'd',
      'b',
      'c',
      'a',
    ]);
  });

  it('sorts by amount with the deals without one last, equal ones in board order', () => {
    expect(ids(sortDeals(deals, { by: 'amount', order: 'desc' }))).toEqual([
      'a',
      'd',
      'e',
      'c',
      'b',
    ]);
    expect(ids(sortDeals(deals, { by: 'amount', order: 'asc' }))).toEqual(['c', 'e', 'a', 'd', 'b']);
  });

  it('sorts by expected close date with the open deals first, those without one last (#720)', () => {
    // The won and lost deals' passed dates do not mix with the overdue open ones
    expect(ids(sortDeals(deals, { by: 'expectedCloseOn', order: 'asc' }))).toEqual([
      'b',
      'a',
      'c',
      'e',
      'd',
    ]);
    expect(ids(sortDeals(deals, { by: 'expectedCloseOn', order: 'desc' }))).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ]);
  });

  it('keeps the board order among the closed deals with the same close date', () => {
    const closed = [
      card('w', { stage: 'won', expectedCloseOn: '2026-10-01' }),
      card('l', { stage: 'lost', expectedCloseOn: '2026-10-01' }),
      card('o', { stage: 'negotiation', expectedCloseOn: '2026-12-31' }),
    ];
    expect(ids(sortDeals(closed, { by: 'expectedCloseOn', order: 'asc' }))).toEqual([
      'o',
      'w',
      'l',
    ]);
  });

  it('leaves the deals it was given as they were', () => {
    const before = ids(deals);
    sortDeals(deals, { by: 'amount', order: 'desc' });
    expect(ids(deals)).toEqual(before);
  });
});
