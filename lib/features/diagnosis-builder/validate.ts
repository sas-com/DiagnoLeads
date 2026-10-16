/**
 * Checks a diagnosis definition before it can be published.
 *
 * Errors block publishing; warnings are shown but do not. Each issue carries the path inside the
 * definition and a code only: the builder UI maps codes to messages in locales/.
 * The server runs the same check again when publishing.
 */
import {
  DEFINITION_LIMITS,
  type DiagnosisCondition,
  type DiagnosisConditionGroup,
  type DiagnosisDefinition,
  type DiagnosisQuestion,
  diagnosisDefinitionSchema,
  isChoiceQuestion,
} from './definition';

export type DefinitionErrorCode =
  /** The JSON does not match the schema (detail: the zod issue code) */
  | 'schema_invalid'
  /** More than DEFINITION_LIMITS.maxQuestions questions (detail: the count) */
  | 'too_many_questions'
  | 'definition_too_large'
  | 'duplicate_id'
  | 'unknown_question'
  | 'unknown_option'
  | 'unknown_axis'
  | 'unknown_tier_set'
  | 'unknown_tier'
  | 'unknown_result_type'
  /** A section condition refers to a question in the same or a later section */
  | 'condition_forward_reference'
  /** A condition refers to a question of a type it cannot test */
  | 'condition_question_type'
  | 'unreachable_section'
  /** Not listed in any section that can be shown */
  | 'unreachable_question'
  /** A result type after one that always matches */
  | 'unreachable_result_type'
  | 'too_few_options'
  /** min must be below max (scales, number questions, bands, conditions) */
  | 'invalid_range'
  | 'band_overlap'
  | 'axes_missing'
  | 'duplicate_tier_target'
  | 'tier_range_invalid'
  | 'tier_gap'
  | 'tier_overlap'
  | 'consent_missing'
  /** CTA (or privacy policy) URL that is not https */
  | 'url_not_https';

export type DefinitionWarningCode =
  | 'many_questions'
  /** detail: estimated seconds */
  | 'long_estimated_time'
  /** A non-text question that gives no points on any axis */
  | 'question_without_score'
  /** No minimum score and no strong signal: no respondent can become an MQL */
  | 'mql_never_qualifies';

export type DefinitionPath = (string | number)[];

export interface DefinitionIssue<C extends string> {
  path: DefinitionPath;
  code: C;
  detail?: string;
}

export type DefinitionError = DefinitionIssue<DefinitionErrorCode>;
export type DefinitionWarning = DefinitionIssue<DefinitionWarningCode>;

export interface DefinitionValidationResult {
  errors: DefinitionError[];
  warnings: DefinitionWarning[];
  /** The parsed definition when the shape is valid (it may still have errors) */
  definition?: DiagnosisDefinition;
}

export const DEFINITION_WARNINGS = {
  questions: 12,
  estimatedSeconds: 5 * 60,
} as const;

/** Rough seconds per question by type, for the "takes more than 5 minutes" warning */
export const SECONDS_PER_QUESTION: Record<DiagnosisQuestion['type'], number> = {
  single: 10,
  multiple: 15,
  scale: 8,
  number_range: 12,
  text: 45,
};

/** Upper estimate: every question that can be shown, as if all paths were taken */
export function estimateSeconds(definition: DiagnosisDefinition): number {
  const listed = new Set(definition.sections.flatMap((s) => s.questionIds));
  return definition.questions
    .filter((q) => listed.has(q.id))
    .reduce((sum, q) => sum + SECONDS_PER_QUESTION[q.type], 0);
}

const isHttps = (value: string) => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

export function validateDefinition(input: unknown): DefinitionValidationResult {
  const errors: DefinitionError[] = [];
  const warnings: DefinitionWarning[] = [];

  const serialized = JSON.stringify(input) ?? '';
  if (new TextEncoder().encode(serialized).length > DEFINITION_LIMITS.maxSerializedBytes) {
    return { errors: [{ path: [], code: 'definition_too_large' }], warnings };
  }

  const parsed = diagnosisDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      errors: parsed.error.issues.map((issue) =>
        isTooManyQuestions(issue.path, issue.code)
          ? { path: issue.path, code: 'too_many_questions', detail: String(questionCount(input)) }
          : { path: issue.path, code: 'schema_invalid', detail: issue.code }
      ),
      warnings,
    };
  }
  const def = parsed.data;
  const error = (path: DefinitionPath, code: DefinitionErrorCode, detail?: string) =>
    errors.push(detail === undefined ? { path, code } : { path, code, detail });

  const questionById = new Map(def.questions.map((q) => [q.id, q]));
  const axisIds = new Set(def.axes.map((a) => a.id));
  const tierSetById = new Map(def.tierSets.map((s) => [s.id, s]));
  const resultTypeIds = new Set(def.resultTypes.map((t) => t.id));

  // Duplicate ids
  const checkUnique = (ids: string[], path: (index: number) => DefinitionPath) => {
    const seen = new Set<string>();
    ids.forEach((value, index) => {
      if (seen.has(value)) error(path(index), 'duplicate_id', value);
      seen.add(value);
    });
  };
  checkUnique(
    def.sections.map((s) => s.id),
    (i) => ['sections', i, 'id']
  );
  checkUnique(
    def.questions.map((q) => q.id),
    (i) => ['questions', i, 'id']
  );
  checkUnique(
    def.axes.map((a) => a.id),
    (i) => ['axes', i, 'id']
  );
  checkUnique(
    def.tierSets.map((s) => s.id),
    (i) => ['tierSets', i, 'id']
  );
  checkUnique(
    def.resultTypes.map((t) => t.id),
    (i) => ['resultTypes', i, 'id']
  );
  checkUnique(
    def.leadScore.rules.map((r) => r.id),
    (i) => ['leadScore', 'rules', i, 'id']
  );
  checkUnique(
    def.mql.strongSignals.map((s) => s.id),
    (i) => ['mql', 'strongSignals', i, 'id']
  );
  def.tierSets.forEach((set, s) => {
    checkUnique(
      set.tiers.map((t) => t.id),
      (i) => ['tierSets', s, 'tiers', i, 'id']
    );
  });

  const checkScores = (scores: Record<string, number> | undefined, path: DefinitionPath) => {
    for (const axisId of Object.keys(scores ?? {})) {
      if (!axisIds.has(axisId)) error([...path, axisId], 'unknown_axis', axisId);
    }
  };

  // Sections: references, conditions on earlier questions only, reachability
  const reachableQuestionIds = new Set<string>();
  def.sections.forEach((section, s) => {
    section.questionIds.forEach((questionId, i) => {
      if (!questionById.has(questionId)) {
        error(['sections', s, 'questionIds', i], 'unknown_question', questionId);
      }
    });

    let reachable = true;
    const condition = section.showWhen;
    if (condition) {
      const path = ['sections', s, 'showWhen'];
      const question = questionById.get(condition.questionId);
      if (!question) {
        error([...path, 'questionId'], 'unknown_question', condition.questionId);
        reachable = false;
      } else if (question.type !== 'single') {
        error([...path, 'questionId'], 'condition_question_type', condition.questionId);
        reachable = false;
      } else {
        const earlier = def.sections.slice(0, s).some((e) => e.questionIds.includes(question.id));
        if (!earlier) {
          error([...path, 'questionId'], 'condition_forward_reference', condition.questionId);
          reachable = false;
        } else {
          const values = new Set(question.options.map((o) => o.value));
          condition.anyOf.forEach((value, i) => {
            if (!values.has(value)) error([...path, 'anyOf', i], 'unknown_option', value);
          });
          // Shown only if the question is on a reachable earlier section and a value can match
          if (
            !reachableQuestionIds.has(question.id) ||
            !condition.anyOf.some((v) => values.has(v))
          ) {
            error(['sections', s], 'unreachable_section', section.id);
            reachable = false;
          }
        }
      }
    }
    if (reachable)
      for (const questionId of section.questionIds) reachableQuestionIds.add(questionId);
  });

  // Questions
  def.questions.forEach((question, q) => {
    const path = ['questions', q];
    if (!reachableQuestionIds.has(question.id)) {
      error(path, 'unreachable_question', question.id);
    }
    switch (question.type) {
      case 'single':
      case 'multiple': {
        if (question.options.length < 2) error([...path, 'options'], 'too_few_options');
        checkUnique(
          question.options.map((o) => o.value),
          (i) => [...path, 'options', i, 'value']
        );
        question.options.forEach((option, i) => {
          checkScores(option.scores, [...path, 'options', i, 'scores']);
        });
        if (question.type === 'multiple') {
          const values = new Set(question.options.map((o) => o.value));
          (question.exclusiveOptions ?? []).forEach((value, i) => {
            if (!values.has(value))
              error([...path, 'exclusiveOptions', i], 'unknown_option', value);
          });
        }
        break;
      }
      case 'scale':
        if (question.min >= question.max) error(path, 'invalid_range');
        checkScores(question.scores, [...path, 'scores']);
        break;
      case 'number_range': {
        if (question.min >= question.max) error(path, 'invalid_range');
        const bands = (question.bands ?? []).map((band, index) => ({ band, index }));
        for (const { band, index } of bands) {
          const bandPath = [...path, 'bands', index];
          if (band.min > band.max || band.min < question.min || band.max > question.max) {
            error(bandPath, 'invalid_range');
          }
          checkScores(band.scores, [...bandPath, 'scores']);
        }
        const sorted = [...bands].sort((a, b) => a.band.min - b.band.min);
        for (let i = 1; i < sorted.length; i++) {
          if (sorted[i].band.min <= sorted[i - 1].band.max) {
            error([...path, 'bands', sorted[i].index], 'band_overlap');
          }
        }
        break;
      }
      case 'text':
        break;
    }
  });

  // Axes and tiers
  if (def.axes.length === 0) error(['axes'], 'axes_missing');
  const tierTargets = new Set<string>();
  def.tierSets.forEach((set, s) => {
    const path = ['tierSets', s];
    if (set.axisId !== undefined && !axisIds.has(set.axisId)) {
      error([...path, 'axisId'], 'unknown_axis', set.axisId);
    }
    const target = set.axisId ?? '';
    if (tierTargets.has(target)) error(path, 'duplicate_tier_target', set.axisId);
    tierTargets.add(target);

    const tiers = set.tiers.map((tier, index) => ({ tier, index }));
    for (const { tier, index } of tiers) {
      if (tier.minPct >= tier.maxPct) error([...path, 'tiers', index], 'tier_range_invalid');
    }
    // Tiers must cover 0..100 exactly: each starts where the previous ends
    const sorted = [...tiers].sort((a, b) => a.tier.minPct - b.tier.minPct);
    if (sorted.length === 0) {
      error([...path, 'tiers'], 'tier_gap', '0');
      return;
    }
    if (sorted[0].tier.minPct > 0) error([...path, 'tiers', sorted[0].index], 'tier_gap', '0');
    let end = sorted[0].tier.maxPct;
    for (const { tier, index } of sorted.slice(1)) {
      if (tier.minPct > end) error([...path, 'tiers', index], 'tier_gap', String(end));
      if (tier.minPct < end) error([...path, 'tiers', index], 'tier_overlap', String(tier.minPct));
      end = Math.max(end, tier.maxPct);
    }
    if (end < 100) {
      error([...path, 'tiers', sorted[sorted.length - 1].index], 'tier_gap', String(end));
    }
  });

  // Conditions in result types, lead score rules and MQL rules
  const checkCondition = (condition: DiagnosisCondition, path: DefinitionPath) => {
    switch (condition.type) {
      case 'answer': {
        const question = questionById.get(condition.questionId);
        if (!question) return error([...path, 'questionId'], 'unknown_question');
        if (!isChoiceQuestion(question)) {
          return error([...path, 'questionId'], 'condition_question_type', question.id);
        }
        const values = new Set(question.options.map((o) => o.value));
        condition.anyOf.forEach((value, i) => {
          if (!values.has(value)) error([...path, 'anyOf', i], 'unknown_option', value);
        });
        return;
      }
      case 'number': {
        const question = questionById.get(condition.questionId);
        if (!question) return error([...path, 'questionId'], 'unknown_question');
        if (question.type !== 'scale' && question.type !== 'number_range') {
          return error([...path, 'questionId'], 'condition_question_type', question.id);
        }
        if (
          condition.min !== undefined &&
          condition.max !== undefined &&
          condition.min > condition.max
        ) {
          error(path, 'invalid_range');
        }
        return;
      }
      case 'score':
        if (condition.axisId !== undefined && !axisIds.has(condition.axisId)) {
          error([...path, 'axisId'], 'unknown_axis', condition.axisId);
        }
        if ((condition.minPct ?? 0) > (condition.maxPct ?? 100)) error(path, 'invalid_range');
        return;
      case 'tier': {
        const set = tierSetById.get(condition.tierSetId);
        if (!set) return error([...path, 'tierSetId'], 'unknown_tier_set', condition.tierSetId);
        const tierIds = new Set(set.tiers.map((t) => t.id));
        condition.anyOf.forEach((tierId, i) => {
          if (!tierIds.has(tierId)) error([...path, 'anyOf', i], 'unknown_tier', tierId);
        });
        return;
      }
    }
  };
  const checkGroup = (group: DiagnosisConditionGroup, path: DefinitionPath) => {
    group.conditions.forEach((c, i) => {
      checkCondition(c, [...path, 'conditions', i]);
    });
  };

  let fallbackSeen = false;
  def.resultTypes.forEach((type, t) => {
    if (fallbackSeen) error(['resultTypes', t], 'unreachable_result_type', type.id);
    if (type.when.conditions.length === 0) fallbackSeen = true;
    checkGroup(type.when, ['resultTypes', t, 'when']);
  });
  def.leadScore.rules.forEach((rule, r) => {
    checkGroup(rule.when, ['leadScore', 'rules', r, 'when']);
  });
  def.mql.required.forEach((c, i) => {
    checkCondition(c, ['mql', 'required', i]);
  });
  def.mql.strongSignals.forEach((signal, i) => {
    checkGroup(signal.when, ['mql', 'strongSignals', i, 'when']);
  });

  // Result blocks
  def.resultBlocks.forEach((block, b) => {
    const path = ['resultBlocks', b];
    (block.onlyFor ?? []).forEach((typeId, i) => {
      if (!resultTypeIds.has(typeId)) error([...path, 'onlyFor', i], 'unknown_result_type', typeId);
    });
    if (block.type === 'score' && block.axisId !== undefined && !axisIds.has(block.axisId)) {
      error([...path, 'axisId'], 'unknown_axis', block.axisId);
    }
    if (block.type === 'tierText') {
      const set = tierSetById.get(block.tierSetId);
      if (!set) {
        error([...path, 'tierSetId'], 'unknown_tier_set', block.tierSetId);
      } else {
        const tierIds = new Set(set.tiers.map((t) => t.id));
        for (const tierId of Object.keys(block.texts)) {
          if (!tierIds.has(tierId)) error([...path, 'texts', tierId], 'unknown_tier', tierId);
        }
      }
    }
    if (block.type === 'cta' && !isHttps(block.url)) error([...path, 'url'], 'url_not_https');
  });

  // Consent
  if (!def.consent || def.consent.text.trim() === '') {
    error(['consent'], 'consent_missing');
  } else if (def.consent.privacyPolicyUrl !== undefined && !isHttps(def.consent.privacyPolicyUrl)) {
    error(['consent', 'privacyPolicyUrl'], 'url_not_https');
  }

  // Warnings
  if (def.questions.length > DEFINITION_WARNINGS.questions) {
    warnings.push({
      path: ['questions'],
      code: 'many_questions',
      detail: String(def.questions.length),
    });
  }
  const seconds = estimateSeconds(def);
  if (seconds > DEFINITION_WARNINGS.estimatedSeconds) {
    warnings.push({ path: [], code: 'long_estimated_time', detail: String(seconds) });
  }
  def.questions.forEach((question, q) => {
    if (question.type !== 'text' && !givesPoints(question)) {
      warnings.push({
        path: ['questions', q],
        code: 'question_without_score',
        detail: question.id,
      });
    }
  });

  if (def.mql.minScore === null && def.mql.strongSignals.length === 0) {
    warnings.push({ path: ['mql'], code: 'mql_never_qualifies' });
  }

  return { errors, warnings, definition: def };
}

/** The schema caps the question list; that one limit gets its own code for the UI */
const isTooManyQuestions = (path: DefinitionPath, code: string) =>
  code === 'too_big' && path.length === 1 && path[0] === 'questions';

const questionCount = (input: unknown) => {
  const questions =
    typeof input === 'object' && input !== null ? Reflect.get(input, 'questions') : undefined;
  return Array.isArray(questions) ? questions.length : 0;
};

const hasPoints = (scores: Record<string, number> | undefined) =>
  Object.values(scores ?? {}).some((points) => points !== 0);

function givesPoints(question: DiagnosisQuestion): boolean {
  switch (question.type) {
    case 'single':
    case 'multiple':
      return question.options.some((o) => hasPoints(o.scores));
    case 'scale':
      return hasPoints(question.scores);
    case 'number_range':
      return (question.bands ?? []).some((b) => hasPoints(b.scores));
    case 'text':
      return false;
  }
}
