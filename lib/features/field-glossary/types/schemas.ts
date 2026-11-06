import { z } from 'zod';

/** A field key is '<feature>.<field>', e.g. 'leads.status' or 'deals.probability' */
export const FIELD_GLOSSARY_KEY_MAX = 128;
/** How many field keys a single read may ask for (a screen batches the keys it needs) */
export const FIELD_GLOSSARY_KEYS_PER_READ = 200;
/** A description is a few sentences shown in a small popover */
export const FIELD_GLOSSARY_DESCRIPTION_MAX = 1000;
/** Value codes are short enum values */
export const FIELD_GLOSSARY_VALUE_MAX = 64;

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
 * Text of a few lines shown in a popover: line breaks are kept (as \n); every other control or
 * format character and a lone surrogate is refused, like PLAIN_TEXT (lib/utils/plain-text.ts) for
 * one line.
 */
const MULTILINE_TEXT = /^(?:[^\p{Cc}\p{Cf}\p{Cs}]|\n)*$/u;

export const fieldGlossaryDescriptionSchema = z
  .string()
  .transform((text) => text.replace(/\r\n?/g, '\n').trim())
  .pipe(z.string().min(1).max(FIELD_GLOSSARY_DESCRIPTION_MAX).regex(MULTILINE_TEXT));

/**
 * The editor's view of the dictionary (#800). The organizationId is the caller's organization:
 * only owners and admins of the operator's organization are editors. The dictionary itself is not
 * scoped by it (decision 2026-10-26-field-glossary-site-wide).
 */
export const listFieldGlossaryForEditorSchema = z.object({
  organizationId: z.string().uuid(),
});

/**
 * Write the help of a listed field (value null) or of one of its listed values. The router checks
 * the key and the value against GLOSSARY_FIELDS. English is optional: the screens fall back to
 * Japanese.
 */
export const upsertFieldGlossarySchema = z.object({
  organizationId: z.string().uuid(),
  fieldKey: z.string().min(1).max(FIELD_GLOSSARY_KEY_MAX),
  value: z.string().min(1).max(FIELD_GLOSSARY_VALUE_MAX).nullable(),
  descriptionJa: fieldGlossaryDescriptionSchema,
  descriptionEn: fieldGlossaryDescriptionSchema.nullable(),
});

export type UpsertFieldGlossaryInput = z.infer<typeof upsertFieldGlossarySchema>;

export const deleteFieldGlossarySchema = z.object({
  organizationId: z.string().uuid(),
  id: z.string().uuid(),
});
