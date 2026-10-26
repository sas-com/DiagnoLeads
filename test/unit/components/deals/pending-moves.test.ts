/**
 * Moves shown before the server has them (#720): the card in its new column in the board's
 * order, with the probability, weighted amount and forecast category of its new stage, and the
 * column totals moved along; a move the board already shows changes nothing
 */
import { type PendingMove, applyPendingMoves } from '@/components/features/deals/pending-moves';
import type { BoardColumn, DealCard } from '@/lib/features/deals/service';
import { DEAL_STAGES } from '@/lib/features/deals/types/pipeline';
import { describe, expect, it } from 'vitest';

const card = (id: string, overrides: Partial<DealCard>): DealCard => ({
  id,
  leadId: 'lead-1',
  name: id,
  kind: 'survey',
  stage: 'proposal',
  amount: 3_000_000,
  probability: 40,
  weightedAmount: 1_200_000,
  forecastOverride: null,
  forecastCategory: 'best_case',
  expectedCloseOn: '2026-11-30',
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
  hasOpenTask: true,
  ...overrides,
});

function columnsWith(deals: DealCard[]): BoardColumn[] {
  return DEAL_STAGES.map((stage) => {
    const inStage = deals.filter((deal) => deal.stage === stage);
    return {
      stage,
      count: inStage.length,
      amount: inStage.reduce((sum, deal) => sum + (deal.amount ?? 0), 0),
      weightedAmount: inStage.reduce((sum, deal) => sum + deal.weightedAmount, 0),
      deals: inStage,
    };
  });
}

const at = new Date('2026-10-24T03:00:00Z');
const columnOf = (columns: BoardColumn[], stage: string) =>
  columns.find((column) => column.stage === stage) as BoardColumn;

describe('applyPendingMoves', () => {
  it('returns the columns as they are without moves', () => {
    const columns = columnsWith([card('a', {})]);
    expect(applyPendingMoves(columns, new Map())).toBe(columns);
  });

  it('moves the card and the totals to the new column', () => {
    const columns = columnsWith([
      card('a', {}),
      card('b', { stage: 'negotiation', probability: 70, weightedAmount: 700_000, amount: 1_000_000 }),
    ]);
    const moves = new Map<string, PendingMove>([['a', { stage: 'negotiation', probability: 70, at }]]);
    const moved = applyPendingMoves(columns, moves);

    expect(columnOf(moved, 'proposal')).toMatchObject({
      count: 0,
      amount: 0,
      weightedAmount: 0,
      deals: [],
    });
    const negotiation = columnOf(moved, 'negotiation');
    expect(negotiation).toMatchObject({
      count: 2,
      amount: 4_000_000,
      weightedAmount: 2_800_000,
    });
    expect(negotiation.deals.find((deal) => deal.id === 'a')).toMatchObject({
      stage: 'negotiation',
      probability: 70,
      weightedAmount: 2_100_000,
      forecastCategory: 'commit',
      stageChangedAt: at,
    });
    // The input is left as it was
    expect(columnOf(columns, 'proposal').count).toBe(1);
  });

  it("puts the moved card in the board's order: close date, then the latest change", () => {
    const columns = columnsWith([
      card('a', { expectedCloseOn: '2026-12-31' }),
      card('b', { stage: 'discovery', expectedCloseOn: '2026-11-01' }),
      card('c', { stage: 'discovery', expectedCloseOn: '2026-12-31' }),
      card('d', { stage: 'discovery', expectedCloseOn: null }),
    ]);
    const moved = applyPendingMoves(
      columns,
      new Map([['a', { stage: 'discovery' as const, probability: 20, at }]])
    );
    // Changed last, so before the other deal closing the same day
    expect(columnOf(moved, 'discovery').deals.map((deal) => deal.id)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('keeps an amount missing and changes nothing for a move the board shows already', () => {
    const columns = columnsWith([card('a', { amount: null, weightedAmount: 0 })]);
    const moved = applyPendingMoves(
      columns,
      new Map([['a', { stage: 'qualification' as const, probability: 10, at }]])
    );
    expect(columnOf(moved, 'qualification')).toMatchObject({ count: 1, amount: 0, weightedAmount: 0 });

    const already = applyPendingMoves(
      columns,
      new Map([['a', { stage: 'proposal' as const, probability: 40, at }]])
    );
    expect(already).toEqual(columns);
  });
});
