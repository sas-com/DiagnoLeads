/**
 * Moves the board shows before the server has them (Refs #720): a deal moved between open stages
 * is drawn in its new column at once, with the column totals moved along, until the board is read
 * again; a move that fails is dropped, and the card goes back.
 */

import type { BoardColumn, DealCard } from '@/lib/features/deals/service';
import {
  type DealStage,
  forecastCategory,
  weightedAmount,
} from '@/lib/features/deals/types/pipeline';

export interface PendingMove {
  stage: DealStage;
  /** The probability the stage gives (or the one an undo puts back) */
  probability: number;
  /** When the move was made: the card's new time in the stage */
  at: Date;
}

/** The board's order within a column: expected close date (none last), then the latest change */
function boardOrder(a: DealCard, b: DealCard): number {
  if (a.expectedCloseOn !== b.expectedCloseOn) {
    if (a.expectedCloseOn === null) return 1;
    if (b.expectedCloseOn === null) return -1;
    return a.expectedCloseOn < b.expectedCloseOn ? -1 : 1;
  }
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

/** The columns with the pending moves made: the cards moved and the totals moved with them */
export function applyPendingMoves(
  columns: BoardColumn[],
  pending: ReadonlyMap<string, PendingMove>
): BoardColumn[] {
  if (pending.size === 0) return columns;
  const moved: DealCard[] = [];
  const next = columns.map((column) => {
    const leaving = column.deals.filter((deal) => {
      const move = pending.get(deal.id);
      return move !== undefined && move.stage !== deal.stage;
    });
    if (leaving.length === 0) return column;
    for (const deal of leaving) {
      const move = pending.get(deal.id) as PendingMove;
      const card = { ...deal, stage: move.stage, probability: move.probability };
      moved.push({
        ...card,
        weightedAmount: weightedAmount(card),
        forecastCategory: forecastCategory(card),
        stageChangedAt: move.at,
        updatedAt: move.at,
      });
    }
    return {
      ...column,
      count: column.count - leaving.length,
      amount: column.amount - leaving.reduce((sum, deal) => sum + (deal.amount ?? 0), 0),
      weightedAmount:
        column.weightedAmount - leaving.reduce((sum, deal) => sum + deal.weightedAmount, 0),
      deals: column.deals.filter((deal) => !leaving.includes(deal)),
    };
  });
  return next.map((column) => {
    const arriving = moved.filter((deal) => deal.stage === column.stage);
    if (arriving.length === 0) return column;
    return {
      ...column,
      count: column.count + arriving.length,
      amount: column.amount + arriving.reduce((sum, deal) => sum + (deal.amount ?? 0), 0),
      weightedAmount:
        column.weightedAmount + arriving.reduce((sum, deal) => sum + deal.weightedAmount, 0),
      deals: [...column.deals, ...arriving].sort(boardOrder),
    };
  });
}
