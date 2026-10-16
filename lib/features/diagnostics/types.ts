/**
 * Code-defined diagnostics
 *
 * A diagnostic is defined in TypeScript (questions, options and scoring rules)
 * and evaluated on the server only. Clients receive a public view without scores.
 */

export type DiagnosticLocale = 'ja' | 'en';

export type LocalizedText = Record<DiagnosticLocale, string>;

export interface DiagnosticOption {
  value: string;
  label: LocalizedText;
  /** One-line explanation under the label (plain words for non-specialist respondents) */
  hint?: LocalizedText;
}

export interface DiagnosticQuestion {
  id: string;
  type: 'single' | 'multiple';
  label: LocalizedText;
  description?: LocalizedText;
  required: boolean;
  options: DiagnosticOption[];
  /** Options that cannot be combined with others in a multiple-choice question */
  exclusiveOptions?: string[];
  /**
   * Optional follow-up shown collapsed ("answer in more detail"). Must not be required:
   * answering improves the estimate, skipping it never blocks the respondent.
   */
  detail?: boolean;
}

/** Show a section only when a single-choice answer is one of the given values */
export interface DiagnosticCondition {
  questionId: string;
  anyOf: string[];
}

/**
 * The parts of a section the engine needs. Code-defined diagnostics and builder definitions
 * (lib/features/diagnosis-builder) both have this shape, so they share one engine.
 */
export interface ConditionalSection {
  id: string;
  questionIds: string[];
  showWhen?: DiagnosticCondition;
}

export interface DiagnosticSection extends ConditionalSection {
  id: string;
  title: LocalizedText;
  /**
   * A question may appear in several sections (e.g. the same question on two migration
   * paths); it applies when at least one section that lists it is shown.
   */
  questionIds: string[];
  /** Without a condition the section is always shown */
  showWhen?: DiagnosticCondition;
}

export interface DiagnosticDefinition {
  key: string;
  /** Increment when questions or scoring change so stored results stay interpretable */
  version: number;
  title: LocalizedText;
  description: LocalizedText;
  sections: DiagnosticSection[];
  questions: DiagnosticQuestion[];
}

/** Normalized answers: single → string, multiple → string[] */
export type DiagnosticAnswers = Record<string, string | string[]>;

export interface AnswerValidationIssue {
  questionId: string;
  code:
    | 'required'
    | 'invalid_option'
    | 'invalid_type'
    | 'exclusive_conflict'
    | 'unknown_question'
    /** Answered a question that does not apply to the chosen path */
    | 'not_applicable'
    /** A number outside the question's range or step (builder definitions only) */
    | 'out_of_range'
    /** A text answer longer than the question allows (builder definitions only) */
    | 'too_long';
}

export type AnswerValidationResult =
  | { success: true; answers: DiagnosticAnswers }
  | { success: false; issues: AnswerValidationIssue[] };
