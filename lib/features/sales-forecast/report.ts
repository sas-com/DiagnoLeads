/**
 * Forecast figures and the week's pipeline changes (Refs #437), as pure functions over what the
 * database returns (./service.ts), so the rules are fixed by unit tests.
 *
 * - Won: deals won on a day of the period. The open deals count in the period of their expected
 *   close date, in their forecast category (lib/features/deals/types/pipeline.ts).
 * - Forecast = won + commit; best case adds the best-case deals. Achievement = won / target.
 * - The week's changes compare each deal now with how it stood a week ago (deal_history).
 */
import { DEAL_STAGES, isOpenStage } from '@/lib/features/deals/types/pipeline';

/** What the database sums for one owner (or for nobody) over the period */
export interface ForecastFigures {
  won: number;
  commit: number;
  bestCase: number;
  pipeline: number;
  /** Weighted amount of the open deals expected in the period */
  weighted: number;
  /** Open deals expected in the period, and those of them without an amount */
  openCount: number;
  noAmountCount: number;
}

export interface ForecastRow extends ForecastFigures {
  /** Sum of the months' targets; null when none is set */
  target: number | null;
  /** won + commit */
  forecast: number;
  /** won + commit + best case */
  bestCaseTotal: number;
  /** won / target; null without a target */
  achievement: number | null;
  /** forecast / target; null without a target */
  forecastAchievement: number | null;
  /** target - forecast (negative when the forecast is above the target); null without one */
  gap: number | null;
}

export const EMPTY_FIGURES: ForecastFigures = {
  won: 0,
  commit: 0,
  bestCase: 0,
  pipeline: 0,
  weighted: 0,
  openCount: 0,
  noAmountCount: 0,
};

export function sumFigures(list: ForecastFigures[]): ForecastFigures {
  return list.reduce<ForecastFigures>(
    (sum, figures) => ({
      won: sum.won + figures.won,
      commit: sum.commit + figures.commit,
      bestCase: sum.bestCase + figures.bestCase,
      pipeline: sum.pipeline + figures.pipeline,
      weighted: sum.weighted + figures.weighted,
      openCount: sum.openCount + figures.openCount,
      noAmountCount: sum.noAmountCount + figures.noAmountCount,
    }),
    EMPTY_FIGURES
  );
}

const ratio = (value: number, target: number | null) =>
  target && target > 0 ? value / target : null;

export function forecastRow(figures: ForecastFigures, target: number | null): ForecastRow {
  const forecast = figures.won + figures.commit;
  return {
    ...figures,
    target,
    forecast,
    bestCaseTotal: forecast + figures.bestCase,
    achievement: ratio(figures.won, target),
    forecastAchievement: ratio(forecast, target),
    gap: target === null ? null : target - forecast,
  };
}

/**
 * The organization's target for the period: for each month, the organization-wide target when
 * one is set, else the sum of the members' targets; null when no month has any target.
 */
export function organizationTarget(
  months: string[],
  targets: { userId: string | null; month: string; amount: number }[]
): number | null {
  let total: number | null = null;
  for (const month of months) {
    const ofMonth = targets.filter((target) => target.month === month);
    if (ofMonth.length === 0) continue;
    const organizationWide = ofMonth.find((target) => target.userId === null);
    const amount = organizationWide
      ? organizationWide.amount
      : ofMonth.reduce((sum, target) => sum + target.amount, 0);
    total = (total ?? 0) + amount;
  }
  return total;
}

/** A member's target for the period: the sum of their months; null when none is set */
export function memberTarget(
  userId: string,
  targets: { userId: string | null; month: string; amount: number }[]
): number | null {
  const own = targets.filter((target) => target.userId === userId);
  return own.length === 0 ? null : own.reduce((sum, target) => sum + target.amount, 0);
}

export interface DealState {
  stage: string;
  amount: number | null;
  expectedCloseOn: string | null;
}

export interface DealChangeInput extends DealState {
  id: string;
  name: string;
  ownerName: string | null;
  /** How the deal stood a week ago; null when it was created since */
  before: DealState | null;
}

export const CHANGE_KINDS = [
  'created',
  'advanced',
  'movedBack',
  'won',
  'lost',
  'reopened',
  'slipped',
] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

export interface ChangedDeal {
  id: string;
  name: string;
  ownerName: string | null;
  stage: string;
  amount: number | null;
  expectedCloseOn: string | null;
  before: DealState | null;
}

export interface ChangeGroup {
  count: number;
  /** Sum of the deals' current amounts */
  amount: number;
  deals: ChangedDeal[];
}

export interface PipelineChanges {
  groups: Record<ChangeKind, ChangeGroup>;
  /** Net change of the amounts of deals that existed a week ago and are still open */
  amountDelta: number;
}

/** Deals listed per group; the counts and amounts include them all */
export const CHANGED_DEALS_SHOWN = 20;

const stageIndex = (stage: string) => (DEAL_STAGES as readonly string[]).indexOf(stage);

/** The groups a deal falls in (a deal created and won in the week is in both) */
export function changeKinds(deal: DealChangeInput): ChangeKind[] {
  const kinds: ChangeKind[] = [];
  const { before } = deal;
  const openNow = isOpenStage(deal.stage);
  if (!before) {
    kinds.push('created');
    if (deal.stage === 'won') kinds.push('won');
    if (deal.stage === 'lost') kinds.push('lost');
    return kinds;
  }
  const openBefore = isOpenStage(before.stage);
  if (openBefore && deal.stage === 'won') kinds.push('won');
  else if (openBefore && deal.stage === 'lost') kinds.push('lost');
  else if (!openBefore && openNow) kinds.push('reopened');
  else if (openBefore && openNow) {
    if (stageIndex(deal.stage) > stageIndex(before.stage)) kinds.push('advanced');
    if (stageIndex(deal.stage) < stageIndex(before.stage)) kinds.push('movedBack');
  }
  if (
    openBefore &&
    openNow &&
    before.expectedCloseOn &&
    (deal.expectedCloseOn === null || deal.expectedCloseOn > before.expectedCloseOn)
  ) {
    kinds.push('slipped');
  }
  return kinds;
}

export function classifyChanges(deals: DealChangeInput[]): PipelineChanges {
  const groups = Object.fromEntries(
    CHANGE_KINDS.map((kind) => [kind, { count: 0, amount: 0, deals: [] }])
  ) as unknown as Record<ChangeKind, ChangeGroup>;
  let amountDelta = 0;
  for (const deal of deals) {
    for (const kind of changeKinds(deal)) {
      const group = groups[kind];
      group.count += 1;
      group.amount += deal.amount ?? 0;
      if (group.deals.length < CHANGED_DEALS_SHOWN) {
        group.deals.push({
          id: deal.id,
          name: deal.name,
          ownerName: deal.ownerName,
          stage: deal.stage,
          amount: deal.amount,
          expectedCloseOn: deal.expectedCloseOn,
          before: deal.before,
        });
      }
    }
    if (deal.before && isOpenStage(deal.before.stage) && isOpenStage(deal.stage)) {
      amountDelta += (deal.amount ?? 0) - (deal.before.amount ?? 0);
    }
  }
  return { groups, amountDelta };
}
