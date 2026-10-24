import { z } from 'zod';

/**
 * Deal pipeline definitions shared by DB, API and UI (Refs #435, Epic #430).
 *
 * A deal is one thing to sell to a lead: the AX migration is sold in steps (a survey of the
 * current system, then the migration, then AX), so a lead can have several deals. Values are
 * stored as text and checked with zod (like lib/features/leads/types/pipeline.ts). Labels live
 * in locales/{ja,en}/common.json under `deals`.
 */

/** 現行調査 / 移行 / AX 化 / 保守・運用 / その他 */
export const DEAL_KINDS = ['survey', 'migration', 'ax', 'maintenance', 'other'] as const;
export const dealKindEnum = z.enum(DEAL_KINDS);
export type DealKind = z.infer<typeof dealKindEnum>;

/** Open stages in sales order: 見極め / 課題の確認 / 提案 / 条件の調整 */
export const OPEN_DEAL_STAGES = ['qualification', 'discovery', 'proposal', 'negotiation'] as const;
export type OpenDealStage = (typeof OPEN_DEAL_STAGES)[number];

/** The open stages, then the two outcomes: 受注 / 失注 */
export const DEAL_STAGES = [...OPEN_DEAL_STAGES, 'won', 'lost'] as const;
export const dealStageEnum = z.enum(DEAL_STAGES);
export type DealStage = z.infer<typeof dealStageEnum>;

export const CLOSED_DEAL_STAGES = ['won', 'lost'] as const satisfies readonly DealStage[];

export const isOpenStage = (stage: string): stage is OpenDealStage =>
  (OPEN_DEAL_STAGES as readonly string[]).includes(stage);

/**
 * Probability (%) a deal starts with when it enters the stage; the rep can change it per deal.
 * Initial values, to be confirmed with sales (Epic #430).
 */
export const STAGE_PROBABILITY: Record<DealStage, number> = {
  qualification: 10,
  discovery: 20,
  proposal: 40,
  negotiation: 70,
  won: 100,
  lost: 0,
};

/** Categories a rep can put an open deal in; without one it follows the probability */
export const FORECAST_OVERRIDES = ['pipeline', 'best_case', 'commit', 'omitted'] as const;
export const forecastOverrideEnum = z.enum(FORECAST_OVERRIDES);
export type ForecastOverride = z.infer<typeof forecastOverrideEnum>;

/** Where a deal counts in the forecast: an override, or `closed` / `lost` once decided */
export type ForecastCategory = ForecastOverride | 'closed' | 'lost';

/** Probability from which an open deal counts as commit / best case (initial values) */
export const COMMIT_PROBABILITY = 70;
export const BEST_CASE_PROBABILITY = 40;

export function forecastCategory(deal: {
  stage: string;
  probability: number;
  forecastOverride: string | null;
}): ForecastCategory {
  if (deal.stage === 'won') return 'closed';
  if (deal.stage === 'lost') return 'lost';
  if ((FORECAST_OVERRIDES as readonly string[]).includes(deal.forecastOverride ?? '')) {
    return deal.forecastOverride as ForecastOverride;
  }
  if (deal.probability >= COMMIT_PROBABILITY) return 'commit';
  if (deal.probability >= BEST_CASE_PROBABILITY) return 'best_case';
  return 'pipeline';
}

/** Amount weighted by the probability, in yen (rounded down) */
export function weightedAmount(deal: { amount: number | null; probability: number }): number {
  return deal.amount ? Math.floor((deal.amount * deal.probability) / 100) : 0;
}
