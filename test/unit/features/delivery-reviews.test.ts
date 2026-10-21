/**
 * Phased delivery tallies and delivery reviews (#159): phase 1 → 2 → 3 rates and days, the
 * diagnosis checkpoints, difficulty and effort next to the reviews, the input schema and the
 * checkpoint labels. All values are made up.
 */
import { diagnosisAccuracy, median, phaseProgress } from '@/lib/features/delivery-reviews/report';
import { readDiagnosisSummary } from '@/lib/features/delivery-reviews/service';
import { deliveryReviewFieldsSchema } from '@/lib/features/delivery-reviews/types/schemas';
import { AX_CHECKPOINT_KEYS } from '@/lib/features/diagnostics/ax-migration/evaluate';
import en from '@/locales/en/common.json';
import ja from '@/locales/ja/common.json';
import { describe, expect, it } from 'vitest';

describe('phaseProgress', () => {
  it('counts the deals that went on from each phase and the median days', () => {
    const progress = phaseProgress([
      { dealPhaseReachedAt: { survey_won: '2026-01-10', migration_won: '2026-03-11', ax: '2026-09-01' } },
      { dealPhaseReachedAt: { survey_won: '2026-02-01', migration_won: '2026-03-03' } },
      { dealPhaseReachedAt: { survey_won: '2026-04-01' } },
      { dealPhaseReachedAt: { proposal: '2026-04-01', survey_won: '2026-05-01' } },
      // Set straight to phase 2: not a start of 1 → 2
      { dealPhaseReachedAt: { migration_won: '2026-06-01' } },
      // Not a date: ignored
      { dealPhaseReachedAt: { survey_won: 'yesterday' } },
    ]);
    expect(progress.reached).toEqual({ survey_won: 4, migration_won: 3, ax: 1 });
    expect(progress.steps).toEqual([
      // 60 and 30 days
      { from: 'survey_won', to: 'migration_won', started: 4, advanced: 2, rate: 50, medianDays: 45 },
      { from: 'migration_won', to: 'ax', started: 3, advanced: 1, rate: 33.3, medianDays: 174 },
    ]);
  });

  it('has no rate without deals, and leaves dates in the wrong order out of the days', () => {
    expect(phaseProgress([]).steps[0]).toMatchObject({ started: 0, rate: null, medianDays: null });
    const [step] = phaseProgress([
      { dealPhaseReachedAt: { survey_won: '2026-05-01', migration_won: '2026-04-01' } },
    ]).steps;
    expect(step).toMatchObject({ started: 1, advanced: 1, rate: 100, medianDays: null });
  });

  it('takes the median of odd and even counts', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('diagnosisAccuracy', () => {
  const review = (values: Partial<Parameters<typeof diagnosisAccuracy>[0][number]> = {}) => ({
    checkpointOutcomes: {},
    actualDifficulty: null,
    estimatedEffort: null,
    actualEffort: null,
    diagnosis: null,
    ...values,
  });

  it('puts the checkpoints the diagnosis pointed out next to how they turned out', () => {
    const accuracy = diagnosisAccuracy([
      review({
        checkpointOutcomes: { gaiji: 'hard', legacy_edi: 'as_expected', integrations_many: 'hard' },
        diagnosis: { checkpoints: ['gaiji', 'legacy_edi', 'rpg3'], difficulty: 'high' },
        actualDifficulty: 'high',
        estimatedEffort: 10,
        actualEffort: 13,
      }),
      review({
        checkpointOutcomes: { gaiji: 'not_relevant' },
        diagnosis: { checkpoints: ['gaiji'], difficulty: 'medium' },
        actualDifficulty: 'high',
        estimatedEffort: 4,
        actualEffort: 3,
      }),
      // No diagnosis: what was hard is not "missed"
      review({ checkpointOutcomes: { gaiji: 'hard', bogus: 'hard' }, actualDifficulty: 'low' }),
    ]);
    expect(accuracy).toMatchObject({ reviewed: 3, withDiagnosis: 2, difficultyMatchRate: 50 });
    expect(accuracy.checkpoints).toEqual([
      { key: 'gaiji', flagged: 2, outcomes: { hard: 1, as_expected: 0, not_relevant: 1 }, missed: 0 },
      { key: 'integrations_many', flagged: 0, outcomes: { hard: 0, as_expected: 0, not_relevant: 0 }, missed: 1 },
      { key: 'legacy_edi', flagged: 1, outcomes: { hard: 0, as_expected: 1, not_relevant: 0 }, missed: 0 },
    ]);
    expect(accuracy.difficulty.high.high).toBe(1);
    expect(accuracy.difficulty.medium.high).toBe(1);
    // +30% and -25%
    expect(accuracy.effort).toEqual({ count: 2, meanPercent: 2.5, over: 1 });
    expect(accuracy.effortByDifficulty.high).toEqual({ count: 1, meanPercent: 30, over: 1 });
    expect(accuracy.effortByDifficulty.low).toEqual({ count: 0, meanPercent: null, over: 0 });
  });

  it('leaves out an estimate of zero', () => {
    expect(diagnosisAccuracy([review({ estimatedEffort: 0, actualEffort: 2 })]).effort.count).toBe(0);
  });
});

describe('readDiagnosisSummary', () => {
  it('reads the checkpoints and the difficulty level of a stored result', () => {
    expect(
      readDiagnosisSummary({ checkpoints: ['gaiji', 3], difficulty: { level: 'high', score: 70 } })
    ).toEqual({ checkpoints: ['gaiji'], difficulty: 'high' });
    expect(readDiagnosisSummary(null)).toEqual({ checkpoints: [], difficulty: null });
  });
});

describe('deliveryReviewFieldsSchema', () => {
  it('rounds the effort, drops a blank note and fills defaults', () => {
    expect(
      deliveryReviewFieldsSchema.parse({ estimatedEffort: 3.14, actualEffort: 4, note: '  ' })
    ).toEqual({
      checkpointOutcomes: {},
      actualDifficulty: null,
      estimatedEffort: 3.1,
      actualEffort: 4,
      note: null,
    });
  });

  it('accepts only diagnosis checkpoint keys and known outcomes', () => {
    expect(deliveryReviewFieldsSchema.safeParse({ checkpointOutcomes: { gaiji: 'hard' } }).success).toBe(true);
    expect(deliveryReviewFieldsSchema.safeParse({ checkpointOutcomes: { other: 'hard' } }).success).toBe(false);
    expect(deliveryReviewFieldsSchema.safeParse({ checkpointOutcomes: { gaiji: 'easy' } }).success).toBe(false);
    expect(deliveryReviewFieldsSchema.safeParse({ estimatedEffort: -1 }).success).toBe(false);
  });

  it('has a short label for every checkpoint in each locale', () => {
    for (const messages of [ja, en]) {
      const labels = messages.deliveryReviews.checkpoints as Record<string, string>;
      expect(Object.keys(labels).sort()).toEqual([...AX_CHECKPOINT_KEYS].sort());
    }
  });
});
