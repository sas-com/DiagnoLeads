/**
 * Initial sales meeting hearing: the catalog of fields (Refs #84)
 *
 * Only the keys, the value types and the option keys live in code. The internal hearing sheet
 * (questions, examples) is confidential and this repository is public, so labels are looked up
 * by `labelKey` in locales/{ja,en}, or reuse the Web diagnosis labels when an option set comes
 * from the diagnosis. Values are stored per lead in lead_hearings.fields.
 *
 * Changing the catalog: add new keys freely; never reuse a removed key for another meaning.
 * Stored values whose key or option no longer exists are dropped when read (see schemas.ts).
 */

import { axMigrationDefinition } from '@/lib/features/diagnostics/ax-migration/definition';
import type { LocalizedText } from '@/lib/features/diagnostics/types';
import { TARGET_SYSTEMS } from '@/lib/features/leads/types/pipeline';

/** Bump when the meaning of stored values changes (kept on each row) */
export const HEARING_CATALOG_VERSION = 1;

/** 実施情報／顧客情報／現行システム／課題／要件／結果 */
export const HEARING_SECTIONS = [
  'meeting',
  'customer',
  'currentSystem',
  'challenges',
  'requirements',
  'outcome',
] as const;
export type HearingSectionId = (typeof HEARING_SECTIONS)[number];

/** 済／一部／未／対象外／次回 */
export const HEARING_ITEM_STATUSES = [
  'done',
  'partial',
  'not_yet',
  'not_applicable',
  'next',
] as const;
export type HearingItemStatus = (typeof HEARING_ITEM_STATUSES)[number];

/**
 * Where a value came from: 事前情報 (the Web diagnosis) / 商談で確認済み / 修正あり.
 * null when there was no prior information and the value was entered in the meeting.
 */
export const HEARING_VALUE_SOURCES = ['prefilled', 'confirmed', 'corrected'] as const;
export type HearingValueSource = (typeof HEARING_VALUE_SOURCES)[number];

/**
 * An option is labelled either by a locale key (labelKey) or, when the option set is the Web
 * diagnosis's own, by the diagnosis label (label).
 */
export interface HearingOption {
  value: string;
  labelKey?: string;
  label?: LocalizedText;
}

interface FieldBase<K extends string> {
  key: K;
  section: HearingSectionId;
  labelKey: string;
}

export interface HearingChoiceField<K extends string = string> extends FieldBase<K> {
  type: 'single' | 'multiple';
  options: readonly HearingOption[];
  /** Set when the options are the answers of this Web diagnosis question */
  diagnosisQuestionId?: string;
}

export interface HearingTextField<K extends string = string> extends FieldBase<K> {
  type: 'text';
  maxLength: number;
}

export interface HearingNumberField<K extends string = string> extends FieldBase<K> {
  type: 'number';
  min: number;
  max: number;
  /** How the number is shown: 'month' labels 3 as "3月" / "March"; plain numbers get separators */
  unit?: 'month';
}

/** 'YYYY-MM' */
export interface HearingYearMonthField<K extends string = string> extends FieldBase<K> {
  type: 'yearMonth';
}

/** 'YYYY-MM-DD' */
export interface HearingDateField<K extends string = string> extends FieldBase<K> {
  type: 'date';
}

/** A level for each item, e.g. how strongly each challenge applies */
export interface HearingLevelsField<K extends string = string> extends FieldBase<K> {
  type: 'levels';
  items: readonly HearingOption[];
  levels: readonly HearingOption[];
}

/**
 * A size range measured the way the Web diagnosis asks it for each system: the basis is a
 * diagnosis question and the bucket one of its options.
 */
export interface HearingScaleField<K extends string = string> extends FieldBase<K> {
  type: 'scale';
  bases: readonly { questionId: string; label: LocalizedText; buckets: readonly HearingOption[] }[];
}

export type HearingFieldDefinition<K extends string = string> =
  | HearingChoiceField<K>
  | HearingTextField<K>
  | HearingNumberField<K>
  | HearingYearMonthField<K>
  | HearingDateField<K>
  | HearingLevelsField<K>
  | HearingScaleField<K>;

// ── Helpers ─────────────────────────────────────────────────────────────────────

const fieldLabel = (key: string) => `leadHearings.fields.${key}`;

/** Options labelled from locales: leadHearings.options.<set>.<value> */
const localOptions = (set: string, values: readonly string[]): HearingOption[] =>
  values.map((value) => ({ value, labelKey: `leadHearings.options.${set}.${value}` }));

function diagnosisQuestion(questionId: string) {
  const question = axMigrationDefinition.questions.find((q) => q.id === questionId);
  if (!question) throw new Error(`Unknown AX diagnosis question: ${questionId}`);
  return question;
}

/** The options of a Web diagnosis question, with its labels */
export const diagnosisOptions = (questionId: string): HearingOption[] =>
  diagnosisQuestion(questionId).options.map((o) => ({ value: o.value, label: o.label }));

const choice =
  (type: 'single' | 'multiple') =>
  <K extends string>(
    key: K,
    section: HearingSectionId,
    options: readonly HearingOption[],
    diagnosisQuestionId?: string
  ): HearingChoiceField<K> => ({
    key,
    section,
    labelKey: fieldLabel(key),
    type,
    options,
    ...(diagnosisQuestionId ? { diagnosisQuestionId } : {}),
  });
const single = choice('single');
const multiple = choice('multiple');

const textField = <K extends string>(
  key: K,
  section: HearingSectionId,
  maxLength = 1000
): HearingTextField<K> => ({ key, section, labelKey: fieldLabel(key), type: 'text', maxLength });

const yearMonth = <K extends string>(
  key: K,
  section: HearingSectionId
): HearingYearMonthField<K> => ({
  key,
  section,
  labelKey: fieldLabel(key),
  type: 'yearMonth',
});

const dateField = <K extends string>(key: K, section: HearingSectionId): HearingDateField<K> => ({
  key,
  section,
  labelKey: fieldLabel(key),
  type: 'date',
});

/** Same keys as ChallengeType in lib/features/diagnostics/ax-migration/evaluate.ts */
export const HEARING_CHALLENGES = ['people', 'cost', 'agility', 'data'] as const;

/** Diagnosis questions that measure the size of each system (see evaluate.ts) */
export const HEARING_SCALE_QUESTIONS = [
  'as400_programs',
  'acos_programs',
  'other_programs',
  'access_screens_forms',
] as const;

// ── Fields ──────────────────────────────────────────────────────────────────────

export const HEARING_FIELDS = [
  // 実施情報
  single('meetingFormat', 'meeting', localOptions('meetingFormat', ['onsite', 'online', 'phone'])),
  multiple('attendeeRoles', 'meeting', diagnosisOptions('role'), 'role'),
  single('decisionMakerPresent', 'meeting', localOptions('yesNo', ['yes', 'no', 'unknown'])),

  // 顧客情報
  single('industry', 'customer', diagnosisOptions('industry'), 'industry'),
  single(
    'employeeCount',
    'customer',
    localOptions('employeeCount', ['lt50', '50_299', '300_999', 'gte1000', 'unknown'])
  ),
  multiple('businessAreas', 'customer', diagnosisOptions('business_areas'), 'business_areas'),

  // 現行システム
  single(
    'targetSystem',
    'currentSystem',
    TARGET_SYSTEMS.map((value) => ({ value, labelKey: `pipeline.targetSystem.${value}` }))
  ),
  textField('machineModel', 'currentSystem', 200),
  single(
    'yearsInUse',
    'currentSystem',
    localOptions('yearsInUse', ['lt10', '10_19', '20_29', 'gte30', 'unknown'])
  ),
  {
    key: 'scale',
    section: 'currentSystem',
    labelKey: fieldLabel('scale'),
    type: 'scale',
    bases: HEARING_SCALE_QUESTIONS.map((questionId) => ({
      questionId,
      label: diagnosisQuestion(questionId).label,
      buckets: diagnosisOptions(questionId),
    })),
  } satisfies HearingScaleField<'scale'>,
  single(
    'inHouseExperts',
    'currentSystem',
    localOptions('headcount', ['none', 'one', 'two', 'three_or_more', 'unknown'])
  ),
  single('vendorSupport', 'currentSystem', localOptions('yesNo', ['yes', 'no', 'unknown'])),
  yearMonth('earliestRetirement', 'currentSystem'),
  yearMonth('hardwareSupportEnd', 'currentSystem'),

  // 課題
  {
    key: 'challengeLevels',
    section: 'challenges',
    labelKey: fieldLabel('challengeLevels'),
    type: 'levels',
    items: localOptions('challenge', HEARING_CHALLENGES),
    levels: localOptions('level', ['high', 'medium', 'low', 'none']),
  } satisfies HearingLevelsField<'challengeLevels'>,
  single('topChallenge', 'challenges', localOptions('challenge', HEARING_CHALLENGES)),
  textField('challengeNotes', 'challenges'),
  textField('impactIfUnaddressed', 'challenges'),
  single(
    'pastConsideration',
    'challenges',
    localOptions('pastConsideration', ['never', 'dropped', 'ongoing', 'unknown'])
  ),
  multiple(
    'pastBlockers',
    'challenges',
    localOptions('pastBlocker', ['budget', 'staffing', 'risk', 'priority', 'vendor', 'other'])
  ),

  // 要件
  single('directionTiming', 'requirements', diagnosisOptions('timeline'), 'timeline'),
  single(
    'budgetStatus',
    'requirements',
    localOptions('budgetStatus', ['secured', 'planning', 'not_started', 'unknown'])
  ),
  {
    key: 'fiscalYearEndMonth',
    section: 'requirements',
    labelKey: fieldLabel('fiscalYearEndMonth'),
    type: 'number',
    min: 1,
    max: 12,
    unit: 'month',
  } satisfies HearingNumberField<'fiscalYearEndMonth'>,
  multiple(
    'competitorTypes',
    'requirements',
    localOptions('competitorType', [
      'none',
      'current_vendor',
      'other_integrator',
      'low_code_vendor',
      'package_vendor',
      'in_house',
      'unknown',
    ])
  ),
  // Whether the customer allows an outside AI service to analyse their source code (#160); the
  // migration plan relies on it, so a restriction is shown on the lead and told to its assignee
  single(
    'aiSourceAnalysis',
    'requirements',
    localOptions('aiSourceAnalysis', ['allowed', 'conditional', 'not_allowed', 'unknown'])
  ),
  textField('aiSourceAnalysisConditions', 'requirements', 500),
  textField('requirementNotes', 'requirements'),

  // 結果
  single('dealRating', 'outcome', localOptions('dealRating', ['a', 'b', 'c'])),
  dateField('nextMeetingDate', 'outcome'),
  multiple(
    'nextMeetingAttendees',
    'outcome',
    localOptions('nextAttendee', [
      'customer_executive',
      'customer_it',
      'customer_business',
      'our_sales',
      'our_engineer',
      'partner',
    ])
  ),
  textField('outcomeNotes', 'outcome'),
] as const;

export type HearingFieldKey = (typeof HEARING_FIELDS)[number]['key'];

export const HEARING_FIELD_KEYS = HEARING_FIELDS.map((field) => field.key) as HearingFieldKey[];

const fieldsByKey = new Map<string, HearingFieldDefinition>(
  HEARING_FIELDS.map((field) => [field.key, field])
);

export function getHearingField(key: string): HearingFieldDefinition | undefined {
  return fieldsByKey.get(key);
}

export function isHearingFieldKey(key: string): key is HearingFieldKey {
  return fieldsByKey.has(key);
}

// ── "Other" options ─────────────────────────────────────────────────────────────

/**
 * An option that stands for "something not in the list" ('other', or a narrower 'other_*' such
 * as 'other_integrator'). Choosing one opens a short free-text note, stored on the entry as
 * `otherNote` (see schemas.ts).
 */
export const isOtherOption = (value: string): boolean =>
  value === 'other' || value.startsWith('other_');

/** Max length of the note written for an "other" option */
export const HEARING_OTHER_NOTE_MAX_LENGTH = 200;

/** Whether the field is a choice field with at least one "other" option */
export function hasOtherOption(field: HearingFieldDefinition): field is HearingChoiceField {
  return (
    (field.type === 'single' || field.type === 'multiple') &&
    field.options.some((option) => isOtherOption(option.value))
  );
}

/** Whether a choice value (one option or a list) includes an "other" option */
export function choosesOtherOption(value: unknown): boolean {
  if (typeof value === 'string') return isOtherOption(value);
  return Array.isArray(value) && value.some((v) => typeof v === 'string' && isOtherOption(v));
}

// ── Required items ──────────────────────────────────────────────────────────────

export interface HearingRequiredItem {
  id: string;
  labelKey: string;
  /** Every key must be filled (or marked not applicable) for the item to count as filled */
  keys: readonly HearingFieldKey[];
}

const required = (id: string, keys: HearingFieldKey[]): HearingRequiredItem => ({
  id,
  labelKey: `leadHearings.required.${id}`,
  keys,
});

/**
 * Items to fill before agreeing on the next meeting. PROVISIONAL: replace this list once the
 * sales department has settled it; nothing else depends on its contents.
 */
export const HEARING_REQUIRED_ITEMS: readonly HearingRequiredItem[] = [
  required('attendeeRoles', ['attendeeRoles']),
  required('system', ['targetSystem', 'machineModel']),
  required('businessAreas', ['businessAreas']),
  required('upkeep', ['inHouseExperts', 'earliestRetirement']),
  required('supportEnd', ['hardwareSupportEnd']),
  required('topChallenge', ['topChallenge']),
  required('impact', ['impactIfUnaddressed']),
  required('pastConsideration', ['pastConsideration', 'pastBlockers']),
  required('decisionMaker', ['decisionMakerPresent']),
  required('timing', ['directionTiming']),
  required('competitors', ['competitorTypes']),
  required('nextMeeting', ['nextMeetingDate', 'nextMeetingAttendees']),
];

// ── Resolved catalog ────────────────────────────────────────────────────────────

/** The catalog as defined in code */
export interface HearingBaseCatalog {
  sections: readonly HearingSectionId[];
  fields: readonly HearingFieldDefinition[];
  requiredItems: readonly HearingRequiredItem[];
}

export const HEARING_BASE_CATALOG: HearingBaseCatalog = {
  sections: HEARING_SECTIONS,
  fields: HEARING_FIELDS,
  requiredItems: HEARING_REQUIRED_ITEMS,
};

/**
 * Changes an organization makes to the base catalog. Only the required items for now; the
 * organization settings (#98) add visibility, order and custom fields here.
 */
export interface HearingCatalogOverrides {
  requiredItems?: readonly HearingRequiredItem[];
}

export interface HearingCatalogField {
  field: HearingFieldDefinition;
  /** Part of a required item */
  required: boolean;
}

export interface HearingCatalogSection {
  id: HearingSectionId;
  fields: readonly HearingCatalogField[];
}

/** What the screens and the missing-item check read: sections → ordered fields */
export interface HearingCatalogView {
  sections: readonly HearingCatalogSection[];
  requiredItems: readonly HearingRequiredItem[];
  sectionOf: ReadonlyMap<HearingFieldKey, HearingSectionId>;
}

export function resolveHearingCatalog(
  base: HearingBaseCatalog,
  overrides: HearingCatalogOverrides = {}
): HearingCatalogView {
  const requiredItems = overrides.requiredItems ?? base.requiredItems;
  const requiredKeys = new Set<string>(requiredItems.flatMap((item) => item.keys));
  const sectionOf = new Map<HearingFieldKey, HearingSectionId>();
  const sections = base.sections.map((id) => ({
    id,
    fields: base.fields
      .filter((field) => field.section === id)
      .map((field) => {
        sectionOf.set(field.key as HearingFieldKey, id);
        return { field, required: requiredKeys.has(field.key) };
      }),
  }));
  return { sections, requiredItems, sectionOf };
}

/** The catalog without organization overrides */
export const DEFAULT_HEARING_CATALOG = resolveHearingCatalog(HEARING_BASE_CATALOG);

/** Hearings per lead (a lead has a few meetings; this only stops runaway creation) */
export const LEAD_HEARINGS_MAX_PER_LEAD = 50;
