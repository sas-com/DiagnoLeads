/**
 * Tallies for the phased delivery (Refs #159): how many deals go on from phase 1 (the survey) to
 * phase 2 (the migration) and phase 3 (AX), and how long it takes, from the dates each deal phase
 * was first reached; and the diagnosis next to what the delivery reviews recorded, to revise its
 * scoring. Pure functions; the service reads the rows.
 */
import type { DealPhase } from '@/lib/features/leads/types/pipeline';
import type { CheckpointOutcome, DifficultyLevel } from './types/schemas';
import { DIFFICULTY_LEVELS } from './types/schemas';

/** Phase 1 → 2 → 3 of the phased delivery, as deal phases */
export const DELIVERY_PHASES = [
  'survey_won',
  'migration_won',
  'ax',
] as const satisfies readonly DealPhase[];
export type DeliveryPhase = (typeof DELIVERY_PHASES)[number];

/** Phases from which a deal has a delivery to review */
export const isDeliveryPhase = (phase: string): phase is DeliveryPhase =>
  (DELIVERY_PHASES as readonly string[]).includes(phase);

export interface PhaseStep {
  from: DeliveryPhase;
  to: DeliveryPhase;
  /** Deals that reached `from` */
  started: number;
  /** Of those, deals that reached `to` */
  advanced: number;
  /** advanced / started in percent (one decimal); null when none started */
  rate: number | null;
  /** Median days from `from` to `to`; null when none advanced */
  medianDays: number | null;
}

export interface PhaseProgress {
  reached: Record<DeliveryPhase, number>;
  steps: PhaseStep[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const isDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
const percent = (part: number, whole: number) =>
  whole === 0 ? null : Math.round((part / whole) * 1000) / 10;

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * From the deal phase dates of the organization's leads. A deal counts for a step only when it
 * has the date of both phases (one set straight to phase 2 does not start the 1 → 2 step); a date
 * pair in the wrong order counts as advanced but not for the days.
 */
export function phaseProgress(
  rows: { dealPhaseReachedAt: Record<string, unknown> }[]
): PhaseProgress {
  const reached = Object.fromEntries(DELIVERY_PHASES.map((phase) => [phase, 0])) as Record<
    DeliveryPhase,
    number
  >;
  for (const row of rows) {
    for (const phase of DELIVERY_PHASES) {
      if (isDate(row.dealPhaseReachedAt[phase])) reached[phase] += 1;
    }
  }
  const steps = DELIVERY_PHASES.slice(0, -1).map((from, index) => {
    const to = DELIVERY_PHASES[index + 1];
    let started = 0;
    let advanced = 0;
    const days: number[] = [];
    for (const row of rows) {
      const start = row.dealPhaseReachedAt[from];
      if (!isDate(start)) continue;
      started += 1;
      const end = row.dealPhaseReachedAt[to];
      if (!isDate(end)) continue;
      advanced += 1;
      const span = daysBetween(start, end);
      if (span >= 0) days.push(span);
    }
    return {
      from,
      to,
      started,
      advanced,
      rate: percent(advanced, started),
      medianDays: median(days),
    };
  });
  return { reached, steps };
}

export interface ReviewForReport {
  checkpointOutcomes: Record<string, unknown>;
  actualDifficulty: string | null;
  estimatedEffort: number | null;
  actualEffort: number | null;
  /** The lead's latest AX diagnosis; null when it has none */
  diagnosis: { checkpoints: string[]; difficulty: DifficultyLevel | null } | null;
}

export interface CheckpointAccuracy {
  key: string;
  /** Reviews whose diagnosis pointed it out, with an outcome recorded */
  flagged: number;
  /** Outcomes of those */
  outcomes: Record<CheckpointOutcome, number>;
  /** Hard although the diagnosis did not point it out */
  missed: number;
}

export interface EffortDeviation {
  /** Reviews with both an estimate (above zero) and the actual effort */
  count: number;
  /** Mean of (actual - estimate) / estimate in percent (one decimal) */
  meanPercent: number | null;
  /** Reviews that took more than estimated */
  over: number;
}

export interface DiagnosisAccuracy {
  reviewed: number;
  /** Reviews of leads with an AX diagnosis */
  withDiagnosis: number;
  checkpoints: CheckpointAccuracy[];
  /** difficulty[diagnosis level][actual level] = reviews */
  difficulty: Record<DifficultyLevel, Record<DifficultyLevel, number>>;
  /** Share of reviews with both levels where they match, in percent */
  difficultyMatchRate: number | null;
  effort: EffortDeviation;
  /** The same per diagnosis difficulty level */
  effortByDifficulty: Record<DifficultyLevel, EffortDeviation>;
}

const isOutcome = (value: unknown): value is CheckpointOutcome =>
  value === 'hard' || value === 'as_expected' || value === 'not_relevant';
const isLevel = (value: unknown): value is DifficultyLevel =>
  (DIFFICULTY_LEVELS as readonly unknown[]).includes(value);

function effortDeviation(reviews: ReviewForReport[]): EffortDeviation {
  const deviations = reviews.flatMap((review) =>
    review.estimatedEffort !== null && review.estimatedEffort > 0 && review.actualEffort !== null
      ? [(review.actualEffort - review.estimatedEffort) / review.estimatedEffort]
      : []
  );
  return {
    count: deviations.length,
    meanPercent:
      deviations.length === 0
        ? null
        : Math.round(
            (deviations.reduce((sum, value) => sum + value, 0) / deviations.length) * 1000
          ) / 10,
    over: deviations.filter((value) => value > 0).length,
  };
}

export function diagnosisAccuracy(reviews: ReviewForReport[]): DiagnosisAccuracy {
  const byKey = new Map<string, CheckpointAccuracy>();
  const entry = (key: string) => {
    let found = byKey.get(key);
    if (!found) {
      found = {
        key,
        flagged: 0,
        outcomes: { hard: 0, as_expected: 0, not_relevant: 0 },
        missed: 0,
      };
      byKey.set(key, found);
    }
    return found;
  };
  const difficulty = Object.fromEntries(
    DIFFICULTY_LEVELS.map((level) => [
      level,
      Object.fromEntries(DIFFICULTY_LEVELS.map((actual) => [actual, 0])),
    ])
  ) as DiagnosisAccuracy['difficulty'];
  let compared = 0;
  let matched = 0;

  for (const review of reviews) {
    const flagged = new Set(review.diagnosis?.checkpoints ?? []);
    for (const [key, outcome] of Object.entries(review.checkpointOutcomes)) {
      if (!isOutcome(outcome)) continue;
      if (flagged.has(key)) {
        const row = entry(key);
        row.flagged += 1;
        row.outcomes[outcome] += 1;
      } else if (review.diagnosis && outcome === 'hard') {
        entry(key).missed += 1;
      }
    }
    const predicted = review.diagnosis?.difficulty;
    if (isLevel(predicted) && isLevel(review.actualDifficulty)) {
      difficulty[predicted][review.actualDifficulty] += 1;
      compared += 1;
      if (predicted === review.actualDifficulty) matched += 1;
    }
  }

  return {
    reviewed: reviews.length,
    withDiagnosis: reviews.filter((review) => review.diagnosis).length,
    // Most often pointed out or missed first
    checkpoints: [...byKey.values()].sort(
      (a, b) => b.flagged + b.missed - (a.flagged + a.missed) || a.key.localeCompare(b.key)
    ),
    difficulty,
    difficultyMatchRate: percent(matched, compared),
    effort: effortDeviation(reviews),
    effortByDifficulty: Object.fromEntries(
      DIFFICULTY_LEVELS.map((level) => [
        level,
        effortDeviation(reviews.filter((review) => review.diagnosis?.difficulty === level)),
      ])
    ) as Record<DifficultyLevel, EffortDeviation>,
  };
}
