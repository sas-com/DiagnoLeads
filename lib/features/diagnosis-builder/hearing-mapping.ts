/**
 * Builder questions → hearing sheet fields (Refs #121)
 *
 * A question may name the hearing field it fills (`hearingField` in definition.ts). These pure
 * functions decide whether that mapping can be used, turn an answer into the field's value, and
 * count how many of the hearing's required items a definition fills in advance (for the builder
 * screen, so marketers see what sales get from a diagnosis).
 */
import {
  HEARING_REQUIRED_ITEMS,
  type HearingChoiceField,
  type HearingFieldDefinition,
  type HearingFieldKey,
  type HearingRequiredItem,
  getHearingField,
} from '@/lib/features/lead-hearings/catalog';
import type { HearingFieldValue } from '@/lib/features/lead-hearings/types/schemas';
import { clipText } from '@/lib/utils/clip-text';
import type { DiagnosisAnswerValue, DiagnosisDefinition, DiagnosisQuestion } from './definition';

/** Hearing field types each question type can fill */
export const HEARING_FIELD_TYPES_BY_QUESTION: Record<
  DiagnosisQuestion['type'],
  readonly HearingFieldDefinition['type'][]
> = {
  single: ['single', 'multiple'],
  multiple: ['multiple'],
  scale: ['number'],
  number_range: ['number'],
  text: ['text'],
};

/** The hearing field of a question when the mapping can be used (known key, matching type) */
export function mappedHearingField(question: DiagnosisQuestion): HearingFieldDefinition | null {
  const mapping = question.hearingField;
  if (!mapping) return null;
  const field = getHearingField(mapping.key);
  if (!field) return null;
  return HEARING_FIELD_TYPES_BY_QUESTION[question.type].includes(field.type) ? field : null;
}

/**
 * The hearing value of one option of a choice question, or null when it is not copied (mapped to
 * null, or not an option of the field)
 */
export function hearingOptionValue(
  question: DiagnosisQuestion,
  field: HearingChoiceField,
  optionValue: string
): string | null {
  const mapped = question.hearingField?.values?.[optionValue];
  const value = mapped === undefined ? optionValue : mapped;
  if (value === null) return null;
  return field.options.some((option) => option.value === value) ? value : null;
}

const isChoiceField = (field: HearingFieldDefinition): field is HearingChoiceField =>
  field.type === 'single' || field.type === 'multiple';

/**
 * The hearing field and value an answer gives, or null when the question has no usable mapping
 * or the answer says nothing the field can hold (an option mapped to null, a number outside the
 * field's range, an empty text).
 */
export function hearingValueFromAnswer(
  question: DiagnosisQuestion,
  answer: DiagnosisAnswerValue | undefined
): { key: HearingFieldKey; value: HearingFieldValue } | null {
  const field = mappedHearingField(question);
  if (!field || answer === undefined) return null;
  const key = field.key as HearingFieldKey;

  if (isChoiceField(field)) {
    const chosen = Array.isArray(answer) ? answer : typeof answer === 'string' ? [answer] : [];
    const values = [
      ...new Set(
        chosen.flatMap((option) => {
          const value = hearingOptionValue(question, field, option);
          return value === null ? [] : [value];
        })
      ),
    ];
    if (values.length === 0) return null;
    if (field.type === 'single') return values.length === 1 ? { key, value: values[0] } : null;
    return { key, value: values };
  }
  if (field.type === 'number') {
    if (typeof answer !== 'number' || !Number.isInteger(answer)) return null;
    return answer >= field.min && answer <= field.max ? { key, value: answer } : null;
  }
  if (field.type === 'text') {
    if (typeof answer !== 'string') return null;
    // Never split a character: the hearing is stored as jsonb (#754)
    const text = clipText(answer.trim(), field.maxLength);
    return text === '' ? null : { key, value: text };
  }
  return null;
}

/** Hearing fields the definition fills, with the questions that fill each (definition order) */
export function mappedHearingFields(
  definition: Pick<DiagnosisDefinition, 'questions'>
): Map<HearingFieldKey, string[]> {
  const fields = new Map<HearingFieldKey, string[]>();
  for (const question of definition.questions) {
    const field = mappedHearingField(question);
    if (!field) continue;
    const key = field.key as HearingFieldKey;
    fields.set(key, [...(fields.get(key) ?? []), question.id]);
  }
  return fields;
}

export type HearingCoverageStatus = 'covered' | 'partial' | 'none';

export interface HearingCoverage {
  /** Required items in all */
  total: number;
  /** Items whose every field is filled by the diagnosis */
  covered: number;
  /** Items with only some of their fields filled */
  partial: number;
  items: {
    id: string;
    labelKey: string;
    status: HearingCoverageStatus;
    /** Fields of the item the diagnosis fills */
    mappedKeys: HearingFieldKey[];
  }[];
}

/**
 * How many of the hearing's required items a definition fills in advance. Only usable mappings
 * count (see mappedHearingField); an item counts as covered when all of its fields are mapped.
 */
export function hearingCoverage(
  definition: Pick<DiagnosisDefinition, 'questions'>,
  requiredItems: readonly HearingRequiredItem[] = HEARING_REQUIRED_ITEMS
): HearingCoverage {
  const mapped = mappedHearingFields(definition);
  const items = requiredItems.map((item) => {
    const mappedKeys = item.keys.filter((key) => mapped.has(key));
    const status: HearingCoverageStatus =
      mappedKeys.length === 0
        ? 'none'
        : mappedKeys.length === item.keys.length
          ? 'covered'
          : 'partial';
    return { id: item.id, labelKey: item.labelKey, status, mappedKeys };
  });
  return {
    total: items.length,
    covered: items.filter((item) => item.status === 'covered').length,
    partial: items.filter((item) => item.status === 'partial').length,
    items,
  };
}
