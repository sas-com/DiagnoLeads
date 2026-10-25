/**
 * Inputs of the saved filters (filters.create and filters.update, #669). A saved filter is
 * stored as it is sent (saved_filters.filters, jsonb): nothing turns it into SQL yet and no
 * screen calls the router, so these limits bound what is stored. They do not bound the work of
 * checking one request: zod v3 still checks every element of an array past its .max(), so that
 * work is bounded by the size of the request body (about 4.5MB on Vercel).
 *
 * The saved filters keep their own schema rather than reading the lead list's advanced filter
 * (lib/features/leads/types/schemas.ts), which #699 deletes.
 */
import { z } from 'zod';

/**
 * Limits of a saved filter: the same numbers as the lead list's advanced filter got in #604
 * (decision 2026-10-25-lead-input-count-limits), kept here on their own. A field name is a short
 * key (the router lists the lead fields in getFilterMetadata but does not map them); a text
 * value is as long as the lead list's search takes.
 */
export const SAVED_FILTER_LIMITS = {
  /** Levels of groups, the top group included */
  depth: 3,
  /** Groups directly in one group */
  groups: 10,
  /** Conditions of the whole filter, every group counted */
  conditions: 50,
  /** Characters of a field name */
  fieldLength: 50,
  /** Characters of a text value */
  valueLength: 200,
  /** Values of a list (in, not_in) */
  values: 50,
} as const;

/** The operators of a condition (the same as FilterOperator of saved_filters in lib/db/schema.ts) */
export const savedFilterOperatorSchema = z.enum([
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'greater_than',
  'less_than',
  'greater_or_equal',
  'less_or_equal',
  'between',
  'is_empty',
  'is_not_empty',
  'in',
  'not_in',
]);

/** One value a condition compares with: text, a number, a boolean or a date (superjson) */
const savedFilterScalarSchema = z.union([
  z.string().max(SAVED_FILTER_LIMITS.valueLength),
  z.number().finite(),
  z.boolean(),
  z.date(),
]);

/** The value of a condition: one value, none (null), or a list for in and not_in */
const savedFilterValueSchema = z.union([
  savedFilterScalarSchema,
  z.null(),
  z.array(savedFilterScalarSchema).max(SAVED_FILTER_LIMITS.values),
]);

export const savedFilterConditionSchema = z.object({
  field: z.string().min(1).max(SAVED_FILTER_LIMITS.fieldLength),
  operator: savedFilterOperatorSchema,
  value: savedFilterValueSchema.optional(),
  value2: savedFilterValueSchema.optional(),
});
export type SavedFilterCondition = z.infer<typeof savedFilterConditionSchema>;

export type SavedFilterGroup = {
  logic: 'and' | 'or';
  conditions: SavedFilterCondition[];
  groups?: SavedFilterGroup[];
};

/**
 * A group of `levels` levels of groups, itself included. Built level by level rather than with
 * z.lazy (as #604 did for the lead list), so a group nested past the limit is refused with a zod
 * issue where the limit is reached and nothing below it is parsed: the recursive schema walked
 * down every level until the stack ran out (about 800 levels), and safeParse threw a RangeError.
 * Through HTTP, superjson copies the input recursively before zod runs, so a group nested deeper
 * than about a thousand levels is refused there first, with tRPC's own BAD_REQUEST.
 */
function savedFilterGroupLevels(
  levels: number
): z.ZodType<SavedFilterGroup, z.ZodTypeDef, unknown> {
  const groups =
    levels > 1
      ? z.array(savedFilterGroupLevels(levels - 1)).max(SAVED_FILTER_LIMITS.groups)
      : z.array(z.never()).max(0, `条件のグループは${SAVED_FILTER_LIMITS.depth}段までです`);
  return z.object({
    logic: z.enum(['and', 'or']),
    conditions: z.array(savedFilterConditionSchema).max(SAVED_FILTER_LIMITS.conditions).default([]),
    groups: groups.optional(),
  });
}

/** Conditions of a group and of the groups in it (as deep as the schema lets them be) */
function countSavedFilterConditions(group: SavedFilterGroup): number {
  return (group.groups ?? []).reduce(
    (count, nested) => count + countSavedFilterConditions(nested),
    group.conditions.length
  );
}

/**
 * The conditions of a saved filter: groups nested up to SAVED_FILTER_LIMITS.depth levels, with
 * SAVED_FILTER_LIMITS.conditions conditions in all
 */
export const savedFilterGroupSchema: z.ZodType<SavedFilterGroup, z.ZodTypeDef, unknown> =
  savedFilterGroupLevels(SAVED_FILTER_LIMITS.depth).refine(
    (group) => countSavedFilterConditions(group) <= SAVED_FILTER_LIMITS.conditions,
    `条件は全体で${SAVED_FILTER_LIMITS.conditions}個までです`
  );
