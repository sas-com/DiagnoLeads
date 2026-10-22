/**
 * Hearing editor form helpers (Refs #84)
 *
 * Pure functions behind the editor screen: how a value change moves the status and the source,
 * how each input builds its value, how half-entered values (a year without a month) are left
 * out when saving and when counting missing items, and the "Web diagnosis: ..." line shown next
 * to a field.
 */

import { axMigrationDefinition } from '@/lib/features/diagnostics/ax-migration/definition';
import type { DiagnosticLocale } from '@/lib/features/diagnostics/types';
import {
  DEFAULT_HEARING_CATALOG,
  HEARING_FIELDS,
  type HearingCatalogView,
  type HearingFieldDefinition,
  type HearingFieldKey,
  type HearingItemStatus,
  type HearingOption,
  type HearingRequiredItem,
  type HearingSectionId,
  choosesOtherOption,
  getHearingField,
  hasOtherOption,
  isUnconfirmedSource,
} from './catalog';
import { type HearingMissingItems, computeMissingItems } from './missing';
import {
  type HearingFieldEntry,
  type HearingFieldValue,
  type HearingFields,
  type HearingPrefillSnapshot,
  YEAR_MONTH_PATTERN,
  isoDateSchema,
} from './types/schemas';

/** The Web diagnosis has Japanese and English labels; other UI locales fall back to Japanese */
export const toDiagnosticLocale = (locale: string): DiagnosticLocale =>
  locale === 'en' ? 'en' : 'ja';

/** A field nobody has touched yet */
export const EMPTY_HEARING_ENTRY: HearingFieldEntry = { status: 'not_yet', source: null };

export function entryOf(fields: HearingFields, key: HearingFieldKey): HearingFieldEntry {
  return fields[key] ?? EMPTY_HEARING_ENTRY;
}

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
      return typeof value === 'string' && YEAR_MONTH_PATTERN.test(value) ? value : undefined;
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
    changed && (isUnconfirmedSource(entry.source) || entry.source === 'confirmed')
      ? 'corrected'
      : entry.source;
  const status =
    changed && after !== undefined && !statusPickedByUser && entry.status === 'not_yet'
      ? 'done'
      : entry.status;
  const next: HearingFieldEntry = { status, source };
  if (value !== undefined) next.value = value;
  // The "other" note stays while editing, even when "other" is unchosen for a moment; it is
  // left out when saving unless "other" is chosen again (toSavedHearingFields)
  if (entry.otherNote !== undefined) next.otherNote = entry.otherNote;
  return next;
}

/** The note typed for an "other" option; status and source stay (the note is not a correction) */
export function changeHearingOtherNote(
  entry: HearingFieldEntry,
  note: string | undefined
): HearingFieldEntry {
  const { otherNote: _previous, ...rest } = entry;
  return note === undefined || note === '' ? rest : { ...rest, otherNote: note };
}

/**
 * The "other" note to keep for a value: trimmed, and only when the field has an "other" option
 * and the value chooses one (undefined otherwise)
 */
export function effectiveOtherNote(
  field: HearingFieldDefinition,
  value: HearingFieldValue | undefined,
  note: string | undefined
): string | undefined {
  if (!hasOtherOption(field) || !choosesOtherOption(value)) return undefined;
  const text = note?.trim() ?? '';
  return text === '' ? undefined : text;
}

/** The "confirmed" button: the diagnosis value was checked in the meeting */
export function confirmHearingEntry(entry: HearingFieldEntry): HearingFieldEntry {
  return { ...entry, source: 'confirmed', status: 'done' };
}

/** A status picked on screen; the value and its source stay */
export function setHearingStatus(
  entry: HearingFieldEntry,
  status: HearingItemStatus
): HearingFieldEntry {
  return { ...entry, status };
}

// ── Input values ────────────────────────────────────────────────────────────────

type ScaleValue = { basis?: string; bucket?: string };
type LevelsValue = Partial<Record<string, string>>;

const isRecord = (value: HearingFieldValue | undefined): value is LevelsValue =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const asChoices = (value: HearingFieldValue | undefined): string[] =>
  Array.isArray(value) ? value : [];

export const asLevels = (value: HearingFieldValue | undefined): LevelsValue =>
  isRecord(value) ? value : {};

export const asScale = (value: HearingFieldValue | undefined): ScaleValue =>
  isRecord(value) ? (value as ScaleValue) : {};

/** Check or uncheck one option; the result keeps the catalog order (undefined when empty) */
export function toggleHearingOption(
  options: readonly HearingOption[],
  chosen: readonly string[],
  value: string,
  checked: boolean
): string[] | undefined {
  const next = checked
    ? options.map((o) => o.value).filter((v) => v === value || chosen.includes(v))
    : chosen.filter((v) => v !== value);
  return next.length > 0 ? next : undefined;
}

/** Set or clear the level of one item (undefined when no item has a level) */
export function setHearingLevel(
  levels: LevelsValue,
  item: string,
  level: string | undefined
): LevelsValue | undefined {
  const updated = { ...levels };
  if (level) updated[item] = level;
  else delete updated[item];
  return Object.keys(updated).length > 0 ? updated : undefined;
}

/** 'YYYY-MM' split for the two selects; either part may be missing while being entered */
export function splitYearMonth(value: HearingFieldValue | undefined): {
  year: string;
  month: string;
} {
  const [year = '', month = ''] = typeof value === 'string' ? value.split('-') : [];
  return { year, month };
}

/** The two selects → 'YYYY-MM', a half-entered 'YYYY-' / '-MM', or undefined when both empty */
export function joinYearMonth(
  year: string | undefined,
  month: string | undefined
): string | undefined {
  return year || month ? `${year ?? ''}-${month ?? ''}` : undefined;
}

/** Years offered around this year, plus a stored year outside that range */
export function hearingYearOptions(
  thisYear: number,
  selected: string,
  range: { back: number; ahead: number } = { back: 15, ahead: 15 }
): number[] {
  const years = new Set<number>();
  for (let y = thisYear - range.back; y <= thisYear + range.ahead; y++) years.add(y);
  if (selected) years.add(Number(selected));
  return [...years].sort((a, b) => a - b);
}

// ── Typed dates ─────────────────────────────────────────────────────────────────

const TYPED_DATE = /^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?$/;
const TYPED_DATE_DIGITS = /^(\d{4})(\d{2})(\d{2})$/;
const FULL_WIDTH_SEPARATORS: Record<string, string> = { '／': '/', '－': '-', '．': '.' };

/**
 * A date typed by hand → 'YYYY-MM-DD'. Accepts 2026-10-20, 2026/10/20, 2026.10.20,
 * 2026年10月20日 and 20261020 (full-width digits too). undefined when blank, null when it is
 * not a real date.
 */
export function parseTypedDate(text: string): string | null | undefined {
  const trimmed = text
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/[／－．]/g, (c) => FULL_WIDTH_SEPARATORS[c] ?? c)
    .trim();
  if (trimmed === '') return undefined;
  const match = TYPED_DATE.exec(trimmed) ?? TYPED_DATE_DIGITS.exec(trimmed);
  if (!match) return null;
  const [, year, month, day] = match;
  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  return isoDateSchema.safeParse(iso).success ? iso : null;
}

/** 'YYYY-MM-DD' as shown in the text box: 2026/10/20 in Japanese, as stored otherwise */
export const formatTypedDate = (iso: string, locale: string): string =>
  locale === 'ja' ? iso.replaceAll('-', '/') : iso;

/** A calendar date (local time) → 'YYYY-MM-DD' */
export function toIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 'YYYY-MM-DD' → the local calendar date, or undefined when it is not one */
export function fromIsoDate(iso: string | undefined): Date | undefined {
  if (!iso || !isoDateSchema.safeParse(iso).success) return undefined;
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Form state → fields to save: complete values only, untouched fields left out. An "other" note
 * is saved (trimmed) only while an "other" option is chosen, so no stale note outlives its option.
 */
export function toSavedHearingFields(form: HearingFields): HearingFields {
  const saved: HearingFields = {};
  for (const field of HEARING_FIELDS) {
    const entry = form[field.key];
    if (!entry) continue;
    const value = normalizeHearingValue(field, entry.value);
    if (value === undefined && entry.status === 'not_yet' && entry.source === null) continue;
    const otherNote = effectiveOtherNote(field, value, entry.otherNote);
    saved[field.key] = {
      ...(value !== undefined ? { value } : {}),
      status: entry.status,
      source: entry.source,
      ...(otherNote !== undefined ? { otherNote } : {}),
    };
  }
  return saved;
}

/**
 * Missing / unconfirmed required items of the form as it would be saved (same result as
 * computeMissingItems(toSavedHearingFields(form))), normalizing only the required keys.
 */
export function computeFormMissingItems(
  form: HearingFields,
  requiredItems: readonly HearingRequiredItem[] = DEFAULT_HEARING_CATALOG.requiredItems
): HearingMissingItems {
  const fields: HearingFields = {};
  for (const item of requiredItems) {
    for (const key of item.keys) {
      const entry = form[key];
      const field = getHearingField(key);
      if (!entry || !field || key in fields) continue;
      fields[key] = { ...entry, value: normalizeHearingValue(field, entry.value) };
    }
  }
  return computeMissingItems(fields, requiredItems);
}

/** Section of each missing key, counted per section (distinct keys) */
export function countBySection(
  keys: readonly HearingFieldKey[],
  catalog: Pick<HearingCatalogView, 'sectionOf'> = DEFAULT_HEARING_CATALOG
): Map<HearingSectionId, number> {
  const counts = new Map<HearingSectionId, number>();
  for (const key of new Set(keys)) {
    const section = catalog.sectionOf.get(key);
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
    // A builder diagnosis keeps its own labels (its ids may match AX question ids)
    const builderLabels = prefill.answerLabels;
    const labels = values.map((value) =>
      builderLabels
        ? (builderLabels[questionId]?.[value] ?? value)
        : (options.find((o) => o.value === value)?.label[locale] ?? value)
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
