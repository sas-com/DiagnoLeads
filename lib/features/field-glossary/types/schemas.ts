import { z } from 'zod';

/** A field key is '<feature>.<field>', e.g. 'leads.status' or 'deals.probability' */
export const FIELD_GLOSSARY_KEY_MAX = 128;
/** How many field keys a single read may ask for (a screen batches the keys it needs) */
export const FIELD_GLOSSARY_KEYS_PER_READ = 200;

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
