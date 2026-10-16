/**
 * Required hearing items that are still open (Refs #84)
 *
 * Shown as a warning before agreeing on the next meeting; saving is never blocked.
 * - missing: not filled. "Not applicable" counts as filled; "next time" counts as missing.
 * - unconfirmed: still holding the Web diagnosis value that nobody confirmed in the meeting.
 */

import { DEFAULT_HEARING_CATALOG, type HearingFieldKey, type HearingRequiredItem } from './catalog';
import type { HearingFieldEntry, HearingFields } from './types/schemas';

export interface HearingMissingItems {
  /** Required item ids with at least one key not filled */
  missing: string[];
  missingKeys: HearingFieldKey[];
  /** Required item ids with at least one key still sourced from the diagnosis */
  unconfirmed: string[];
  unconfirmedKeys: HearingFieldKey[];
}

function hasValue(entry: HearingFieldEntry): boolean {
  const { value } = entry;
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.values(value).some((v) => v !== undefined);
  return true;
}

export function isHearingEntryFilled(entry: HearingFieldEntry | undefined): boolean {
  if (!entry) return false;
  if (entry.status === 'not_applicable') return true;
  if (entry.status === 'not_yet' || entry.status === 'next') return false;
  return hasValue(entry);
}

export function computeMissingItems(
  fields: HearingFields,
  requiredItems: readonly HearingRequiredItem[] = DEFAULT_HEARING_CATALOG.requiredItems
): HearingMissingItems {
  const result: HearingMissingItems = {
    missing: [],
    missingKeys: [],
    unconfirmed: [],
    unconfirmedKeys: [],
  };
  for (const item of requiredItems) {
    const missingKeys = item.keys.filter((key) => !isHearingEntryFilled(fields[key]));
    const unconfirmedKeys = item.keys.filter((key) => fields[key]?.source === 'prefilled');
    if (missingKeys.length > 0) {
      result.missing.push(item.id);
      result.missingKeys.push(...missingKeys);
    }
    if (unconfirmedKeys.length > 0) {
      result.unconfirmed.push(item.id);
      result.unconfirmedKeys.push(...unconfirmedKeys);
    }
  }
  return result;
}
