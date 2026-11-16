/**
 * The grades of the AI employees (#1190, decision 2026-11-14-training-room-grows-employees): the
 * same milestones as a person who joins a company. The grade sets how much the employee is
 * trusted to do. Only the president raises it, at a review; it is lowered by itself when the
 * records fall below the bar (the safe side). The words of each grade are in
 * locales/{ja,en}/aiOffice.json under aiOffice.levels.
 */

/** 0 in training, 1 on probation, 2 full member, 3 lead, 4 ace */
export const AI_EMPLOYEE_LEVELS = [0, 1, 2, 3, 4] as const;
export type AiEmployeeLevel = (typeof AI_EMPLOYEE_LEVELS)[number];

export const TRAINING_LEVEL = 0 satisfies AiEmployeeLevel;
export const PROBATION_LEVEL = 1 satisfies AiEmployeeLevel;
export const TOP_LEVEL = 4 satisfies AiEmployeeLevel;

/** The key of each grade in aiOffice.levels */
export const LEVEL_KEYS: Readonly<Record<AiEmployeeLevel, string>> = {
  0: 'training',
  1: 'probation',
  2: 'member',
  3: 'lead',
  4: 'ace',
};

export function isAiEmployeeLevel(value: number): value is AiEmployeeLevel {
  return (AI_EMPLOYEE_LEVELS as readonly number[]).includes(value);
}

/** A level read from the database, kept within the grades */
export function toLevel(value: number): AiEmployeeLevel {
  if (isAiEmployeeLevel(value)) return value;
  return value > TOP_LEVEL ? TOP_LEVEL : TRAINING_LEVEL;
}

/**
 * What an employee must have done at its grade before it may be recommended for the next one.
 * Provisional numbers (Epic #1187): the owner is asked to confirm them. Counted only from the
 * records (decision: never the employee's own word).
 */
export interface PromotionBar {
  /** Days since the grade was given */
  minDaysAtLevel: number;
  /** Runs that succeeded within the review period */
  minSucceededRuns: number;
  /** The share of the period's runs that failed, at most */
  maxFailureRate: number;
  /** Proposals answered within the period, at least, before the approval rate counts */
  minProposals: number;
  /** The share of answered proposals that were approved as they were, at least */
  minApprovalRate: number;
}

/** The bar to rise from each grade (a trainee rises by the onboarding, the ace does not rise) */
export const PROMOTION_BARS: Readonly<Record<1 | 2 | 3, PromotionBar>> = {
  1: {
    minDaysAtLevel: 30,
    minSucceededRuns: 20,
    maxFailureRate: 0.1,
    minProposals: 20,
    minApprovalRate: 0.8,
  },
  2: {
    minDaysAtLevel: 60,
    minSucceededRuns: 60,
    maxFailureRate: 0.05,
    minProposals: 50,
    minApprovalRate: 0.9,
  },
  3: {
    minDaysAtLevel: 90,
    minSucceededRuns: 120,
    maxFailureRate: 0.03,
    minProposals: 100,
    minApprovalRate: 0.95,
  },
};

/**
 * When the grade is lowered by itself: from a full member up, a period with at least this many
 * runs of which more than this share failed
 */
export const NARROWING_BAR = { minRuns: 10, maxFailureRate: 0.2 } as const;

/** Days between two reviews */
export const REVIEW_INTERVAL_DAYS = 30;
