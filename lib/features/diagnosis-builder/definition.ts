/**
 * Diagnosis definitions made in the builder
 *
 * A definition is stored as JSON (draft, then an immutable published copy) and evaluated on the
 * server only. It generalizes the code-defined diagnostics in lib/features/diagnostics/types.ts:
 * the same sections / showWhen / exclusiveOptions shape, plus more question types and scoring on
 * several axes. Respondents only ever receive `toPublicDefinition` (no points, no lead rules).
 *
 * The schema checks shape and size; cross references and ranges are checked by
 * `validateDefinition` so that a draft with mistakes can still be saved and shown with its errors.
 */
import { z } from 'zod';

export const DEFINITION_SCHEMA_VERSION = 1;

export const DEFINITION_LIMITS = {
  /** Publishing is not possible above this */
  maxQuestions: 60,
  maxSections: 60,
  maxOptions: 30,
  maxAxes: 10,
  maxTiersPerSet: 10,
  maxResultTypes: 20,
  maxResultBlocks: 40,
  maxRules: 50,
  maxConditions: 10,
  shortText: 200,
  longText: 2000,
  url: 2000,
  /** Points one option, band or rule can give or take */
  maxPoints: 100,
  /** Lead scores (and the MQL minimum score) are kept within 0..100, like the AX diagnosis */
  leadScoreMin: 0,
  leadScoreMax: 100,
  maxSerializedBytes: 200 * 1024,
} as const;

const L = DEFINITION_LIMITS;

/** Lower-case identifiers used for every id, option value and reason key */
export const ID_PATTERN = /^[a-z][a-z0-9_-]{0,39}$/;
const id = z.string().regex(ID_PATTERN);
const shortText = z.string().trim().min(1).max(L.shortText);
const longText = z.string().max(L.longText);
/** Only checked to be a URL here; `validateDefinition` requires https */
const url = z.string().max(L.url).url();
/** Theme values are hex colors only (never free CSS) */
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const points = z.number().int().min(-L.maxPoints).max(L.maxPoints);
const pct = z.number().min(0).max(100);
const finite = z.number().finite().min(-1e9).max(1e9);

/** Points per axis: `{ axisId: points }` */
const scores = z.record(id, points);

const option = z.object({
  value: id,
  label: shortText,
  /** One-line explanation under the label */
  hint: shortText.optional(),
  scores: scores.optional(),
});

const questionBase = {
  id,
  label: shortText,
  description: longText.optional(),
  required: z.boolean(),
};

const singleQuestion = z.object({
  ...questionBase,
  type: z.literal('single'),
  options: z.array(option).max(L.maxOptions),
});

const multipleQuestion = z.object({
  ...questionBase,
  type: z.literal('multiple'),
  options: z.array(option).max(L.maxOptions),
  /** Options that cannot be combined with others (e.g. "none of these") */
  exclusiveOptions: z.array(id).max(L.maxOptions).optional(),
});

/** Whole numbers from min to max; gives `scores` × (answer − min) / (max − min) */
const scaleQuestion = z.object({
  ...questionBase,
  type: z.literal('scale'),
  min: z.number().int().min(0).max(10),
  max: z.number().int().min(0).max(10),
  minLabel: shortText.optional(),
  maxLabel: shortText.optional(),
  scores: scores.optional(),
});

/** A number between `min` and `max` (both inclusive); its points come from the bands */
const numberBand = z.object({ min: finite, max: finite, scores });

const numberRangeQuestion = z.object({
  ...questionBase,
  type: z.literal('number_range'),
  min: finite,
  max: finite,
  /** Allowed increments from `min` (default 1) */
  step: z.number().positive().max(1e9).optional(),
  unit: z.string().max(20).optional(),
  /** First band containing the answer (min ≤ answer ≤ max) gives its points */
  bands: z.array(numberBand).max(L.maxOptions).optional(),
});

/** Free text; never scored */
const textQuestion = z.object({
  ...questionBase,
  type: z.literal('text'),
  maxLength: z.number().int().min(1).max(L.longText),
  multiline: z.boolean().optional(),
});

export const questionSchema = z.discriminatedUnion('type', [
  singleQuestion,
  multipleQuestion,
  scaleQuestion,
  numberRangeQuestion,
  textQuestion,
]);

/** Same shape as DiagnosticCondition: shown when a single-choice answer is one of `anyOf` */
const sectionCondition = z.object({
  questionId: id,
  anyOf: z.array(id).max(L.maxOptions),
});

const section = z.object({
  id,
  title: shortText,
  questionIds: z.array(id).max(L.maxQuestions),
  showWhen: sectionCondition.optional(),
});

const axis = z.object({
  id,
  name: shortText,
  /** Share in the overall score (relative to the other axes) */
  weight: z.number().positive().max(100),
});

/** A tier covers minPct ≤ pct < maxPct; the tier ending at 100 also includes 100 */
const tier = z.object({
  id,
  name: shortText,
  color,
  minPct: pct,
  maxPct: pct,
  description: longText.optional(),
});

const tierSet = z.object({
  id,
  /** Tiers of one axis; omitted = tiers of the overall score */
  axisId: id.optional(),
  tiers: z.array(tier).max(L.maxTiersPerSet),
});

/**
 * Conditions used by result types, lead score rules and MQL rules. Ranges are inclusive.
 * A condition on a question that does not apply (hidden section, not answered) is not met.
 */
export const conditionSchema = z.discriminatedUnion('type', [
  /** Single: the answer is one of anyOf. Multiple: at least one of anyOf is selected */
  z.object({ type: z.literal('answer'), questionId: id, anyOf: z.array(id).max(L.maxOptions) }),
  /** Scale or number_range answer within min..max */
  z.object({
    type: z.literal('number'),
    questionId: id,
    min: finite.optional(),
    max: finite.optional(),
  }),
  /** Axis (or overall when axisId is omitted) percentage within minPct..maxPct */
  z.object({
    type: z.literal('score'),
    axisId: id.optional(),
    minPct: pct.optional(),
    maxPct: pct.optional(),
  }),
  /** The tier reached in a tier set is one of anyOf */
  z.object({
    type: z.literal('tier'),
    tierSetId: id,
    anyOf: z.array(id).max(L.maxTiersPerSet),
  }),
]);

/** No conditions = always met */
const conditionGroup = z.object({
  match: z.enum(['all', 'any']),
  conditions: z.array(conditionSchema).max(L.maxConditions),
});

/** Checked in order; the first match is the respondent's result type */
const resultType = z.object({
  id,
  name: shortText,
  summary: longText.optional(),
  when: conditionGroup,
});

/** Result page blocks. All text is shown as plain text (line breaks kept, never HTML) */
const blockBase = {
  /** Show only for these result types; omitted = always */
  onlyFor: z.array(id).max(L.maxResultTypes).optional(),
};

export const resultBlockSchema = z.discriminatedUnion('type', [
  z.object({ ...blockBase, type: z.literal('heading'), text: shortText }),
  z.object({ ...blockBase, type: z.literal('text'), text: longText }),
  /** Percentage of one axis, or overall when axisId is omitted */
  z.object({ ...blockBase, type: z.literal('score'), axisId: id.optional() }),
  z.object({ ...blockBase, type: z.literal('axisChart') }),
  /** Text for the tier reached in a tier set: `{ tierId: text }` */
  z.object({
    ...blockBase,
    type: z.literal('tierText'),
    tierSetId: id,
    texts: z.record(id, longText),
  }),
  z.object({ ...blockBase, type: z.literal('cta'), label: shortText, url }),
]);

/**
 * Text shown to sales as the reason (notification, lead page). Written by the marketer and kept
 * in the definition, so it is fixed with the published version (no locales key per reason).
 */
const reasonText = shortText;

/**
 * The lead score is the sum of the matched rules' points, kept within LEAD_SCORE_RANGE: the same
 * 0–100 scale as the AX diagnosis, so lead.score can be compared across diagnoses.
 */
const leadScoreRule = z.object({
  id,
  when: conditionGroup,
  points,
  reason: reasonText,
});

const strongSignal = z.object({ id, when: conditionGroup, reason: reasonText });

/**
 * Qualified when every required condition is met and either the lead score reaches minScore or
 * a strong signal matches. minScore null = the score alone never qualifies (only strong signals
 * do); this is the default, because 0 would qualify everyone (lead scores start at 0).
 */
const mql = z.object({
  required: z.array(conditionSchema).max(L.maxConditions),
  strongSignals: z.array(strongSignal).max(L.maxRules),
  minScore: z.number().int().min(0).max(100).nullable(),
});

const consent = z.object({
  /** Recorded with each submission (e.g. "2026-10-01") */
  version: z.string().trim().min(1).max(40),
  text: longText,
  privacyPolicyUrl: url.optional(),
});

export const diagnosisDefinitionSchema = z.object({
  schemaVersion: z.literal(DEFINITION_SCHEMA_VERSION),
  /** MVP is Japanese only */
  locale: z.literal('ja'),
  title: shortText,
  description: longText.optional(),
  sections: z.array(section).max(L.maxSections),
  questions: z.array(questionSchema).max(L.maxQuestions),
  axes: z.array(axis).max(L.maxAxes),
  tierSets: z.array(tierSet).max(L.maxAxes + 1),
  resultTypes: z.array(resultType).max(L.maxResultTypes),
  resultBlocks: z.array(resultBlockSchema).max(L.maxResultBlocks),
  leadScore: z.object({ rules: z.array(leadScoreRule).max(L.maxRules) }),
  mql,
  /** Optional in the schema so a draft can be saved; publishing requires it */
  consent: consent.optional(),
});

export type DiagnosisDefinition = z.infer<typeof diagnosisDefinitionSchema>;
export type DiagnosisQuestion = z.infer<typeof questionSchema>;
export type DiagnosisSection = DiagnosisDefinition['sections'][number];
export type DiagnosisCondition = z.infer<typeof conditionSchema>;
export type DiagnosisConditionGroup = z.infer<typeof conditionGroup>;
export type DiagnosisTierSet = DiagnosisDefinition['tierSets'][number];
export type DiagnosisResultBlock = z.infer<typeof resultBlockSchema>;
export type ChoiceDiagnosisQuestion = Extract<DiagnosisQuestion, { type: 'single' | 'multiple' }>;

/** Normalized answers: single/text → string, multiple → string[], scale/number_range → number */
export type DiagnosisAnswerValue = string | string[] | number;
export type DiagnosisAnswers = Record<string, DiagnosisAnswerValue>;

export const isChoiceQuestion = (q: DiagnosisQuestion): q is ChoiceDiagnosisQuestion =>
  q.type === 'single' || q.type === 'multiple';

/**
 * Starting shape of a new draft. It parses, but is not publishable yet (no questions, axes or
 * consent), and its MQL rules qualify no one until the marketer sets them.
 */
export function emptyDiagnosisDefinition(title: string): DiagnosisDefinition {
  return {
    schemaVersion: DEFINITION_SCHEMA_VERSION,
    locale: 'ja',
    title,
    sections: [],
    questions: [],
    axes: [],
    tierSets: [],
    resultTypes: [],
    resultBlocks: [],
    leadScore: { rules: [] },
    mql: { required: [], strongSignals: [], minScore: null },
  };
}
