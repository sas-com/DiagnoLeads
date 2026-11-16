/**
 * How an AI employee is graded (#1190): the facts of a review period, counted from the records,
 * and what they recommend. Pure, shared by the service and the screen.
 */
import {
  type AiEmployeeLevel,
  NARROWING_BAR,
  PROMOTION_BARS,
  REVIEW_INTERVAL_DAYS,
  TOP_LEVEL,
  TRAINING_LEVEL,
} from './types/levels';

const DAY_MS = 24 * 60 * 60 * 1000;

/** What a review counts. Every number comes from the records, never from the employee */
export interface ReviewFacts {
  /** Days since the employee was hired */
  daysEmployed: number;
  /** Days since its grade was given */
  daysAtLevel: number;
  runs: number;
  succeededRuns: number;
  failedRuns: number;
  /** Items handled by the runs that succeeded */
  processed: number;
  /** failedRuns / runs; null without a run */
  failureRate: number | null;
  /**
   * Proposals answered by a person, and how many were approved as they were. Null until the
   * works hand in proposals (no record to count yet): the bar is then not met, never guessed
   */
  proposals: { answered: number; approved: number } | null;
}

export type ReviewRecommendation = 'promote' | 'keep' | 'narrow';

/** Why a review recommends what it does: each part of the bar, met or not */
export interface BarCheck {
  key: 'daysAtLevel' | 'succeededRuns' | 'failureRate' | 'approvalRate';
  met: boolean;
}

export function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS));
}

/** The facts of a period from the counts of its runs and the dates of the employee */
export function reviewFacts(input: {
  hiredAt: Date;
  levelSince: Date;
  runs: { succeeded: number; failed: number; other: number; processed: number };
  proposals: { answered: number; approved: number } | null;
  now: Date;
}): ReviewFacts {
  const { runs } = input;
  const total = runs.succeeded + runs.failed + runs.other;
  return {
    daysEmployed: daysBetween(input.hiredAt, input.now),
    daysAtLevel: daysBetween(input.levelSince, input.now),
    runs: total,
    succeededRuns: runs.succeeded,
    failedRuns: runs.failed,
    processed: runs.processed,
    failureRate: total === 0 ? null : runs.failed / total,
    proposals: input.proposals,
  };
}

/** Each part of the bar to rise from `level` (empty for a trainee and for the ace) */
export function promotionChecks(level: AiEmployeeLevel, facts: ReviewFacts): BarCheck[] {
  if (level === TRAINING_LEVEL || level === TOP_LEVEL) return [];
  const bar = PROMOTION_BARS[level];
  const approved =
    facts.proposals !== null &&
    facts.proposals.answered >= bar.minProposals &&
    facts.proposals.approved / facts.proposals.answered >= bar.minApprovalRate;
  return [
    { key: 'daysAtLevel', met: facts.daysAtLevel >= bar.minDaysAtLevel },
    { key: 'succeededRuns', met: facts.succeededRuns >= bar.minSucceededRuns },
    {
      key: 'failureRate',
      met: facts.failureRate !== null && facts.failureRate <= bar.maxFailureRate,
    },
    { key: 'approvalRate', met: approved },
  ];
}

/** Whether the records call for a lower grade: only from a full member up (the safe side) */
export function shouldNarrow(level: AiEmployeeLevel, facts: ReviewFacts): boolean {
  if (level < 2) return false;
  return (
    facts.runs >= NARROWING_BAR.minRuns &&
    facts.failureRate !== null &&
    facts.failureRate > NARROWING_BAR.maxFailureRate
  );
}

/** What a review recommends: narrow first, promote only when every part of the bar is met */
export function recommend(level: AiEmployeeLevel, facts: ReviewFacts): ReviewRecommendation {
  if (shouldNarrow(level, facts)) return 'narrow';
  const checks = promotionChecks(level, facts);
  if (checks.length > 0 && checks.every((check) => check.met)) return 'promote';
  return 'keep';
}

/**
 * When the next review may be held: right after the onboarding was approved for the first one
 * (so the president sees where the employee starts), then every REVIEW_INTERVAL_DAYS days.
 * Null while the employee is in training.
 */
export function nextReviewAt(input: {
  level: AiEmployeeLevel;
  onboardedAt: Date | null;
  lastReviewAt: Date | null;
}): Date | null {
  if (input.level === TRAINING_LEVEL || !input.onboardedAt) return null;
  if (!input.lastReviewAt) return input.onboardedAt;
  return new Date(input.lastReviewAt.getTime() + REVIEW_INTERVAL_DAYS * DAY_MS);
}

/** The start of a review period: the last review, or the onboarding for the first */
export function reviewPeriodStart(input: { onboardedAt: Date; lastReviewAt: Date | null }): Date {
  return input.lastReviewAt ?? input.onboardedAt;
}
