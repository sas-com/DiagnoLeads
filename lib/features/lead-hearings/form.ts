/**
 * Hearing editor form helpers (Refs #84)
 *
 * Pure functions behind the editor screen: how a value change moves the status and the source,
 * how half-entered values (a year without a month) are left out when saving, and the
 * "Web diagnosis: ..." line shown next to a field.
 */

import { axMigrationDefinition } from '@/lib/features/diagnostics/ax-migration/definition';
import type { DiagnosticLocale } from '@/lib/features/diagnostics/types';
import {
  HEARING_FIELDS,
  type HearingFieldDefinition,
  type HearingFieldKey,
  type HearingSectionId,
  getHearingField,
} from './catalog';
import type {
  HearingFieldEntry,
  HearingFieldValue,
  HearingFields,
  HearingPrefillSnapshot,
} from './types/schemas';

/** A field nobody has touched yet */
export const EMPTY_HEARING_ENTRY: HearingFieldEntry = { status: 'not_yet', source: null };

export function entryOf(fields: HearingFields, key: HearingFieldKey): HearingFieldEntry {
  return fields[key] ?? EMPTY_HEARING_ENTRY;
}

const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * The value to store, or undefined when there is nothing (complete) to store: blank text, no
 * options chosen, a year without a month, a scale basis without a range.
 */
export function normalizeHearingValue(
  field: HearingFieldDefinition,
  value: HearingFieldValue | undefined
): HearingFieldValue | undefined {
  if (value === undefined || value === null) return undefined;
  switch (field.type) {
    case 'single':
    case 'date':
      return typeof value === 'string' && value !== '' ? value : undefined;
    case 'text': {
      const text = typeof value === 'string' ? value.trim() : '';
      return text === '' ? undefined : text;
    }
    case 'yearMonth':
      return typeof value === 'string' && YEAR_MONTH.test(value) ? value : undefined;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    case 'multiple':
      return Array.isArray(value) && value.length > 0 ? value : undefined;
    case 'levels': {
      if (typeof value !== 'object' || Array.isArray(value)) return undefined;
      const entries = Object.entries(value).filter(([, level]) => Boolean(level));
      return entries.length > 0 ? Object.fromEntries(entries) : undefined;
    }
    case 'scale': {
      if (typeof value !== 'object' || Array.isArray(value)) return undefined;
      const { basis, bucket } = value as { basis?: string; bucket?: string };
      return basis && bucket ? { basis, bucket } : undefined;
    }
  }
}

const sameValue = (a: HearingFieldValue | undefined, b: HearingFieldValue | undefined) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Apply a new value typed or chosen on screen.
 * - A value that came from the diagnosis (or was confirmed) and now differs becomes "corrected".
 * - Entering a value on an open field marks it done, unless the user picked a status for it.
 */
export function changeHearingValue(
  field: HearingFieldDefinition,
  entry: HearingFieldEntry,
  value: HearingFieldValue | undefined,
  statusPickedByUser: boolean
): HearingFieldEntry {
  const before = normalizeHearingValue(field, entry.value);
  const after = normalizeHearingValue(field, value);
  const changed = !sameValue(before, after);
  const source =
    changed && (entry.source === 'prefilled' || entry.source === 'confirmed')
      ? 'corrected'
      : entry.source;
  const status =
    changed && after !== undefined && !statusPickedByUser && entry.status === 'not_yet'
      ? 'done'
      : entry.status;
  const next: HearingFieldEntry = { status, source };
  if (value !== undefined) next.value = value;
  return next;
}

/** The "confirmed" button: the diagnosis value was checked in the meeting */
export function confirmHearingEntry(entry: HearingFieldEntry): HearingFieldEntry {
  return { ...entry, source: 'confirmed', status: 'done' };
}

/** Form state → fields to save: complete values only, untouched fields left out */
export function toSavedHearingFields(form: HearingFields): HearingFields {
  const saved: HearingFields = {};
  for (const field of HEARING_FIELDS) {
    const entry = form[field.key];
    if (!entry) continue;
    const value = normalizeHearingValue(field, entry.value);
    if (value === undefined && entry.status === 'not_yet' && entry.source === null) continue;
    saved[field.key] = {
      ...(value !== undefined ? { value } : {}),
      status: entry.status,
      source: entry.source,
    };
  }
  return saved;
}

/** Section of each missing key, counted per section (distinct keys) */
export function countBySection(keys: readonly HearingFieldKey[]): Map<HearingSectionId, number> {
  const counts = new Map<HearingSectionId, number>();
  for (const key of new Set(keys)) {
    const section = getHearingField(key)?.section;
    if (section) counts.set(section, (counts.get(section) ?? 0) + 1);
  }
  return counts;
}

const questionById = new Map(axMigrationDefinition.questions.map((q) => [q.id, q]));

/**
 * What the Web diagnosis answered for a field, as labels ("AS/400 / 100-300"), or null when
 * the diagnosis said nothing about it. Answers the current diagnosis no longer knows are shown
 * as stored.
 */
export function hearingHintText(
  prefill: HearingPrefillSnapshot | null,
  key: HearingFieldKey,
  locale: DiagnosticLocale
): string | null {
  const questionIds = prefill?.hints[key];
  if (!prefill || !questionIds || questionIds.length === 0) return null;
  const parts: string[] = [];
  for (const questionId of questionIds) {
    const answer = prefill.answers[questionId];
    if (answer === undefined) continue;
    const options = questionById.get(questionId)?.options ?? [];
    const values = Array.isArray(answer) ? answer : [answer];
    const labels = values.map(
      (value) => options.find((o) => o.value === value)?.label[locale] ?? value
    );
    if (labels.length > 0) parts.push(labels.join(locale === 'ja' ? '、' : ', '));
  }
  return parts.length > 0 ? parts.join(' / ') : null;
}

/** Label of a diagnosis option (e.g. the platform of a prefill source) */
export function diagnosisOptionLabel(
  questionId: string,
  value: string,
  locale: DiagnosticLocale
): string {
  return (
    questionById.get(questionId)?.options.find((o) => o.value === value)?.label[locale] ?? value
  );
}
