/**
 * The order of the deals list (Refs #720), kept in the URL like the filters: `sort` names the
 * column and `order` the direction when it is not the column's first one, so
 * `/deals?view=list&sort=expectedCloseOn` lists the earliest close dates first (the forecast
 * links its overdue deals there), the open deals before the won and lost ones. Without `sort` the
 * list keeps the board's order: by stage, then as the board reads each column (expected close
 * date, then the latest change).
 *
 * The board query already returns every deal it shows (up to BOARD_DEALS_LIMIT), so the list is
 * sorted here rather than read again in another order.
 */

import type { DealCard } from '@/lib/features/deals/service';
import { DEAL_STAGES, isOpenStage } from '@/lib/features/deals/types/pipeline';

export const DEAL_SORT_KEYS = ['stage', 'amount', 'expectedCloseOn'] as const;
export type DealSortKey = (typeof DEAL_SORT_KEYS)[number];
export type DealSortOrder = 'asc' | 'desc';

export interface DealSort {
  by: DealSortKey;
  order: DealSortOrder;
}

export const DEAL_SORT_PARAMS = { by: 'sort', order: 'order' } as const;

/** The board's order */
export const DEFAULT_DEAL_SORT: DealSort = { by: 'stage', order: 'asc' };

/** The direction a column sorts in first: the largest amounts, the earliest close dates */
const FIRST_ORDER: Record<DealSortKey, DealSortOrder> = {
  stage: 'asc',
  amount: 'desc',
  expectedCloseOn: 'asc',
};

const isSortKey = (value: string | null): value is DealSortKey =>
  (DEAL_SORT_KEYS as readonly string[]).includes(value ?? '');

/** The sort of the URL's `sort` and `order`; unknown values give the board's order */
export function parseDealSort(by: string | null, order: string | null): DealSort {
  if (!isSortKey(by)) return DEFAULT_DEAL_SORT;
  return { by, order: order === 'asc' || order === 'desc' ? order : FIRST_ORDER[by] };
}

/** The URL's `sort` and `order` for a sort: null removes a parameter */
export function dealSortParams(sort: DealSort): Record<string, string | null> {
  if (sort.by === DEFAULT_DEAL_SORT.by && sort.order === DEFAULT_DEAL_SORT.order) {
    return { [DEAL_SORT_PARAMS.by]: null, [DEAL_SORT_PARAMS.order]: null };
  }
  return {
    [DEAL_SORT_PARAMS.by]: sort.by,
    [DEAL_SORT_PARAMS.order]: sort.order === FIRST_ORDER[sort.by] ? null : sort.order,
  };
}

/** The sort after a column header is clicked: the same column flips, another starts first */
export function nextDealSort(current: DealSort, column: DealSortKey): DealSort {
  if (current.by === column) return { by: column, order: current.order === 'asc' ? 'desc' : 'asc' };
  return { by: column, order: FIRST_ORDER[column] };
}

/** Deals without the value go last in both directions */
function compareNullable<T extends number | string>(
  a: T | null,
  b: T | null,
  order: DealSortOrder
): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const result = a < b ? -1 : 1;
  return order === 'asc' ? result : -result;
}

/** Open deals before won and lost ones */
const closedLast = (a: DealCard, b: DealCard) =>
  Number(!isOpenStage(a.stage)) - Number(!isOpenStage(b.stage));

/**
 * The deals in the sort's order. `deals` come in the board's order, which a sort keeps among
 * equal values (the sort is stable). By expected close date, the open deals come first in both
 * directions (#720): won and lost deals wait for no close date, so they do not mix with the
 * overdue ones.
 */
export function sortDeals(deals: readonly DealCard[], sort: DealSort): DealCard[] {
  const list = [...deals];
  switch (sort.by) {
    case 'amount':
      return list.sort((a, b) => compareNullable(a.amount, b.amount, sort.order));
    case 'expectedCloseOn':
      return list.sort(
        (a, b) =>
          closedLast(a, b) || compareNullable(a.expectedCloseOn, b.expectedCloseOn, sort.order)
      );
    default: {
      const index = (deal: DealCard) => DEAL_STAGES.indexOf(deal.stage);
      return list.sort((a, b) =>
        sort.order === 'asc' ? index(a) - index(b) : index(b) - index(a)
      );
    }
  }
}
