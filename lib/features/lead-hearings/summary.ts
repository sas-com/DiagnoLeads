/**
 * Meeting summary built from a hearing (Refs #97)
 *
 * A fixed layout filled with the recorded values; nothing is sent to an external AI. The result
 * is structured data (sections → items with value, status, source and flags, plus the lists of
 * what to confirm next time and what changed since the previous hearing) so the screen, the
 * plain-text copy, the follow-up tasks (#85) and the handoff sheet (#86) all read the same thing.
 *
 * Pure: labels come from a translator over the same locale keys the editor uses, and the field
 * definitions from the resolved catalog, so organization overrides (#98) flow through.
 */

import type { DiagnosticLocale } from '@/lib/features/diagnostics/types';
import type {
  HearingCatalogView,
  HearingFieldDefinition,
  HearingFieldKey,
  HearingItemStatus,
  HearingOption,
  HearingSectionId,
  HearingValueSource,
} from './catalog';
import { isOtherOption, isUnconfirmedSource } from './catalog';
import { effectiveOtherNote, normalizeHearingValue } from './form';
import { computeMissingItems } from './missing';
import type { HearingFieldEntry, HearingFieldValue, HearingFields } from './types/schemas';

/** Looks up a locale message by its full key, e.g. 'leadHearings.fields.scale' */
export type HearingSummaryTranslate = (
  key: string,
  values?: Record<string, string | number>
) => string;

export interface HearingSummaryLabels {
  t: HearingSummaryTranslate;
  /** Language of the Web diagnosis labels and of list separators */
  locale: DiagnosticLocale;
}

/** 現状／課題／要件／評価 */
export const HEARING_SUMMARY_SECTIONS = [
  'currentSystem',
  'challenges',
  'requirements',
  'result',
] as const;
export type HearingSummarySectionId = (typeof HEARING_SUMMARY_SECTIONS)[number];

/** Which fields each summary section shows, in this order */
export const HEARING_SUMMARY_LAYOUT: Record<HearingSummarySectionId, readonly HearingFieldKey[]> = {
  currentSystem: [
    'targetSystem',
    'machineModel',
    'scale',
    'businessAreas',
    'inHouseExperts',
    'earliestRetirement',
    'vendorSupport',
    'hardwareSupportEnd',
  ],
  challenges: [
    'topChallenge',
    'challengeLevels',
    'impactIfUnaddressed',
    'pastConsideration',
    'pastBlockers',
  ],
  requirements: [
    'decisionMakerPresent',
    'directionTiming',
    'budgetStatus',
    'competitorTypes',
    'aiSourceAnalysis',
    'aiSourceAnalysisConditions',
  ],
  result: ['dealRating', 'nextMeetingDate', 'nextMeetingAttendees'],
};

export interface HearingSummaryItem {
  key: HearingFieldKey;
  label: string;
  /** The value as text, or null when nothing (complete) was recorded */
  value: string | null;
  status: HearingItemStatus;
  source: HearingValueSource | null;
  required: boolean;
  flags: {
    /** Required, and still the Web diagnosis value nobody confirmed */
    unconfirmed: boolean;
    /** Marked "next time" */
    next: boolean;
    /** Required and not filled ("next time" counts as not filled) */
    missing: boolean;
    /** The value differs from the previous hearing */
    changed: boolean;
  };
}

export interface HearingSummarySection {
  id: HearingSummarySectionId;
  title: string;
  items: HearingSummaryItem[];
}

/** One field to confirm next time; section is where the field sits in the editor */
export interface HearingSummaryTodo {
  key: HearingFieldKey;
  label: string;
  section: HearingSectionId;
}

export interface HearingSummaryChange {
  key: HearingFieldKey;
  label: string;
  before: string | null;
  after: string | null;
}

export interface HearingSummary {
  heldOn: string;
  lead: { name: string | null; company: string | null } | null;
  sections: HearingSummarySection[];
  /** Required fields still holding the Web diagnosis value */
  unconfirmed: HearingSummaryTodo[];
  /** Fields marked "next time" (required or not) */
  next: HearingSummaryTodo[];
  /** Required fields not filled */
  missing: HearingSummaryTodo[];
  /** null when there is no previous hearing (then changedSincePrevious is empty) */
  previousHeldOn: string | null;
  changedSincePrevious: HearingSummaryChange[];
}

export interface HearingSummaryInput {
  heldOn: string;
  fields: HearingFields;
  lead?: { name: string | null; company: string | null } | null;
}

// ── Values as text ──────────────────────────────────────────────────────────────

const separator = (locale: DiagnosticLocale) => (locale === 'ja' ? '、' : ', ');

function optionLabel(
  options: readonly HearingOption[],
  value: string,
  labels: HearingSummaryLabels
): string {
  const option = options.find((o) => o.value === value);
  if (!option) return value;
  if (option.labelKey) return labels.t(option.labelKey);
  return option.label?.[labels.locale] ?? value;
}

/**
 * A stored value as the text shown in the summary (null when there is no complete value). The
 * note of an "other" option follows its label: "Other (note)".
 */
export function hearingValueText(
  field: HearingFieldDefinition,
  raw: HearingFieldValue | undefined,
  labels: HearingSummaryLabels,
  otherNote?: string
): string | null {
  const value = normalizeHearingValue(field, raw);
  if (value === undefined) return null;
  const { t, locale } = labels;
  const note = effectiveOtherNote(field, value, otherNote);
  const choiceLabel = (options: readonly HearingOption[], v: string) => {
    const text = optionLabel(options, v, labels);
    return note !== undefined && isOtherOption(v)
      ? t('leadHearings.summary.otherNote', { label: text, note })
      : text;
  };
  switch (field.type) {
    case 'single':
      return choiceLabel(field.options, value as string);
    case 'multiple':
      return (value as string[]).map((v) => choiceLabel(field.options, v)).join(separator(locale));
    case 'text':
      return value as string;
    case 'number':
      return field.unit === 'month'
        ? t('leadHearings.editor.monthOption', { month: value as number })
        : new Intl.NumberFormat(locale).format(value as number);
    case 'yearMonth': {
      const [year, month] = (value as string).split('-');
      return t('leadHearings.summary.yearMonth', { year, month: Number(month), mm: month });
    }
    case 'date':
      return hearingSummaryDate(value as string, t);
    case 'levels': {
      const levels = value as Partial<Record<string, string>>;
      const parts = field.items
        .filter((item) => levels[item.value])
        .map((item) =>
          t('leadHearings.summary.pair', {
            name: optionLabel(field.items, item.value, labels),
            value: optionLabel(field.levels, levels[item.value] as string, labels),
          })
        );
      return parts.length > 0 ? parts.join(separator(locale)) : null;
    }
    case 'scale': {
      const { basis, bucket } = value as { basis: string; bucket: string };
      const base = field.bases.find((b) => b.questionId === basis);
      if (!base) return null;
      return t('leadHearings.summary.pair', {
        name: base.label[locale],
        value: optionLabel(base.buckets, bucket, labels),
      });
    }
  }
}

/** Order-independent form of a value (and its "other" note), for comparing two hearings */
function canonical(value: HearingFieldValue | undefined, otherNote?: string): string {
  if (otherNote !== undefined) return `${canonical(value)}|${JSON.stringify(otherNote)}`;
  if (value === undefined) return 'null';
  if (typeof value === 'object' && !Array.isArray(value)) {
    const sorted = Object.keys(value)
      .sort()
      .map((key) => [key, (value as Record<string, unknown>)[key]]);
    return JSON.stringify(sorted);
  }
  return JSON.stringify(value);
}

// ── Summary ─────────────────────────────────────────────────────────────────────

/**
 * Build the summary of a hearing.
 * - Sections show the layout fields the (resolved) catalog has; a field an organization hid
 *   is left out.
 * - unconfirmed / missing follow the catalog's required items (same rules as the editor's
 *   warning, see missing.ts); next lists every field marked "next time".
 * - changedSincePrevious compares the values (not the statuses) of every catalog field with
 *   the previous hearing; a value added or removed counts as a change.
 */
export function buildHearingSummary(
  hearing: HearingSummaryInput,
  catalog: HearingCatalogView,
  labels: HearingSummaryLabels,
  previous?: { heldOn: string; fields: HearingFields } | null
): HearingSummary {
  const { t } = labels;
  const fields = hearing.fields;
  const catalogFields = new Map(
    catalog.sections.flatMap((section) =>
      section.fields.map((entry) => [entry.field.key as HearingFieldKey, entry] as const)
    )
  );
  const label = (key: HearingFieldKey) => {
    const field = catalogFields.get(key)?.field;
    return field ? t(field.labelKey) : key;
  };
  const todo = (key: HearingFieldKey): HearingSummaryTodo => ({
    key,
    label: label(key),
    section: catalog.sectionOf.get(key) ?? catalog.sections[0].id,
  });
  const distinct = (keys: readonly HearingFieldKey[]) =>
    [...new Set(keys)].filter((key) => catalogFields.has(key));

  // Normalized values, so a half-entered value counts as empty everywhere
  const normalized: HearingFields = {};
  for (const [key, { field }] of catalogFields) {
    const entry = fields[key];
    if (entry) normalized[key] = { ...entry, value: normalizeHearingValue(field, entry.value) };
  }
  const open = computeMissingItems(normalized, catalog.requiredItems);
  const unconfirmedKeys = distinct(open.unconfirmedKeys);
  const missingKeys = distinct(open.missingKeys);
  const nextKeys = [...catalogFields.keys()].filter((key) => fields[key]?.status === 'next');

  const changes: HearingSummaryChange[] = [];
  if (previous) {
    const noteOf = (field: HearingFieldDefinition, entry: HearingFieldEntry | undefined) =>
      effectiveOtherNote(field, normalizeHearingValue(field, entry?.value), entry?.otherNote);
    for (const [key, { field }] of catalogFields) {
      const before = normalizeHearingValue(field, previous.fields[key]?.value);
      const after = normalizeHearingValue(field, fields[key]?.value);
      const noteBefore = noteOf(field, previous.fields[key]);
      const noteAfter = noteOf(field, fields[key]);
      if (canonical(before, noteBefore) === canonical(after, noteAfter)) continue;
      changes.push({
        key,
        label: t(field.labelKey),
        before: hearingValueText(field, before, labels, noteBefore),
        after: hearingValueText(field, after, labels, noteAfter),
      });
    }
  }
  const changedKeys = new Set(changes.map((change) => change.key));

  const sections = HEARING_SUMMARY_SECTIONS.map((id) => ({
    id,
    title: t(`leadHearings.summary.sections.${id}`),
    items: HEARING_SUMMARY_LAYOUT[id].flatMap((key): HearingSummaryItem[] => {
      const entry = catalogFields.get(key);
      if (!entry) return [];
      const stored = fields[key];
      return [
        {
          key,
          label: t(entry.field.labelKey),
          value: hearingValueText(entry.field, stored?.value, labels, stored?.otherNote),
          status: stored?.status ?? 'not_yet',
          source: stored?.source ?? null,
          required: entry.required,
          flags: {
            unconfirmed: unconfirmedKeys.includes(key),
            next: stored?.status === 'next',
            missing: missingKeys.includes(key),
            changed: changedKeys.has(key),
          },
        },
      ];
    }),
  }));

  return {
    heldOn: hearing.heldOn,
    lead: hearing.lead ?? null,
    sections,
    unconfirmed: unconfirmedKeys.map(todo),
    next: nextKeys.map(todo),
    missing: missingKeys.map(todo),
    previousHeldOn: previous?.heldOn ?? null,
    changedSincePrevious: changes,
  };
}

// ── What to confirm next time ───────────────────────────────────────────────────

export type HearingTodoReason = 'unconfirmed' | 'next' | 'missing';

export interface HearingSummaryTodoEntry extends HearingSummaryTodo {
  /** Why it is listed (unconfirmed → next → missing; missing only when alone) */
  reasons: HearingTodoReason[];
}

/**
 * 次回に確認すること: the unconfirmed, "next time" and missing fields, each field once (a
 * diagnosis value nobody confirmed is usually also not filled), in that order.
 */
export function hearingSummaryTodos(
  summary: Pick<HearingSummary, 'unconfirmed' | 'next' | 'missing'>
): HearingSummaryTodoEntry[] {
  const byKey = new Map<HearingFieldKey, HearingSummaryTodoEntry>();
  const lists: [HearingTodoReason, readonly HearingSummaryTodo[]][] = [
    ['unconfirmed', summary.unconfirmed],
    ['next', summary.next],
    ['missing', summary.missing],
  ];
  for (const [reason, list] of lists) {
    for (const item of list) {
      const existing = byKey.get(item.key);
      if (existing) {
        if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
      } else {
        byKey.set(item.key, { ...item, reasons: [reason] });
      }
    }
  }
  // "Missing" only adds something when nothing else explains why the field is open: a
  // diagnosis value nobody confirmed, or one put off to next time, is also "not filled"
  return [...byKey.values()].map((entry) =>
    entry.reasons.length > 1
      ? { ...entry, reasons: entry.reasons.filter((reason) => reason !== 'missing') }
      : entry
  );
}

// ── Plain text ──────────────────────────────────────────────────────────────────

/** "Company / Name" of the lead, or null when neither is known */
export function hearingSummaryLeadName(summary: Pick<HearingSummary, 'lead'>): string | null {
  const parts = [summary.lead?.company, summary.lead?.name].filter(
    (part): part is string => typeof part === 'string' && part.trim() !== ''
  );
  return parts.length > 0 ? parts.join(' / ') : null;
}

/** 'YYYY-MM-DD' as a locale date */
export function hearingSummaryDate(value: string, t: HearingSummaryTranslate): string {
  const [year, month, day] = value.split('-');
  return t('leadHearings.summary.date', {
    year,
    month: Number(month),
    day: Number(day),
    mm: month,
    dd: day,
  });
}

/** The value of an item as written in the summary: the value, or why there is none */
export function hearingSummaryItemText(
  item: Pick<HearingSummaryItem, 'value' | 'status'>,
  t: HearingSummaryTranslate
): string {
  if (item.value !== null) return item.value;
  if (item.status === 'not_applicable' || item.status === 'next') {
    return t(`leadHearings.statuses.${item.status}`);
  }
  return t('leadHearings.summary.empty');
}

/**
 * Split the items of a section for the screen: the ones with something to show (a value, or
 * "not applicable" / "next time") and the ones with nothing recorded. The screen folds the
 * empty ones into one line; the required ones among them are listed again under
 * 次回に確認すること, so listing each of them as its own row only repeats that list.
 */
export function splitHearingSummaryItems<T extends Pick<HearingSummaryItem, 'value' | 'status'>>(
  items: readonly T[]
): { filled: T[]; empty: T[] } {
  const filled: T[] = [];
  const empty: T[] = [];
  for (const item of items) {
    const recorded =
      item.value !== null || item.status === 'not_applicable' || item.status === 'next';
    (recorded ? filled : empty).push(item);
  }
  return { filled, empty };
}

const reasonText = (reasons: readonly HearingTodoReason[], t: HearingSummaryTranslate) =>
  reasons.map((reason) => t(`leadHearings.summary.reasons.${reason}`)).join(' / ');

/**
 * The summary as plain text to paste into an email or a chat: a title with the lead and the
 * meeting date, one short block per section, 次回に確認すること (de-duplicated) and, when there
 * is a previous hearing, what changed since then.
 */
export function formatHearingSummaryText(
  summary: HearingSummary,
  t: HearingSummaryTranslate
): string {
  const lines: string[] = [];
  const date = hearingSummaryDate(summary.heldOn, t);
  const lead = hearingSummaryLeadName(summary);
  lines.push(
    lead
      ? t('leadHearings.summary.text.title', { lead, date })
      : t('leadHearings.summary.text.titleNoLead', { date })
  );

  const heading = (title: string) => {
    lines.push('', t('leadHearings.summary.text.heading', { title }));
  };
  const bullet = (text: string) => lines.push(t('leadHearings.summary.text.bullet', { text }));

  for (const section of summary.sections) {
    if (section.items.length === 0) continue;
    heading(section.title);
    for (const item of section.items) {
      let value = hearingSummaryItemText(item, t);
      if (item.value !== null && item.status === 'partial') {
        value = t('leadHearings.summary.text.note', {
          text: value,
          note: t('leadHearings.statuses.partial'),
        });
      }
      if (item.value !== null && isUnconfirmedSource(item.source)) {
        value = t('leadHearings.summary.text.note', {
          text: value,
          note: t('leadHearings.summary.reasons.unconfirmed'),
        });
      }
      bullet(t('leadHearings.summary.pair', { name: item.label, value }));
    }
  }

  heading(t('leadHearings.summary.todoTitle'));
  const todos = hearingSummaryTodos(summary);
  if (todos.length === 0) bullet(t('leadHearings.summary.none'));
  for (const todo of todos) {
    bullet(
      t('leadHearings.summary.text.note', { text: todo.label, note: reasonText(todo.reasons, t) })
    );
  }

  if (summary.previousHeldOn) {
    heading(
      t('leadHearings.summary.changedTitle', {
        date: hearingSummaryDate(summary.previousHeldOn, t),
      })
    );
    if (summary.changedSincePrevious.length === 0) bullet(t('leadHearings.summary.noChanges'));
    for (const change of summary.changedSincePrevious) {
      bullet(
        t('leadHearings.summary.text.change', {
          name: change.label,
          before: change.before ?? t('leadHearings.summary.empty'),
          after: change.after ?? t('leadHearings.summary.empty'),
        })
      );
    }
  }

  return lines.join('\n');
}
