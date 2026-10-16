/**
 * Hearing meeting mode helpers (Refs #96)
 *
 * The meeting mode lists the required items in the order of the meeting on one screen and
 * folds the other fields away. These pure helpers decide the default mode, remember the
 * choice, and apply the one-tap "next time" / "not applicable" buttons of an item.
 */

import type {
  HearingCatalogField,
  HearingCatalogView,
  HearingFieldKey,
  HearingItemStatus,
  HearingRequiredItem,
  HearingSectionId,
} from './catalog';
import { getHearingField } from './catalog';
import { entryOf, normalizeHearingValue } from './form';
import type { HearingMissingItems } from './missing';
import type { HearingFields } from './types/schemas';

export const HEARING_EDITOR_MODES = ['meeting', 'detail'] as const;
export type HearingEditorMode = (typeof HEARING_EDITOR_MODES)[number];

/** localStorage key of the mode a user last chose (per user, not per hearing) */
export const hearingModeStorageKey = (userId: string | null | undefined) =>
  `diagnoleads:leadHearings:editorMode:${userId || 'anonymous'}`;

export function parseHearingEditorMode(raw: string | null | undefined): HearingEditorMode | null {
  return raw === 'meeting' || raw === 'detail' ? raw : null;
}

/**
 * Whether anything was recorded on this hearing yet. Values copied from the Web diagnosis do
 * not count until someone confirmed, corrected or picked a status for them.
 */
export function hasRecordedHearingValues(fields: HearingFields): boolean {
  return Object.values(fields).some(
    (entry) =>
      entry !== undefined &&
      (entry.status !== 'not_yet' ||
        entry.source === 'confirmed' ||
        entry.source === 'corrected' ||
        (entry.source === null && entry.value !== undefined))
  );
}

/** A new hearing opens in the meeting mode; one already being filled in the detail mode */
export const defaultHearingEditorMode = (fields: HearingFields): HearingEditorMode =>
  hasRecordedHearingValues(fields) ? 'detail' : 'meeting';

/** Fields of a required item, in the item's order */
export function requiredItemFields(
  catalog: HearingCatalogView,
  item: HearingRequiredItem
): HearingCatalogField[] {
  const byKey = new Map<string, HearingCatalogField>();
  for (const section of catalog.sections) {
    for (const entry of section.fields) byKey.set(entry.field.key, entry);
  }
  return item.keys.flatMap((key) => {
    const entry = byKey.get(key);
    return entry ? [entry] : [];
  });
}

/** Fields that are not part of any required item, per section (empty sections left out) */
export function otherFieldsBySection(
  catalog: HearingCatalogView
): { id: HearingSectionId; fields: HearingCatalogField[] }[] {
  const requiredKeys = new Set<string>(catalog.requiredItems.flatMap((item) => item.keys));
  return catalog.sections
    .map((section) => ({
      id: section.id,
      fields: section.fields.filter(({ field }) => !requiredKeys.has(field.key)),
    }))
    .filter((section) => section.fields.length > 0);
}

/** Every key of the item has this status */
export function itemHasStatus(
  form: HearingFields,
  item: HearingRequiredItem,
  status: HearingItemStatus
): boolean {
  return item.keys.every((key) => entryOf(form, key).status === status);
}

/**
 * The one-tap "next time" / "not applicable" of an item: sets the status on every key of the
 * item. Tapping it again when it is already set takes it back: done when the field has a value,
 * otherwise not yet. Values and sources stay.
 */
export function toggleHearingItemStatus(
  form: HearingFields,
  item: HearingRequiredItem,
  status: HearingItemStatus
): HearingFields {
  const undo = itemHasStatus(form, item, status);
  const next: HearingFields = { ...form };
  for (const key of item.keys) {
    const entry = entryOf(form, key as HearingFieldKey);
    const field = getHearingField(key);
    const hasValue = field ? normalizeHearingValue(field, entry.value) !== undefined : false;
    next[key] = { ...entry, status: undo ? (hasValue ? 'done' : 'not_yet') : status };
  }
  return next;
}

/** "Required n/12": items filled (not applicable counts, next time does not) */
export function meetingProgress(
  missing: Pick<HearingMissingItems, 'missing'>,
  requiredItems: readonly HearingRequiredItem[]
): { filled: number; total: number } {
  const total = requiredItems.length;
  const open = requiredItems.filter((item) => missing.missing.includes(item.id)).length;
  return { filled: total - open, total };
}
