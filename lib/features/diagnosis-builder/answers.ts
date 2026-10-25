import { hasLoneSurrogate } from '@/lib/utils/clip-text';
import { type AnswerCheck, checkChoiceAnswer, validateAnswersWith } from '../diagnostics/engine';
import type { AnswerValidationIssue } from '../diagnostics/types';
import type { DiagnosisAnswerValue, DiagnosisDefinition, DiagnosisQuestion } from './definition';

declare const validatedBrand: unique symbol;

/**
 * Answers that passed `validateDiagnosisAnswers` for one definition. Only that function creates
 * them, so `evaluate` cannot be fed raw request data (or points sent by a respondent).
 */
export type ValidatedAnswers = Readonly<Record<string, DiagnosisAnswerValue>> & {
  readonly [validatedBrand]: true;
};

export type DiagnosisAnswerValidationResult =
  | { success: true; answers: ValidatedAnswers }
  | { success: false; issues: AnswerValidationIssue[] };

/** True when value is min + k × step (with some tolerance for decimals) */
const onStep = (value: number, min: number, step: number) => {
  const k = (value - min) / step;
  return Math.abs(k - Math.round(k)) < 1e-9;
};

function checkAnswer(
  question: DiagnosisQuestion,
  value: unknown
): AnswerCheck<DiagnosisAnswerValue> {
  switch (question.type) {
    case 'single':
    case 'multiple':
      return checkChoiceAnswer(question, value);
    case 'scale':
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        return { ok: false, code: 'invalid_type' };
      }
      if (value < question.min || value > question.max) return { ok: false, code: 'out_of_range' };
      return { ok: true, value };
    case 'number_range':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { ok: false, code: 'invalid_type' };
      }
      if (
        value < question.min ||
        value > question.max ||
        !onStep(value, question.min, question.step ?? 1)
      ) {
        return { ok: false, code: 'out_of_range' };
      }
      return { ok: true, value };
    case 'text':
      if (typeof value !== 'string') return { ok: false, code: 'invalid_type' };
      if (value.length > question.maxLength) return { ok: false, code: 'too_long' };
      // Answers are stored as jsonb, which rejects a lone surrogate and would fail the whole
      // submission; a browser never sends one, so it is refused rather than repaired (#754)
      if (hasLoneSurrogate(value)) return { ok: false, code: 'invalid_type' };
      return { ok: true, value };
  }
}

/**
 * Validate raw answers against a builder definition with the same rules as code-defined
 * diagnostics (unknown questions rejected, hidden sections not applicable, required checked).
 * Text answers are trimmed first, so whitespace counts as no answer.
 */
export function validateDiagnosisAnswers(
  definition: DiagnosisDefinition,
  raw: Record<string, unknown>
): DiagnosisAnswerValidationResult {
  const textIds = new Set(definition.questions.filter((q) => q.type === 'text').map((q) => q.id));
  const normalized = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [
      key,
      textIds.has(key) && typeof value === 'string' ? value.trim() : value,
    ])
  );
  const result = validateAnswersWith(definition, normalized, checkAnswer);
  if (!result.success) return result;
  return { success: true, answers: result.answers as ValidatedAnswers };
}
