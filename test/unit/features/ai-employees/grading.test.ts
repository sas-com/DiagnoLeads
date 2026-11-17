/**
 * How an AI employee is graded (#1190): the facts of a period come from the records, a promotion
 * is recommended only when every part of the bar is met, a narrowing comes first, and the reviews
 * are monthly.
 */
import {
  nextReviewAt,
  promotionChecks,
  recommend,
  reviewFacts,
  reviewPeriodStart,
  shouldNarrow,
} from '@/lib/features/ai-employees/grading';
import {
  LEVEL_KEYS,
  PROMOTION_BARS,
  REVIEW_INTERVAL_DAYS,
  toLevel,
} from '@/lib/features/ai-employees/types/levels';
import { describe, expect, it } from 'vitest';

const NOW = new Date('2026-11-15T00:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

const facts = (over: Partial<ReturnType<typeof reviewFacts>> = {}) => ({
  ...reviewFacts({
    hiredAt: daysAgo(120),
    levelSince: daysAgo(100),
    runs: { succeeded: 200, failed: 0, other: 0, processed: 900 },
    proposals: { answered: 200, approved: 200 },
    now: NOW,
  }),
  ...over,
});

describe('reviewFacts', () => {
  it('counts days, runs and the failure rate from the records', () => {
    expect(
      reviewFacts({
        hiredAt: daysAgo(40),
        levelSince: daysAgo(10),
        runs: { succeeded: 8, failed: 2, other: 0, processed: 30 },
        proposals: null,
        now: NOW,
      })
    ).toEqual({
      daysEmployed: 40,
      daysAtLevel: 10,
      runs: 10,
      succeededRuns: 8,
      failedRuns: 2,
      processed: 30,
      failureRate: 0.2,
      proposals: null,
    });
  });

  it('has no failure rate without a run', () => {
    const none = reviewFacts({
      hiredAt: NOW,
      levelSince: NOW,
      runs: { succeeded: 0, failed: 0, other: 0, processed: 0 },
      proposals: null,
      now: NOW,
    });
    expect(none.failureRate).toBeNull();
  });
});

describe('recommend', () => {
  it('promotes only when every part of the bar is met', () => {
    for (const level of [1, 2, 3] as const) {
      expect(recommend(level, facts())).toBe('promote');
      expect(promotionChecks(level, facts()).every((check) => check.met)).toBe(true);
    }
    const bar = PROMOTION_BARS[1];
    expect(recommend(1, facts({ daysAtLevel: bar.minDaysAtLevel - 1 }))).toBe('keep');
    expect(recommend(1, facts({ succeededRuns: bar.minSucceededRuns - 1 }))).toBe('keep');
    expect(recommend(1, facts({ failureRate: bar.maxFailureRate + 0.01 }))).toBe('keep');
    expect(recommend(1, facts({ proposals: { answered: 100, approved: 70 } }))).toBe('keep');
  });

  it('never promotes without a record of the proposals: the bar is not guessed', () => {
    expect(recommend(1, facts({ proposals: null }))).toBe('keep');
    expect(
      promotionChecks(1, facts({ proposals: null })).find((check) => check.key === 'approvalRate')
    ).toEqual({ key: 'approvalRate', met: false });
  });

  it('has no bar for a trainee (the onboarding raises it) nor for the ace', () => {
    expect(promotionChecks(0, facts())).toEqual([]);
    expect(recommend(0, facts())).toBe('keep');
    expect(recommend(4, facts())).toBe('keep');
  });

  it('narrows a full member or more whose runs fail too often, before anything else', () => {
    const failing = facts({ runs: 20, failedRuns: 5, failureRate: 0.25 });
    expect(shouldNarrow(2, failing)).toBe(true);
    expect(recommend(3, failing)).toBe('narrow');
    // Never below probation by itself, and not on a handful of runs
    expect(shouldNarrow(1, failing)).toBe(false);
    expect(shouldNarrow(2, facts({ runs: 5, failedRuns: 3, failureRate: 0.6 }))).toBe(false);
  });
});

describe('the reviews', () => {
  it('may be held right after the onboarding, then every 30 days, never in training', () => {
    expect(nextReviewAt({ level: 0, onboardedAt: null, lastReviewAt: null })).toBeNull();
    expect(nextReviewAt({ level: 1, onboardedAt: daysAgo(3), lastReviewAt: null })).toEqual(
      daysAgo(3)
    );
    expect(nextReviewAt({ level: 1, onboardedAt: daysAgo(90), lastReviewAt: daysAgo(10) })).toEqual(
      new Date(daysAgo(10).getTime() + REVIEW_INTERVAL_DAYS * 86_400_000)
    );
    expect(reviewPeriodStart({ onboardedAt: daysAgo(90), lastReviewAt: null })).toEqual(daysAgo(90));
    expect(reviewPeriodStart({ onboardedAt: daysAgo(90), lastReviewAt: daysAgo(10) })).toEqual(
      daysAgo(10)
    );
  });
});

describe('the grades', () => {
  it('are the five milestones, and a stored value is kept within them', () => {
    expect(Object.values(LEVEL_KEYS)).toEqual(['training', 'probation', 'member', 'lead', 'ace']);
    expect(toLevel(2)).toBe(2);
    expect(toLevel(9)).toBe(4);
    expect(toLevel(-1)).toBe(0);
  });
});
