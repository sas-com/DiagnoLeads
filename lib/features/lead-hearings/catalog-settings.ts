/**
 * The organization's hearing settings (Refs #98), pure part shared by the server and the
 * screens: which fields it asks, in which order, which are required, and its own fields. Kept
 * in organizations.settings.hearingCatalog (./settings.ts reads and writes it), so the catalog
 * in code stays the base and records keep their values whatever is changed (values are stored
 * by field key).
 *
 * The organization's own fields are never deleted: a field or an option taken away is kept
 * archived (see mergeCustomFields), so older records still read with their names.
 */
import { z } from 'zod';
import {
  HEARING_BASE_CATALOG,
  HEARING_CUSTOM_FIELD_PREFIX,
  HEARING_FIELD_KEYS,
  HEARING_SECTIONS,
  type HearingCatalogOverrides,
  type HearingCustomFieldKey,
  type HearingFieldDefinition,
  type HearingFieldKey,
  type HearingRequiredItem,
  type HearingSectionId,
  getHearingField,
} from './catalog';
import {
  HEARING_CUSTOM_OPTIONS_MAX,
  HEARING_CUSTOM_TEXT_MAX_LENGTH,
  type HearingFields,
} from './types/schemas';

export const HEARING_SETTINGS_KEY = 'hearingCatalog';

/** The organization's own fields, archived ones included */
export const HEARING_CUSTOM_FIELDS_MAX = 30;
export const HEARING_CUSTOM_LABEL_MAX_LENGTH = 60;
export const HEARING_CUSTOM_OPTION_LABEL_MAX_LENGTH = 40;
export const HEARING_CUSTOM_FIELD_TYPES = ['text', 'single', 'multiple'] as const;
export type HearingCustomFieldType = (typeof HEARING_CUSTOM_FIELD_TYPES)[number];

const ID_PATTERN = /^[a-z0-9]{8}$/;
const customId = z.string().regex(ID_PATTERN);

/** A new id for an organization's own field or option */
export function newHearingCustomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => '0123456789abcdefghijklmnopqrstuvwxyz'[byte % 36]).join('');
}

export const customFieldKey = (id: string): HearingCustomFieldKey =>
  `${HEARING_CUSTOM_FIELD_PREFIX}${id}`;

const customOptionSchema = z
  .object({
    id: customId,
    label: z.string().trim().min(1).max(HEARING_CUSTOM_OPTION_LABEL_MAX_LENGTH),
    archived: z.boolean().optional(),
  })
  .strict();

export const hearingCustomFieldSchema = z
  .object({
    id: customId,
    label: z.string().trim().min(1).max(HEARING_CUSTOM_LABEL_MAX_LENGTH),
    type: z.enum(HEARING_CUSTOM_FIELD_TYPES),
    section: z.enum(HEARING_SECTIONS),
    options: z.array(customOptionSchema).max(HEARING_CUSTOM_OPTIONS_MAX).default([]),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine((field) => new Set(field.options.map((o) => o.id)).size === field.options.length, {
    message: 'Option ids must be unique',
  })
  .refine(
    (field) =>
      field.type === 'text'
        ? field.options.length === 0
        : field.archived === true || field.options.some((o) => !o.archived),
    { message: 'A choice field needs an option; a text field has none' }
  );
export type HearingCustomField = z.infer<typeof hearingCustomFieldSchema>;

const BASE_KEYS = new Set<string>(HEARING_FIELD_KEYS);
const CUSTOM_KEY_PATTERN = /^custom:[a-z0-9]{8}$/;
const keyList = z
  .array(
    z
      .string()
      .refine((key) => BASE_KEYS.has(key) || CUSTOM_KEY_PATTERN.test(key), 'Unknown field')
      .transform((key) => key as HearingFieldKey)
  )
  .max(HEARING_FIELD_KEYS.length + HEARING_CUSTOM_FIELDS_MAX)
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
    /** The organization's own fields */
    customFields: z.array(hearingCustomFieldSchema).max(HEARING_CUSTOM_FIELDS_MAX).default([]),
  })
  .superRefine((value, ctx) => {
    // A hidden field cannot be required
    if (value.required?.some((key) => value.hidden.includes(key))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A hidden field cannot be required' });
    }
    const ids = value.customFields.map((field) => field.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Field ids must be unique' });
    }
    // Own fields named in the lists must exist; an archived one cannot be required
    const defined = new Set<string>(ids.map(customFieldKey));
    const active = new Set<string>(
      value.customFields.filter((f) => !f.archived).map((f) => customFieldKey(f.id))
    );
    const lists = [value.hidden, value.required ?? [], ...Object.values(value.order)];
    for (const key of lists.flatMap((list) => list ?? [])) {
      if (CUSTOM_KEY_PATTERN.test(key) && !defined.has(key)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Unknown field ${key}` });
      }
    }
    for (const key of value.required ?? []) {
      if (CUSTOM_KEY_PATTERN.test(key) && !active.has(key)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Archived field ${key} is required` });
      }
    }
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
  customFields: [],
  version: 0,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * Read the stored settings. Keys the catalog no longer has are left out one by one, so removing
 * or renaming a field in code keeps the rest of the organization's choices; a hidden field is
 * not required. Anything unreadable reads as the defaults.
 */
export function readHearingSettings(settings: unknown): StoredHearingSettings {
  const value = isRecord(settings) ? settings[HEARING_SETTINGS_KEY] : undefined;
  if (!isRecord(value)) return DEFAULT_HEARING_SETTINGS;
  const customFields = (Array.isArray(value.customFields) ? value.customFields : [])
    .map((field) => hearingCustomFieldSchema.safeParse(field))
    .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
    .filter((field, index, list) => list.findIndex((f) => f.id === field.id) === index)
    .slice(0, HEARING_CUSTOM_FIELDS_MAX);
  const known = new Set<string>([...BASE_KEYS, ...customFields.map((f) => customFieldKey(f.id))]);
  const active = new Set<string>([
    ...BASE_KEYS,
    ...customFields.filter((f) => !f.archived).map((f) => customFieldKey(f.id)),
  ]);
  const knownKeys = (list: unknown, keep = known): HearingFieldKey[] =>
    Array.isArray(list)
      ? (list.filter((key) => typeof key === 'string' && keep.has(key)) as HearingFieldKey[])
      : [];
  const hidden = knownKeys(value.hidden);
  const storedOrder = isRecord(value.order) ? value.order : {};
  const parsed = hearingSettingsSchema.safeParse({
    hidden,
    required: Array.isArray(value.required)
      ? knownKeys(value.required, active).filter((key) => !hidden.includes(key))
      : null,
    order: Object.fromEntries(
      HEARING_SECTIONS.filter((id) => Array.isArray(storedOrder[id])).map((id) => [
        id,
        knownKeys(storedOrder[id]),
      ])
    ),
    customFields,
  });
  if (!parsed.success) return DEFAULT_HEARING_SETTINGS;
  const version = value.version;
  return { ...parsed.data, version: typeof version === 'number' ? version : 0 };
}

/**
 * The saved own fields with nothing lost: a field or an option left out of the new list is kept
 * archived, and a field keeps its type (older values are of that type). New ones are added.
 */
export function mergeCustomFields(
  previous: readonly HearingCustomField[],
  next: readonly HearingCustomField[]
): HearingCustomField[] {
  const before = new Map(previous.map((field) => [field.id, field]));
  const merged = next.map((field): HearingCustomField => {
    const old = before.get(field.id);
    if (!old) return field;
    const ids = new Set(field.options.map((o) => o.id));
    return {
      ...field,
      type: old.type,
      options:
        old.type === 'text'
          ? []
          : [
              ...field.options,
              ...old.options.filter((o) => !ids.has(o.id)).map((o) => ({ ...o, archived: true })),
            ],
    };
  });
  const kept = new Set(next.map((field) => field.id));
  for (const field of previous) {
    if (!kept.has(field.id)) merged.push({ ...field, archived: true });
  }
  return merged;
}

const localized = (text: string) => ({ ja: text, en: text });

/**
 * An organization's own field as a catalog field. With `selected` (the editor passes the
 * record's value), an archived option stays only when it is chosen there; without it every
 * option stays (reading and checking saved values).
 */
export function customFieldDefinition(
  field: HearingCustomField,
  selected?: unknown
): HearingFieldDefinition {
  const base = {
    key: customFieldKey(field.id),
    section: field.section,
    labelKey: '',
    label: field.label,
  };
  if (field.type === 'text') {
    return { ...base, type: 'text', maxLength: HEARING_CUSTOM_TEXT_MAX_LENGTH };
  }
  const chosen = new Set<unknown>(Array.isArray(selected) ? selected : [selected]);
  return {
    ...base,
    type: field.type,
    options: field.options
      .filter((o) => selected === undefined || !o.archived || chosen.has(o.id))
      .map((o) => ({
        value: o.id,
        label: localized(o.label),
        ...(o.archived ? { archived: true } : {}),
      })),
  };
}

/**
 * The required items for a set of required fields. A base item keeps the fields of it that stay
 * required (and drops out when none do); a required field outside every base item becomes an
 * item of its own, named after the field.
 */
export function requiredItemsFor(
  required: readonly string[] | null,
  customFields: readonly HearingFieldDefinition[] = []
): readonly HearingRequiredItem[] {
  if (required === null) return HEARING_BASE_CATALOG.requiredItems;
  const wanted = new Set(required);
  const inBase = new Set<string>();
  const items = HEARING_BASE_CATALOG.requiredItems.flatMap((item) => {
    for (const key of item.keys) inBase.add(key);
    const keys = item.keys.filter((key) => wanted.has(key));
    return keys.length > 0 ? [{ ...item, keys }] : [];
  });
  const custom = new Map<string, HearingFieldDefinition>(customFields.map((f) => [f.key, f]));
  for (const key of [...HEARING_FIELD_KEYS, ...custom.keys()]) {
    if (!wanted.has(key) || inBase.has(key)) continue;
    const field = getHearingField(key) ?? custom.get(key);
    if (field) {
      items.push({
        id: `field:${key}`,
        labelKey: field.labelKey,
        ...(field.label ? { label: field.label } : {}),
        keys: [key as HearingFieldKey],
      });
    }
  }
  return items;
}

/**
 * The catalog overrides of the settings. With `values` (the record the editor shows), archived
 * options of the organization's own fields stay only where they are chosen.
 */
export function overridesFromSettings(
  settings: HearingSettings,
  values?: HearingFields
): HearingCatalogOverrides {
  const own = settings.customFields ?? [];
  const customFields = own.map((field) =>
    customFieldDefinition(
      field,
      values ? (values[customFieldKey(field.id)]?.value ?? null) : undefined
    )
  );
  const archived = own.filter((field) => field.archived).map((field) => customFieldKey(field.id));
  return {
    hidden: [...settings.hidden, ...archived],
    order: settings.order,
    requiredItems: requiredItemsFor(settings.required, customFields),
    customFields,
  };
}

/** The fields required by default (what the settings screen starts from) */
export const BASE_REQUIRED_KEYS: readonly HearingFieldKey[] = [
  ...new Set(HEARING_BASE_CATALOG.requiredItems.flatMap((item) => item.keys)),
];
