/**
 * The organization's hearing settings (Refs #98), pure part shared by the server and the
 * screens: which fields it asks, in which order, and which are required. Kept in
 * organizations.settings.hearingCatalog (./settings.ts reads and writes it), so the catalog in
 * code stays the base and records keep their values whatever is changed (values are stored by
 * field key).
 */
import { z } from 'zod';
import {
  HEARING_BASE_CATALOG,
  HEARING_FIELD_KEYS,
  HEARING_SECTIONS,
  type HearingCatalogOverrides,
  type HearingFieldKey,
  type HearingRequiredItem,
  type HearingSectionId,
  getHearingField,
} from './catalog';

export const HEARING_SETTINGS_KEY = 'hearingCatalog';

const fieldKey = z.enum(HEARING_FIELD_KEYS as [HearingFieldKey, ...HearingFieldKey[]]);
const keyList = z
  .array(fieldKey)
  .max(HEARING_FIELD_KEYS.length)
  .transform((keys) => [...new Set(keys)]);

export const hearingSettingsSchema = z
  .object({
    /** Fields the organization does not ask */
    hidden: keyList.default([]),
    /** Fields that must be filled; null keeps the base required items */
    required: keyList.nullable().default(null),
    /** Field order per section */
    order: z
      .object(
        Object.fromEntries(HEARING_SECTIONS.map((id) => [id, keyList.optional()])) as Record<
          HearingSectionId,
          z.ZodOptional<typeof keyList>
        >
      )
      .partial()
      .default({}),
  })
  // A hidden field cannot be required
  .refine((value) => !value.required?.some((key) => value.hidden.includes(key)), {
    message: 'A hidden field cannot be required',
  });
export type HearingSettings = z.infer<typeof hearingSettingsSchema>;

/** Stored with the settings: the version goes up on each save (written to the audit log) */
export interface StoredHearingSettings extends HearingSettings {
  version: number;
}

export const DEFAULT_HEARING_SETTINGS: StoredHearingSettings = {
  hidden: [],
  required: null,
  order: {},
  version: 0,
};

/** Read the stored settings; broken values read as the defaults */
export function readHearingSettings(settings: unknown): StoredHearingSettings {
  const value =
    settings && typeof settings === 'object' && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)[HEARING_SETTINGS_KEY]
      : undefined;
  if (!value || typeof value !== 'object') return DEFAULT_HEARING_SETTINGS;
  const parsed = hearingSettingsSchema.safeParse(value);
  if (!parsed.success) return DEFAULT_HEARING_SETTINGS;
  const version = (value as { version?: unknown }).version;
  return { ...parsed.data, version: typeof version === 'number' ? version : 0 };
}

/**
 * The required items for a set of required fields. A base item keeps the fields of it that stay
 * required (and drops out when none do); a required field outside every base item becomes an
 * item of its own, named after the field.
 */
export function requiredItemsFor(
  required: readonly string[] | null
): readonly HearingRequiredItem[] {
  if (required === null) return HEARING_BASE_CATALOG.requiredItems;
  const wanted = new Set(required);
  const inBase = new Set<string>();
  const items = HEARING_BASE_CATALOG.requiredItems.flatMap((item) => {
    for (const key of item.keys) inBase.add(key);
    const keys = item.keys.filter((key) => wanted.has(key));
    return keys.length > 0 ? [{ ...item, keys }] : [];
  });
  for (const key of HEARING_FIELD_KEYS) {
    if (!wanted.has(key) || inBase.has(key)) continue;
    const field = getHearingField(key);
    if (field) items.push({ id: `field:${key}`, labelKey: field.labelKey, keys: [key] });
  }
  return items;
}

/** The catalog overrides of the settings */
export function overridesFromSettings(settings: HearingSettings): HearingCatalogOverrides {
  return {
    hidden: settings.hidden,
    order: settings.order,
    requiredItems: requiredItemsFor(settings.required),
  };
}

/** The fields required by default (what the settings screen starts from) */
export const BASE_REQUIRED_KEYS: readonly HearingFieldKey[] = [
  ...new Set(HEARING_BASE_CATALOG.requiredItems.flatMap((item) => item.keys)),
];
