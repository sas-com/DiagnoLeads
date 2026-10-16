import { z } from 'zod';
import {
  type LeadStatus,
  dealPhaseEnum,
  inflowSourceEnum,
  leadPipelineFieldsSchema,
  leadStatusEnum,
  targetSystemEnum,
} from './pipeline';

export { leadStatusEnum };
export type { LeadStatus };

/**
 * Lead source enum
 */
export const leadSourceEnum = z.enum(['website', 'embed', 'api']);
export type LeadSource = z.infer<typeof leadSourceEnum>;

/**
 * Advanced filter operator enum
 */
export const filterOperatorEnum = z.enum([
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
export type FilterOperator = z.infer<typeof filterOperatorEnum>;

/**
 * Advanced filter condition schema
 */
export const filterConditionSchema = z.object({
  field: z.string().min(1),
  operator: filterOperatorEnum,
  value: z.unknown(),
  value2: z.unknown().optional(),
});
export type FilterCondition = z.infer<typeof filterConditionSchema>;

/**
 * Advanced filter group schema (supports nested groups)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const filterGroupSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    logic: z.enum(['and', 'or']),
    conditions: z.array(filterConditionSchema).default([]),
    groups: z.array(filterGroupSchema).optional(),
  })
);
export type FilterGroup = {
  logic: 'and' | 'or';
  conditions: FilterCondition[];
  groups?: FilterGroup[];
};

/**
 * Lead creation schema
 */
export const createLeadSchema = z
  .object({
    organizationId: z.string().uuid(),
    email: z.string().email('有効なメールアドレスを入力してください'),
    name: z.string().optional(),
    company: z.string().optional(),
    phone: z.string().optional(),
    status: leadStatusEnum.default('new'),
    score: z.number().int().min(0).max(100).optional(),
    source: leadSourceEnum.optional(),
    responses: z.record(z.unknown()).default({}),
  })
  .merge(leadPipelineFieldsSchema);
export type CreateLeadInput = z.infer<typeof createLeadSchema>;

/**
 * Lead update schema
 */
export const updateLeadSchema = z
  .object({
    organizationId: z.string().uuid(),
    id: z.string().uuid(),
    email: z.string().email('有効なメールアドレスを入力してください').optional(),
    name: z.string().optional(),
    company: z.string().optional(),
    phone: z.string().optional(),
    status: leadStatusEnum.optional(),
    score: z.number().int().min(0).max(100).optional(),
    source: leadSourceEnum.optional(),
    responses: z.record(z.unknown()).optional(),
  })
  .merge(leadPipelineFieldsSchema);
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;

/**
 * Get lead by ID schema
 */
export const getLeadSchema = z.object({
  organizationId: z.string().uuid(),
  id: z.string().uuid(),
});
export type GetLeadInput = z.infer<typeof getLeadSchema>;

/** Columns the lead list can be sorted by (#131) */
export const LEAD_SORT_KEYS = [
  'createdAt',
  'updatedAt',
  'name',
  'email',
  'company',
  'score',
  'status',
  'dealPhase',
  'lastActivityAt',
  'mqlQualifiedAt',
] as const;
export const leadSortKeyEnum = z.enum(LEAD_SORT_KEYS);
export type LeadSortKey = z.infer<typeof leadSortKeyEnum>;

/** SQL judgement filter: the two decisions, or not decided yet */
export const SQL_DECISION_FILTERS = ['qualified', 'not_qualified', 'undecided'] as const;
export const sqlDecisionFilterEnum = z.enum(SQL_DECISION_FILTERS);
export type SqlDecisionFilter = z.infer<typeof sqlDecisionFilterEnum>;

/** A calendar day in Japan time, 'YYYY-MM-DD' */
export const jstDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((day) => !Number.isNaN(Date.parse(`${day}T00:00:00+09:00`)), 'Invalid date');

/** One value or several (any of them matches); the single form is kept for older callers */
const oneOrMany = <T extends z.ZodTypeAny>(item: T) =>
  z.union([item, z.array(item).max(50)]).optional();

/**
 * List leads schema (#131: sorting and filtering run on the server)
 */
export const listLeadsSchema = z.object({
  organizationId: z.string().uuid(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
  status: oneOrMany(leadStatusEnum),
  source: leadSourceEnum.optional(),
  inflowSource: oneOrMany(inflowSourceEnum),
  dealPhase: oneOrMany(dealPhaseEnum),
  targetSystem: oneOrMany(targetSystemEnum),
  search: z.string().trim().max(200).optional(), // Search in name, email, company
  // Advanced filtering
  advancedFilter: filterGroupSchema.optional(),
  // Sort options
  sortBy: leadSortKeyEnum.optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  // Date range filter (instants)
  createdFrom: z.string().datetime().optional(),
  createdTo: z.string().datetime().optional(),
  // Date range filter in Japan days, both ends included
  createdFromDay: jstDaySchema.optional(),
  createdToDay: jstDaySchema.optional(),
  // Score range filter
  scoreMin: z.number().int().min(0).max(100).optional(),
  scoreMax: z.number().int().min(0).max(100).optional(),
  // Asked for a consultation (conversion point 'consultation')
  consultationRequested: z.boolean().optional(),
  // MQL judged (true) / not judged (false)
  mql: z.boolean().optional(),
  // SQL judgement
  sqlDecision: sqlDecisionFilterEnum.optional(),
  // Tag filter
  tagIds: z.array(z.string().uuid()).optional(),
});
export type ListLeadsInput = z.infer<typeof listLeadsSchema>;

/**
 * Delete lead schema
 */
export const deleteLeadSchema = z.object({
  organizationId: z.string().uuid(),
  id: z.string().uuid(),
});
export type DeleteLeadInput = z.infer<typeof deleteLeadSchema>;

/**
 * Bulk update status schema
 */
export const bulkUpdateStatusSchema = z.object({
  organizationId: z.string().uuid(),
  ids: z.array(z.string().uuid()).min(1, '少なくとも1つのリードを選択してください'),
  status: leadStatusEnum,
});
export type BulkUpdateStatusInput = z.infer<typeof bulkUpdateStatusSchema>;

/**
 * Bulk delete schema
 */
export const bulkDeleteSchema = z.object({
  organizationId: z.string().uuid(),
  ids: z.array(z.string().uuid()).min(1, '少なくとも1つのリードを選択してください'),
});
export type BulkDeleteInput = z.infer<typeof bulkDeleteSchema>;

/**
 * Bulk create schema for importing leads
 */
export const bulkCreateSchema = z.object({
  organizationId: z.string().uuid(),
  leads: z
    .array(
      z.object({
        email: z.string().email(),
        name: z.string().optional(),
        company: z.string().optional(),
        phone: z.string().optional(),
        status: leadStatusEnum.default('new'),
        source: leadSourceEnum.optional(),
        score: z.number().int().min(0).max(100).optional(),
      })
    )
    .min(1, '少なくとも1つのリードを指定してください'),
});
export type BulkCreateInput = z.infer<typeof bulkCreateSchema>;
