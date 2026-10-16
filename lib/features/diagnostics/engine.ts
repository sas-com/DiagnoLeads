import type {
  AnswerValidationIssue,
  AnswerValidationResult,
  ConditionalSection,
  DiagnosticAnswers,
  DiagnosticDefinition,
} from './types';

/**
 * The parts of a definition the engine needs. Code-defined diagnostics (DiagnosticDefinition)
 * and builder definitions (lib/features/diagnosis-builder) both satisfy it.
 */
export interface EngineDefinition<Q extends EngineQuestion = EngineQuestion> {
  sections: readonly ConditionalSection[];
  questions: readonly Q[];
}

export interface EngineQuestion {
  id: string;
  required: boolean;
}

/** A choice question as far as answer checks are concerned */
export interface ChoiceQuestion {
  type: 'single' | 'multiple';
  options: readonly { value: string }[];
  exclusiveOptions?: readonly string[];
}

/** Result of checking one non-empty answer against its question */
export type AnswerCheck<V> =
  | { ok: true; value: V }
  | { ok: false; code: AnswerValidationIssue['code'] };

/**
 * Sections shown for the given answers, in order.
 * A condition may only refer to a question in an earlier section, so one pass is enough.
 */
export function shownSections<S extends ConditionalSection>(
  definition: { sections: readonly S[] },
  answers: Record<string, unknown>
): S[] {
  const shown: S[] = [];
  const applicable = new Set<string>();
  for (const section of definition.sections) {
    const condition = section.showWhen;
    if (condition) {
      const value = answers[condition.questionId];
      const met =
        applicable.has(condition.questionId) &&
        typeof value === 'string' &&
        condition.anyOf.includes(value);
      if (!met) continue;
    }
    shown.push(section);
    for (const id of section.questionIds) applicable.add(id);
  }
  return shown;
}

/** Questions that apply to the given answers (each once, in the order they are shown) */
export function applicableQuestions<Q extends EngineQuestion>(
  definition: EngineDefinition<Q>,
  answers: Record<string, unknown>
): Q[] {
  const byId = new Map(definition.questions.map((q) => [q.id, q]));
  const ids = new Set(shownSections(definition, answers).flatMap((s) => s.questionIds));
  return [...ids].flatMap((id) => byId.get(id) ?? []);
}

/** Drop answers to questions that no longer apply (e.g. after switching the migration path) */
export function pruneAnswers<V>(
  definition: EngineDefinition,
  answers: Record<string, V>
): Record<string, V> {
  const ids = new Set(applicableQuestions(definition, answers).map((q) => q.id));
  return Object.fromEntries(Object.entries(answers).filter(([id]) => ids.has(id)));
}

/**
 * Check a non-empty answer to a choice question: single → one known option,
 * multiple → known options without duplicates, an exclusive option only on its own.
 */
export function checkChoiceAnswer(
  question: ChoiceQuestion,
  value: unknown
): AnswerCheck<string | string[]> {
  const allowed = new Set(question.options.map((o) => o.value));
  if (question.type === 'single') {
    if (typeof value !== 'string') return { ok: false, code: 'invalid_type' };
    if (!allowed.has(value)) return { ok: false, code: 'invalid_option' };
    return { ok: true, value };
  }

  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    return { ok: false, code: 'invalid_type' };
  }
  const selected = [...new Set(value as string[])];
  if (selected.some((v) => !allowed.has(v))) return { ok: false, code: 'invalid_option' };
  const exclusive = question.exclusiveOptions ?? [];
  if (selected.length > 1 && selected.some((v) => exclusive.includes(v))) {
    return { ok: false, code: 'exclusive_conflict' };
  }
  return { ok: true, value: selected };
}

/**
 * Validate raw answers against any engine definition, checking each non-empty answer with
 * `checkValue`. Unknown questions are rejected; only questions in shown sections apply: they are
 * required as defined, and answers to the others are rejected.
 */
export function validateAnswersWith<Q extends EngineQuestion, V>(
  definition: EngineDefinition<Q>,
  raw: Record<string, unknown>,
  checkValue: (question: Q, value: unknown) => AnswerCheck<V>
):
  | { success: true; answers: Record<string, V> }
  | { success: false; issues: AnswerValidationIssue[] } {
  const issues: AnswerValidationIssue[] = [];
  const candidates: Record<string, V> = {};
  const known = new Set(definition.questions.map((q) => q.id));

  for (const questionId of Object.keys(raw)) {
    if (!known.has(questionId)) issues.push({ questionId, code: 'unknown_question' });
  }

  const empty = new Set<string>();
  for (const question of definition.questions) {
    const value = raw[question.id];
    const isEmpty =
      value === undefined ||
      value === null ||
      value === '' ||
      (Array.isArray(value) && value.length === 0);

    if (isEmpty) {
      empty.add(question.id);
      continue;
    }

    const checked = checkValue(question, value);
    if (checked.ok) candidates[question.id] = checked.value;
    else issues.push({ questionId: question.id, code: checked.code });
  }

  // Applicability depends on the (valid) answers to the questions that select a path
  const applicable = new Set(applicableQuestions(definition, candidates).map((q) => q.id));
  const answers: Record<string, V> = {};
  for (const question of definition.questions) {
    if (!applicable.has(question.id)) {
      if (question.id in candidates)
        issues.push({ questionId: question.id, code: 'not_applicable' });
      continue;
    }
    if (empty.has(question.id)) {
      if (question.required) issues.push({ questionId: question.id, code: 'required' });
      continue;
    }
    if (question.id in candidates) answers[question.id] = candidates[question.id];
  }

  return issues.length > 0 ? { success: false, issues } : { success: true, answers };
}

/**
 * Validate raw answers against a code-defined diagnostic.
 * Unknown questions and options are rejected so that stored answers always match the definition.
 * Only questions in shown sections apply: they are required as defined, and answers to the
 * others are rejected (the client drops them when the respondent switches paths).
 */
export function validateAnswers(
  definition: DiagnosticDefinition,
  raw: Record<string, unknown>
): AnswerValidationResult {
  return validateAnswersWith(definition, raw, checkChoiceAnswer);
}

/** Read a single-choice answer */
export function single(answers: DiagnosticAnswers, questionId: string): string | undefined {
  const value = answers[questionId];
  return typeof value === 'string' ? value : undefined;
}

/** Read a multiple-choice answer (always an array) */
export function multiple(answers: DiagnosticAnswers, questionId: string): string[] {
  const value = answers[questionId];
  return Array.isArray(value) ? value : [];
}

/** Clamp a number into 0..100 and round it */
export function toPercent(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / max) * 100)));
}
