import type { PublicDiagnosisDefinition } from '@/lib/features/diagnosis-builder/evaluate';
import type {
  DiagnosticAnswers,
  DiagnosticLocale,
  DiagnosticQuestion,
} from '@/lib/features/diagnostics/types';

/**
 * A question as the respondent sees it, with texts already in the respondent's language.
 * Code-defined diagnostics (localized texts, choice questions only) and builder definitions
 * (plain texts, all five types) both map to this. Empty texts are dropped (undefined), so the
 * parts only test for undefined.
 */
interface QuestionViewBase {
  id: string;
  label: string;
  description?: string;
  required: boolean;
}

export interface ChoiceQuestionView extends QuestionViewBase {
  type: 'single' | 'multiple';
  options: ChoiceOptionView[];
  /** Options that cannot be combined with others in a multiple-choice question */
  exclusiveOptions?: string[];
}

export interface ChoiceOptionView {
  value: string;
  label: string;
  /** One-line explanation under the label */
  hint?: string;
}

/** Whole numbers from min to max, chosen as buttons */
export interface ScaleQuestionView extends QuestionViewBase {
  type: 'scale';
  min: number;
  max: number;
  minLabel?: string;
  maxLabel?: string;
}

/** A number typed in, between min and max in steps of `step` from min */
export interface NumberRangeQuestionView extends QuestionViewBase {
  type: 'number_range';
  min: number;
  max: number;
  step?: number;
  unit?: string;
}

export interface TextQuestionView extends QuestionViewBase {
  type: 'text';
  maxLength: number;
  multiline?: boolean;
}

export type QuestionView =
  | ChoiceQuestionView
  | ScaleQuestionView
  | NumberRangeQuestionView
  | TextQuestionView;

/** Answer to any question: choice → string / string[], scale and number → number, text → string */
export type AnswerValue = string | string[] | number;
export type RunnerAnswers = Record<string, AnswerValue>;

/** Blank texts (possible in builder definitions) count as absent */
const text = (value: string | undefined): string | undefined =>
  value === undefined || value.trim() === '' ? undefined : value;

/** A code-defined question in the given language */
export function localizeQuestion(
  question: DiagnosticQuestion,
  locale: DiagnosticLocale
): ChoiceQuestionView {
  return {
    id: question.id,
    type: question.type,
    label: question.label[locale],
    description: text(question.description?.[locale]),
    required: question.required,
    options: question.options.map((option) => ({
      value: option.value,
      label: option.label[locale],
      hint: text(option.hint?.[locale]),
    })),
    exclusiveOptions: question.exclusiveOptions,
  };
}

type PublicQuestion = PublicDiagnosisDefinition['questions'][number];

/** A question of a published builder definition (toPublicDefinition: no points) */
export function toQuestionView(question: PublicQuestion): QuestionView {
  const base = {
    id: question.id,
    label: question.label,
    description: text(question.description),
    required: question.required,
  };
  switch (question.type) {
    case 'single':
    case 'multiple':
      return {
        ...base,
        type: question.type,
        options: question.options.map((o) => ({
          value: o.value,
          label: o.label,
          hint: text(o.hint),
        })),
        exclusiveOptions: question.exclusiveOptions,
      };
    case 'scale':
      return {
        ...base,
        type: 'scale',
        min: question.min,
        max: question.max,
        minLabel: text(question.minLabel),
        maxLabel: text(question.maxLabel),
      };
    case 'number_range':
      return {
        ...base,
        type: 'number_range',
        min: question.min,
        max: question.max,
        step: question.step,
        unit: text(question.unit),
      };
    case 'text':
      return {
        ...base,
        type: 'text',
        maxLength: question.maxLength,
        multiline: question.multiline,
      };
  }
}

/** Whether a question has no answer yet (an empty selection or blank text counts as none) */
export function isEmptyAnswer(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** True when value is min + k × step (with some tolerance for decimals), as the server checks */
export function isOnStep(value: number, min: number, step = 1): boolean {
  const k = (value - min) / step;
  return Math.abs(k - Math.round(k)) < 1e-9;
}

/** Whether a (non-empty) answer still fits its question; saved answers are checked with it */
export function isValidAnswer(question: QuestionShape, value: unknown): boolean {
  switch (question.type) {
    case 'single':
    case 'multiple': {
      const choices = question.options.map((option) => option.value);
      return question.type === 'single'
        ? typeof value === 'string' && choices.includes(value)
        : Array.isArray(value) &&
            value.length > 0 &&
            value.every((v) => typeof v === 'string' && choices.includes(v));
    }
    case 'scale':
      return (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= question.min &&
        value <= question.max
      );
    case 'number_range':
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= question.min &&
        value <= question.max &&
        isOnStep(value, question.min, question.step)
      );
    case 'text':
      return typeof value === 'string' && value.length <= question.maxLength;
  }
}

/** The parts of a question needed to check a saved answer */
export type QuestionShape =
  | ChoiceShape
  | { id: string; type: 'scale'; min: number; max: number }
  | { id: string; type: 'number_range'; min: number; max: number; step?: number }
  | { id: string; type: 'text'; maxLength: number };

/** Answers that still fit their question, by type (anything saved before a change is dropped) */
export function keepValidAnswers(
  questions: readonly QuestionShape[],
  answers: Record<string, unknown>
): RunnerAnswers {
  return Object.fromEntries(
    Object.entries(answers).filter(([id, value]) => {
      const question = questions.find((q) => q.id === id);
      return question !== undefined && !isEmptyAnswer(value) && isValidAnswer(question, value);
    })
  ) as RunnerAnswers;
}

/** The parts of a choice question needed to check a saved answer */
interface ChoiceShape {
  id: string;
  type: 'single' | 'multiple';
  options: readonly { value: string }[];
}

/** Answers that are still choices of their question (anything saved before a change is dropped) */
export function keepValidChoiceAnswers(
  questions: readonly ChoiceShape[],
  answers: Record<string, unknown>
): DiagnosticAnswers {
  return keepValidAnswers(questions, answers) as DiagnosticAnswers;
}

/**
 * The next answer of a multiple-choice question after an option was (un)checked. An exclusive
 * option ("none", "don't know") clears the others, and any other option clears the exclusive ones.
 * `clearedOthers` tells whether checking the option removed earlier choices.
 */
export function toggleChoice(
  current: readonly string[],
  value: string,
  checked: boolean,
  exclusive: readonly string[] = []
): { next: string[]; clearedOthers: boolean } {
  let next: string[];
  if (!checked) {
    next = current.filter((v) => v !== value);
  } else if (exclusive.includes(value)) {
    next = [value];
  } else {
    next = [...current.filter((v) => !exclusive.includes(v)), value];
  }
  return { next, clearedOthers: checked && next.length < current.length + 1 };
}
