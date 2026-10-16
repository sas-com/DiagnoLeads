/**
 * Scoring of builder definitions (server only)
 *
 * `evaluate` is pure and takes only answers that passed `validateDiagnosisAnswers`: points come
 * from the definition, never from the request. Respondents get `toPublicResult` (no lead score,
 * no MQL, no raw points) and `toPublicDefinition` (no scores or rules).
 */
import { applicableQuestions, toPercent } from '../diagnostics/engine';
import type { ValidatedAnswers } from './answers';
import {
  DEFINITION_LIMITS,
  type DiagnosisAnswerValue,
  type DiagnosisCondition,
  type DiagnosisConditionGroup,
  type DiagnosisDefinition,
  type DiagnosisQuestion,
  type DiagnosisResultBlock,
  type DiagnosisTierSet,
} from './definition';

export interface AxisScore {
  /** Points scored on the applicable questions */
  raw: number;
  /** Lowest and highest points possible on the questions that applied to this respondent */
  min: number;
  max: number;
  /** (raw − min) / (max − min) as a whole percentage; 0 when the range is empty */
  pct: number;
}

export type MqlReason =
  | { code: 'required_not_met'; index: number }
  | { code: 'min_score_reached' }
  | { code: 'below_min_score' }
  /** minScore is null and no strong signal matched */
  | { code: 'no_strong_signal' }
  /** reason: the signal's text from the definition (shown to sales) */
  | { code: 'strong_signal'; signalId: string; reason: string }
  /** A consultation request (相談申込) is always a strong signal, as in the AX diagnosis (#139) */
  | { code: 'consultation' };

/**
 * The same two levels as the AX diagnosis (#139, lib/features/diagnostics/ax-migration/mql.ts):
 * - `fit` (適合): every required condition is met
 * - `interest` (関心あり（MQL）): fit, plus a strong signal or the minimum score. Only this sets
 *   the lead's MQL date
 * - `none` (対象外): a required condition is not met
 */
export type DiagnosisMqlLevel = 'interest' | 'fit' | 'none';

export interface DiagnosisMql {
  level: DiagnosisMqlLevel;
  /** level === 'interest' */
  qualified: boolean;
  reasons: MqlReason[];
}

export interface DiagnosisEvaluation {
  axes: Record<string, AxisScore>;
  /** Weighted average of the axis percentages (axes with an empty range are left out) */
  overall: number;
  /** Tier reached per tier set (null when no tier covers the percentage) */
  tiers: Record<string, string | null>;
  resultTypeId: string | null;
  /**
   * points: sum of the matched rules kept within 0..100 (the AX scale); reasons: the texts of
   * the matched rules, in definition order
   */
  leadScore: { points: number; reasons: string[] };
  mql: DiagnosisMql;
}

export interface PublicDiagnosisResult {
  axes: Record<string, { pct: number }>;
  overall: number;
  tiers: Record<string, string | null>;
  resultTypeId: string | null;
}

interface Range {
  min: number;
  max: number;
}

/** Lowest and highest of the given totals (0 is possible when the question may be skipped) */
const rangeOf = (totals: number[], required: boolean): Range => {
  const all = required && totals.length > 0 ? totals : [...totals, 0];
  return { min: Math.min(...all), max: Math.max(...all) };
};

/** Range of a multiple-choice total: any non-empty mix of normal options, or one exclusive one */
function multipleRange(normal: number[], exclusive: number[], required: boolean): Range {
  const totals = [...exclusive];
  if (normal.length > 0) {
    const positive = normal.filter((s) => s > 0);
    const negative = normal.filter((s) => s < 0);
    totals.push(
      positive.length > 0 ? positive.reduce((a, b) => a + b, 0) : Math.max(...normal),
      negative.length > 0 ? negative.reduce((a, b) => a + b, 0) : Math.min(...normal)
    );
  }
  return rangeOf(totals, required);
}

/** Whether the bands leave a number in min..max without points (then 0 is possible) */
function bandsLeaveGap(question: Extract<DiagnosisQuestion, { type: 'number_range' }>): boolean {
  const step = question.step ?? 1;
  const bands = [...(question.bands ?? [])].sort((a, b) => a.min - b.min);
  let cursor = question.min;
  for (const band of bands) {
    if (band.min > cursor) return true;
    cursor = Math.max(cursor, band.max + step);
    if (cursor > question.max) return false;
  }
  return cursor <= question.max;
}

function numberBand(question: Extract<DiagnosisQuestion, { type: 'number_range' }>, n: number) {
  return (question.bands ?? []).find((band) => n >= band.min && n <= band.max);
}

/** Points a question gives on one axis for the answer, and the range it could give */
function questionScore(
  question: DiagnosisQuestion,
  answer: DiagnosisAnswerValue | undefined,
  axisId: string
): { points: number; range: Range } {
  switch (question.type) {
    case 'single': {
      const scoreOf = (value: string) =>
        question.options.find((o) => o.value === value)?.scores?.[axisId] ?? 0;
      return {
        points: typeof answer === 'string' ? scoreOf(answer) : 0,
        range: rangeOf(
          question.options.map((o) => o.scores?.[axisId] ?? 0),
          question.required
        ),
      };
    }
    case 'multiple': {
      const exclusive = new Set(question.exclusiveOptions ?? []);
      const scoreOf = (value: string) =>
        question.options.find((o) => o.value === value)?.scores?.[axisId] ?? 0;
      const selected = Array.isArray(answer) ? answer : [];
      return {
        points: selected.reduce((sum, value) => sum + scoreOf(value), 0),
        range: multipleRange(
          question.options.filter((o) => !exclusive.has(o.value)).map((o) => scoreOf(o.value)),
          question.options.filter((o) => exclusive.has(o.value)).map((o) => scoreOf(o.value)),
          question.required
        ),
      };
    }
    case 'scale': {
      const full = question.scores?.[axisId] ?? 0;
      const span = question.max - question.min;
      const points =
        typeof answer === 'number' && span > 0 ? (full * (answer - question.min)) / span : 0;
      // At the low end of the scale the question gives 0, the same as skipping it
      return { points, range: rangeOf([0, full], true) };
    }
    case 'number_range': {
      const band = typeof answer === 'number' ? numberBand(question, answer) : undefined;
      const totals = (question.bands ?? []).map((b) => b.scores[axisId] ?? 0);
      return {
        points: band?.scores[axisId] ?? 0,
        range: rangeOf(totals, question.required && !bandsLeaveGap(question)),
      };
    }
    case 'text':
      return { points: 0, range: { min: 0, max: 0 } };
  }
}

/** Lead scores use the same 0–100 scale as the AX diagnosis */
export const clampLeadScore = (points: number): number =>
  Math.max(DEFINITION_LIMITS.leadScoreMin, Math.min(DEFINITION_LIMITS.leadScoreMax, points));

/** The tier containing pct: minPct ≤ pct < maxPct, and a tier ending at 100 includes 100 */
export function findTier(tierSet: DiagnosisTierSet, pct: number): string | null {
  const found = tierSet.tiers.find(
    (t) => pct >= t.minPct && (pct < t.maxPct || (t.maxPct === 100 && pct === 100))
  );
  return found?.id ?? null;
}

interface ConditionContext {
  answers: ValidatedAnswers;
  axes: Record<string, AxisScore>;
  overall: number;
  tiers: Record<string, string | null>;
}

function conditionMet(condition: DiagnosisCondition, ctx: ConditionContext): boolean {
  switch (condition.type) {
    case 'answer': {
      const value = ctx.answers[condition.questionId];
      if (typeof value === 'string') return condition.anyOf.includes(value);
      if (Array.isArray(value)) return value.some((v) => condition.anyOf.includes(v));
      return false;
    }
    case 'number': {
      const value = ctx.answers[condition.questionId];
      return (
        typeof value === 'number' &&
        value >= (condition.min ?? Number.NEGATIVE_INFINITY) &&
        value <= (condition.max ?? Number.POSITIVE_INFINITY)
      );
    }
    case 'score': {
      const pct = condition.axisId === undefined ? ctx.overall : ctx.axes[condition.axisId]?.pct;
      if (pct === undefined) return false;
      return pct >= (condition.minPct ?? 0) && pct <= (condition.maxPct ?? 100);
    }
    case 'tier': {
      const reached = ctx.tiers[condition.tierSetId];
      return reached != null && condition.anyOf.includes(reached);
    }
  }
}

function groupMet(group: DiagnosisConditionGroup, ctx: ConditionContext): boolean {
  if (group.conditions.length === 0) return true;
  return group.match === 'all'
    ? group.conditions.every((c) => conditionMet(c, ctx))
    : group.conditions.some((c) => conditionMet(c, ctx));
}

/**
 * Score validated answers. Only questions in shown sections count, both for the points and for
 * the range they are compared with, so a respondent on a shorter path is not marked down.
 */
export function evaluate(
  definition: DiagnosisDefinition,
  answers: ValidatedAnswers
): DiagnosisEvaluation {
  const questions = applicableQuestions(definition, answers);
  const applicableAnswers = Object.fromEntries(
    questions.flatMap((q) => (q.id in answers ? [[q.id, answers[q.id]]] : []))
  ) as ValidatedAnswers;

  const axes: Record<string, AxisScore> = {};
  let weighted = 0;
  let totalWeight = 0;
  for (const axis of definition.axes) {
    let raw = 0;
    let min = 0;
    let max = 0;
    for (const question of questions) {
      const score = questionScore(question, applicableAnswers[question.id], axis.id);
      raw += score.points;
      min += score.range.min;
      max += score.range.max;
    }
    const pct = toPercent(raw - min, max - min);
    axes[axis.id] = { raw, min, max, pct };
    if (max > min) {
      weighted += pct * axis.weight;
      totalWeight += axis.weight;
    }
  }
  const overall = totalWeight > 0 ? Math.round(weighted / totalWeight) : 0;

  const tiers: Record<string, string | null> = {};
  for (const tierSet of definition.tierSets) {
    const pct = tierSet.axisId === undefined ? overall : (axes[tierSet.axisId]?.pct ?? 0);
    tiers[tierSet.id] = findTier(tierSet, pct);
  }

  const ctx: ConditionContext = { answers: applicableAnswers, axes, overall, tiers };
  const resultTypeId = definition.resultTypes.find((t) => groupMet(t.when, ctx))?.id ?? null;

  const matchedRules = definition.leadScore.rules.filter((rule) => groupMet(rule.when, ctx));
  const leadScore = {
    points: clampLeadScore(matchedRules.reduce((sum, rule) => sum + rule.points, 0)),
    reasons: matchedRules.map((rule) => rule.reason),
  };

  return {
    axes,
    overall,
    tiers,
    resultTypeId,
    leadScore,
    mql: evaluateMql(definition, ctx, leadScore.points),
  };
}

function evaluateMql(
  definition: DiagnosisDefinition,
  ctx: ConditionContext,
  points: number
): DiagnosisMql {
  const reasons: MqlReason[] = [];
  definition.mql.required.forEach((condition, index) => {
    if (!conditionMet(condition, ctx)) reasons.push({ code: 'required_not_met', index });
  });
  if (reasons.length > 0) return { level: 'none', qualified: false, reasons };

  const { minScore } = definition.mql;
  const scoreMet = minScore !== null && points >= minScore;
  if (scoreMet) reasons.push({ code: 'min_score_reached' });
  for (const signal of definition.mql.strongSignals) {
    if (groupMet(signal.when, ctx)) {
      reasons.push({ code: 'strong_signal', signalId: signal.id, reason: signal.reason });
    }
  }
  const qualified = reasons.length > 0;
  if (minScore === null) {
    if (!qualified) reasons.push({ code: 'no_strong_signal' });
  } else if (!scoreMet) {
    reasons.push({ code: 'below_min_score' });
  }
  return { level: qualified ? 'interest' : 'fit', qualified, reasons };
}

/**
 * The judgement with a consultation request added: a fit respondent becomes `interest`
 * (関心あり), as in the AX diagnosis. A respondent outside the required conditions stays `none`.
 */
export function withConsultationSignal(mql: DiagnosisMql): DiagnosisMql {
  if (mql.level === 'none' || mql.reasons.some((r) => r.code === 'consultation')) return mql;
  return {
    level: 'interest',
    qualified: true,
    reasons: [
      { code: 'consultation' },
      ...mql.reasons.filter((r) => r.code !== 'no_strong_signal' && r.code !== 'below_min_score'),
    ],
  };
}

/** What the respondent may see: percentages, tiers and the result type only */
export function toPublicResult(evaluation: DiagnosisEvaluation): PublicDiagnosisResult {
  return {
    axes: Object.fromEntries(
      Object.entries(evaluation.axes).map(([axisId, score]) => [axisId, { pct: score.pct }])
    ),
    overall: evaluation.overall,
    tiers: { ...evaluation.tiers },
    resultTypeId: evaluation.resultTypeId,
  };
}

/**
 * The definition as sent to the respondent's browser: built field by field (never by copying
 * and deleting) so that points, weights, bands, conditions and lead rules cannot leak even when
 * the schema grows.
 */
export function toPublicDefinition(definition: DiagnosisDefinition) {
  return {
    schemaVersion: definition.schemaVersion,
    locale: definition.locale,
    title: definition.title,
    description: definition.description,
    sections: definition.sections.map((s) => ({
      id: s.id,
      title: s.title,
      questionIds: [...s.questionIds],
      showWhen: s.showWhen && { questionId: s.showWhen.questionId, anyOf: [...s.showWhen.anyOf] },
    })),
    questions: definition.questions.map(publicQuestion),
    axes: definition.axes.map((a) => ({ id: a.id, name: a.name })),
    tierSets: definition.tierSets.map((set) => ({
      id: set.id,
      axisId: set.axisId,
      tiers: set.tiers.map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        minPct: t.minPct,
        maxPct: t.maxPct,
        description: t.description,
      })),
    })),
    resultTypes: definition.resultTypes.map((t) => ({
      id: t.id,
      name: t.name,
      summary: t.summary,
    })),
    resultBlocks: definition.resultBlocks.map(publicBlock),
    consent: definition.consent && {
      version: definition.consent.version,
      text: definition.consent.text,
      privacyPolicyUrl: definition.consent.privacyPolicyUrl,
    },
  };
}

export type PublicDiagnosisDefinition = ReturnType<typeof toPublicDefinition>;

function publicQuestion(question: DiagnosisQuestion) {
  const base = {
    id: question.id,
    label: question.label,
    description: question.description,
    required: question.required,
  };
  switch (question.type) {
    case 'single':
    case 'multiple':
      return {
        ...base,
        type: question.type,
        options: question.options.map((o) => ({ value: o.value, label: o.label, hint: o.hint })),
        exclusiveOptions:
          question.type === 'multiple' ? [...(question.exclusiveOptions ?? [])] : undefined,
      };
    case 'scale':
      return {
        ...base,
        type: question.type,
        min: question.min,
        max: question.max,
        minLabel: question.minLabel,
        maxLabel: question.maxLabel,
      };
    case 'number_range':
      return {
        ...base,
        type: question.type,
        min: question.min,
        max: question.max,
        step: question.step,
        unit: question.unit,
      };
    case 'text':
      return {
        ...base,
        type: question.type,
        maxLength: question.maxLength,
        multiline: question.multiline,
      };
  }
}

function publicBlock(block: DiagnosisResultBlock): DiagnosisResultBlock {
  const onlyFor = block.onlyFor && [...block.onlyFor];
  switch (block.type) {
    case 'heading':
    case 'text':
      return { type: block.type, text: block.text, onlyFor };
    case 'score':
      return { type: block.type, axisId: block.axisId, onlyFor };
    case 'axisChart':
      return { type: block.type, onlyFor };
    case 'tierText':
      return { type: block.type, tierSetId: block.tierSetId, texts: { ...block.texts }, onlyFor };
    case 'cta':
      return { type: block.type, label: block.label, url: block.url, onlyFor };
  }
}
