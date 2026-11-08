import { z } from 'zod';

/** A field key is '<feature>.<field>', e.g. 'leads.status' or 'deals.probability' */
export const FIELD_GLOSSARY_KEY_MAX = 128;
/** How many field keys a single read may ask for (a screen batches the keys it needs) */
export const FIELD_GLOSSARY_KEYS_PER_READ = 200;
/** Limits for an entry's fields (the DB also enforces value is non-empty with a CHECK) */
export const FIELD_GLOSSARY_VALUE_MAX = 128;
export const FIELD_GLOSSARY_LABEL_MAX = 120;
export const FIELD_GLOSSARY_DESCRIPTION_MAX = 2000;
/** How many entries the edit page lists at once (the dictionary is small) */
export const FIELD_GLOSSARY_LIST_LIMIT = 1000;

/** A field key: dot-separated segments starting with a letter, e.g. 'leads.status' */
const fieldKeySchema = z
  .string()
  .min(1)
  .max(FIELD_GLOSSARY_KEY_MAX)
  .regex(
    /^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/,
    'field_key は "leads.status" の形式で入力してください'
  );

/**
 * Read help for these field keys at once. The dictionary is site-wide, so there is no
 * organizationId (decision 2026-10-26-field-glossary-site-wide).
 */
export const getFieldGlossarySchema = z.object({
  keys: z
    .array(z.string().min(1).max(FIELD_GLOSSARY_KEY_MAX))
    .min(1)
    .max(FIELD_GLOSSARY_KEYS_PER_READ),
});

export type GetFieldGlossaryInput = z.infer<typeof getFieldGlossarySchema>;

/**
 * Insert (no id) or update (id) one entry. `value` is trimmed and non-empty, or null for the
 * field-level entry (its emptiness is also guarded by the DB CHECK). Label and description are
 * trimmed; the router turns blank ones into null so no dead empty strings are stored.
 */
export const upsertFieldGlossarySchema = z.object({
  id: z.string().uuid().optional(),
  fieldKey: fieldKeySchema,
  value: z.string().trim().min(1).max(FIELD_GLOSSARY_VALUE_MAX).nullable().default(null),
  labelJa: z.string().max(FIELD_GLOSSARY_LABEL_MAX).nullable().default(null),
  labelEn: z.string().max(FIELD_GLOSSARY_LABEL_MAX).nullable().default(null),
  descriptionJa: z.string().max(FIELD_GLOSSARY_DESCRIPTION_MAX).nullable().default(null),
  descriptionEn: z.string().max(FIELD_GLOSSARY_DESCRIPTION_MAX).nullable().default(null),
  sortOrder: z.number().int().min(0).max(100000).default(0),
});

export type UpsertFieldGlossaryInput = z.infer<typeof upsertFieldGlossarySchema>;

export const deleteFieldGlossarySchema = z.object({ id: z.string().uuid() });
