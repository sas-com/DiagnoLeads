import { actTimingFilterEnum } from '@/lib/features/act-timing/types/schemas';
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
 * Most values one filter of the list takes: the ids of tagIds and the values of a filter given
 * several (status, dealPhase and the others, oneOrMany) (#604)
 */
export const LEAD_FILTER_MAX_VALUES = 50;

/**
 * Longest contact values a lead takes (#575), the same as the public diagnosis forms (AX
 * migration, builder) take them. The DB columns are `text`, so these are the only limits.
 * The names of the inflow (agencyName, referrerName) take 200 (leadPipelineFieldsSchema).
 */
export const LEAD_TEXT_MAX_LENGTH = {
  name: 100,
  company: 200,
  email: 254,
  phone: 30,
} as const;
export type LeadTextField = keyof typeof LEAD_TEXT_MAX_LENGTH;

/**
 * A contact value of the lead, refused over its limit with the Japanese message of
 * `validation.maxLength` (locales/ja). A form passing its own error map (the lead page's cards,
 * the new lead form) shows the message in the page's language instead; the import reads the
 * limit from the issue and leaves the wording to its screen (import-service.ts).
 *
 * As the public forms do for the name, company and email, the value is trimmed before it is
 * counted (and kept trimmed), and the length is counted in UTF-16 code units: a character outside
 * the BMP (𠮷) or a decomposed one (か followed by a combining mark) counts as 2.
 */
export function leadTextSchema(field: LeadTextField) {
  const max = LEAD_TEXT_MAX_LENGTH[field];
  return z
    .string({
      errorMap: (issue, ctx) =>
        issue.code === z.ZodIssueCode.too_big
          ? { message: `最大${max}文字までです` }
          : { message: ctx.defaultError },
    })
    .trim()
    .max(max);
}

/**
 * Longest diagnostic responses written through leads.create / leads.update, as compact JSON
 * (#575). The screens send none: a new lead gets {} and the diagnoses write their own.
 */
export const LEAD_RESPONSES_MAX_CHARS = 20_000;

/** Whether the responses fit LEAD_RESPONSES_MAX_CHARS (false when they are no JSON, e.g. a BigInt) */
function responsesFit(responses: Record<string, unknown>): boolean {
  try {
    return JSON.stringify(responses).length <= LEAD_RESPONSES_MAX_CHARS;
  } catch {
    return false;
  }
}

const leadResponsesSchema = z
  .record(z.unknown())
  .refine(responsesFit, `診断の回答は JSON で最大${LEAD_RESPONSES_MAX_CHARS}文字までです`);

/**
 * Lead creation schema
 */
export const createLeadSchema = z
  .object({
    organizationId: z.string().uuid(),
    email: leadTextSchema('email').email('有効なメールアドレスを入力してください'),
    name: leadTextSchema('name').optional(),
    company: leadTextSchema('company').optional(),
    phone: leadTextSchema('phone').optional(),
    status: leadStatusEnum.default('new'),
    score: z.number().int().min(0).max(100).optional(),
    source: leadSourceEnum.optional(),
    responses: leadResponsesSchema.default({}),
  })
  .merge(leadPipelineFieldsSchema);
/**
 * What a client sends to leads.create: the schema's input, in which the defaulted fields
 * (status, responses) may be left out. The screens send no responses (#575)
 */
export type CreateLeadInput = z.input<typeof createLeadSchema>;

/**
 * Lead update schema
 */
export const updateLeadSchema = z
  .object({
    organizationId: z.string().uuid(),
    id: z.string().uuid(),
    email: leadTextSchema('email').email('有効なメールアドレスを入力してください').optional(),
    name: leadTextSchema('name').optional(),
    company: leadTextSchema('company').optional(),
    phone: leadTextSchema('phone').optional(),
    status: leadStatusEnum.optional(),
    score: z.number().int().min(0).max(100).optional(),
    source: leadSourceEnum.optional(),
    responses: leadResponsesSchema.optional(),
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
  'assignee',
  // From the latest hearing of the lead (#137)
  'nextMeetingDate',
  'dealRating',
  // "When to act" (#151)
  'actBy',
  // MQL level of the diagnosis: 関心あり, 適合, 対象外, then none (#447)
  'mqlLevel',
] as const;
export const leadSortKeyEnum = z.enum(LEAD_SORT_KEYS);
export type LeadSortKey = z.infer<typeof leadSortKeyEnum>;

/** SQL judgement filter: the two decisions, or not decided yet */
export const SQL_DECISION_FILTERS = ['qualified', 'not_qualified', 'undecided'] as const;
export const sqlDecisionFilterEnum = z.enum(SQL_DECISION_FILTERS);
export type SqlDecisionFilter = z.infer<typeof sqlDecisionFilterEnum>;

/**
 * Assignee filter (#135): the current member ('me'), leads nobody holds ('unassigned'), or one
 * member's user id
 */
export const ASSIGNEE_FILTER_KEYWORDS = ['me', 'unassigned'] as const;
export const assigneeFilterSchema = z.union([z.enum(ASSIGNEE_FILTER_KEYWORDS), z.string().uuid()]);
export type AssigneeFilter = z.infer<typeof assigneeFilterSchema>;

/**
 * Next meeting date of the lead's latest hearing (#137): set, not set, already past (and no
 * newer hearing, since the latest hearing is the one read), or in the current Japan week
 */
export const NEXT_MEETING_FILTERS = ['has', 'none', 'overdue', 'thisWeek'] as const;
export const nextMeetingFilterEnum = z.enum(NEXT_MEETING_FILTERS);
export type NextMeetingFilter = z.infer<typeof nextMeetingFilterEnum>;

/**
 * MQL level filter (#447): the level of the lead's diagnosis (leadMqlLevel), or 'unknown' for a
 * lead without a diagnosis (e.g. added by hand)
 */
export const MQL_LEVEL_FILTERS = ['interest', 'fit', 'none', 'unknown'] as const;
export const mqlLevelFilterEnum = z.enum(MQL_LEVEL_FILTERS);
export type MqlLevelFilter = z.infer<typeof mqlLevelFilterEnum>;

/** Deal rating of the lead's latest hearing (#137); same values as the hearing sheet */
export const DEAL_RATINGS = ['a', 'b', 'c'] as const;
export const dealRatingEnum = z.enum(DEAL_RATINGS);
export type DealRating = z.infer<typeof dealRatingEnum>;

/** A calendar day in Japan time, 'YYYY-MM-DD' */
export const jstDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((day) => !Number.isNaN(Date.parse(`${day}T00:00:00+09:00`)), 'Invalid date');

/** One value or several (any of them matches); the single form is kept for older callers */
const oneOrMany = <T extends z.ZodTypeAny>(item: T) =>
  z.union([item, z.array(item).max(LEAD_FILTER_MAX_VALUES)]).optional();

/**
 * Most leads one page of the list shows. The bulk actions take as many ids (#604): the screen
 * selects only rows of the page shown (lead-table.tsx drops the selection with the rows)
 */
export const LEAD_LIST_PAGE_MAX = 100;

/**
 * List leads schema (#131: sorting and filtering run on the server). The nested group of
 * conditions no screen sent was removed (#699). An older client that still sends it gets the
 * list filtered by the other fields only, not an error. This schema drops unknown keys, but the
 * procedure's input still carries them: organizationInputSchema passes them through and tRPC
 * merges the parsed inputs. They take no effect because listWhere and exportAuditFilters read
 * only the fields named here, which the procedure tests of leads-bulk-limits.test.ts check.
 */
export const listLeadsSchema = z.object({
  organizationId: z.string().uuid(),
  limit: z.number().int().min(1).max(LEAD_LIST_PAGE_MAX).default(20),
  offset: z.number().int().min(0).default(0),
  status: oneOrMany(leadStatusEnum),
  source: leadSourceEnum.optional(),
  inflowSource: oneOrMany(inflowSourceEnum),
  dealPhase: oneOrMany(dealPhaseEnum),
  targetSystem: oneOrMany(targetSystemEnum),
  search: z.string().trim().max(200).optional(), // Search in name, email, company
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
  // Assignee (#135)
  assignee: assigneeFilterSchema.optional(),
  // Latest hearing (#137)
  nextMeeting: nextMeetingFilterEnum.optional(),
  dealRating: oneOrMany(dealRatingEnum),
  // MQL level of the diagnosis (#447)
  mqlLevel: oneOrMany(mqlLevelFilterEnum),
  // "When to act" (#151): within the next months (or past), or set at all
  actTiming: actTimingFilterEnum.optional(),
  // Tag filter
  tagIds: z.array(z.string().uuid()).max(LEAD_FILTER_MAX_VALUES).optional(),
});
export type ListLeadsInput = z.infer<typeof listLeadsSchema>;

/** File formats of the lead export (#173) */
export const LEAD_EXPORT_FORMATS = ['csv', 'json', 'pdf'] as const;
export type LeadExportFormat = (typeof LEAD_EXPORT_FORMATS)[number];

/**
 * Export every lead matching the list's filters and sort (#173): the list input without the
 * page, plus the file format
 */
export const exportLeadsSchema = listLeadsSchema.omit({ limit: true, offset: true }).extend({
  format: z.enum(LEAD_EXPORT_FORMATS),
  locale: z.enum(['ja', 'en']).default('ja'),
});
export type ExportLeadsInput = z.infer<typeof exportLeadsSchema>;

/** Assign a lead to a member of its organization, or nobody (null) (#135) */
export const assignLeadSchema = z.object({
  organizationId: z.string().uuid(),
  id: z.string().uuid(),
  assigneeUserId: z.string().uuid().nullable(),
});
export type AssignLeadInput = z.infer<typeof assignLeadSchema>;

/** Intake members (窓口) of the organization; an empty list turns intake off (#135) */
export const setLeadIntakeSchema = z.object({
  organizationId: z.string().uuid(),
  userIds: z.array(z.string().uuid()).max(10),
});
export type SetLeadIntakeInput = z.infer<typeof setLeadIntakeSchema>;

/**
 * Delete lead schema
 */
export const deleteLeadSchema = z.object({
  organizationId: z.string().uuid(),
  id: z.string().uuid(),
});
export type DeleteLeadInput = z.infer<typeof deleteLeadSchema>;

/** The leads of a bulk action: one to a page of the list (LEAD_LIST_PAGE_MAX) */
const leadBulkIdsSchema = z
  .array(z.string().uuid())
  .min(1, '少なくとも1つのリードを選択してください')
  .max(LEAD_LIST_PAGE_MAX, `一度に選べるリードは${LEAD_LIST_PAGE_MAX}件までです`);

/**
 * Bulk update status schema
 */
export const bulkUpdateStatusSchema = z.object({
  organizationId: z.string().uuid(),
  ids: leadBulkIdsSchema,
  status: leadStatusEnum,
});
export type BulkUpdateStatusInput = z.infer<typeof bulkUpdateStatusSchema>;

/**
 * Bulk delete schema
 */
export const bulkDeleteSchema = z.object({
  organizationId: z.string().uuid(),
  ids: leadBulkIdsSchema,
});
export type BulkDeleteInput = z.infer<typeof bulkDeleteSchema>;

/**
 * Most leads one leads.bulkCreate takes (#604). The import sends a larger file in parts of this
 * size, one after another (import-dialog.tsx). A part stays well below the request body limit
 * of the Vercel functions (about 4.5 MB; a row at its limits is under 2 KB of JSON) and below
 * the bind parameters the PostgreSQL driver sends in one statement (under 65,534; the insert
 * takes up to 9 a lead, the audit rows 8), which one request of over about 7,000 leads passed.
 */
export const LEAD_BULK_CREATE_MAX = 1_000;

/**
 * Bulk create schema for importing leads. Each row has the limits of a lead made by hand; the
 * import marks a row over them as an error before sending (import-service.ts), since one such
 * row refuses the whole request.
 */
export const bulkCreateSchema = z.object({
  organizationId: z.string().uuid(),
  leads: z
    .array(
      z.object({
        email: leadTextSchema('email').email(),
        name: leadTextSchema('name').optional(),
        company: leadTextSchema('company').optional(),
        phone: leadTextSchema('phone').optional(),
        status: leadStatusEnum.default('new'),
        source: leadSourceEnum.optional(),
        score: z.number().int().min(0).max(100).optional(),
      })
    )
    .min(1, '少なくとも1つのリードを指定してください')
    .max(LEAD_BULK_CREATE_MAX, `一度に取り込めるリードは${LEAD_BULK_CREATE_MAX}件までです`),
});
export type BulkCreateInput = z.infer<typeof bulkCreateSchema>;
