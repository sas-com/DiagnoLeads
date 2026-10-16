import type {
  DiagnosticAnswers,
  DiagnosticLocale,
  DiagnosticQuestion,
} from '@/lib/features/diagnostics/types';

/**
 * A question as the respondent sees it, with texts already in the respondent's language.
 * Code-defined diagnostics (localized texts) and builder definitions (plain texts) both map to
 * this. Only choice questions for now; scale, number_range and text join the union later.
 */
export interface ChoiceQuestionView {
  id: string;
  type: 'single' | 'multiple';
  label: string;
  description?: string;
  required: boolean;
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

export type QuestionView = ChoiceQuestionView;

/** A code-defined question in the given language */
export function localizeQuestion(
  question: DiagnosticQuestion,
  locale: DiagnosticLocale
): ChoiceQuestionView {
  return {
    id: question.id,
    type: question.type,
    label: question.label[locale],
    description: question.description?.[locale],
    required: question.required,
    options: question.options.map((option) => ({
      value: option.value,
      label: option.label[locale],
      hint: option.hint?.[locale],
    })),
    exclusiveOptions: question.exclusiveOptions,
  };
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
  return Object.fromEntries(
    Object.entries(answers).filter(([id, value]) => {
      const question = questions.find((q) => q.id === id);
      if (!question) return false;
      const choices = question.options.map((option) => option.value);
      return question.type === 'single'
        ? typeof value === 'string' && choices.includes(value)
        : Array.isArray(value) &&
            value.length > 0 &&
            value.every((v) => typeof v === 'string' && choices.includes(v));
    })
  ) as DiagnosticAnswers;
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
