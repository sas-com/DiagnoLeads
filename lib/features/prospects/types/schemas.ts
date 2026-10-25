import { OBJECTION_REASONS } from '@/lib/features/ax-playbook/types/schemas';
import { targetSystemEnum } from '@/lib/features/leads/types/pipeline';
import { PLAIN_TEXT } from '@/lib/utils/plain-text';
import { z } from 'zod';

/**
 * Prospects of the AX migration (#265): the "customer search" list SAS members fill in after
 * talking to someone, and sales follow up. The values match the spreadsheet's dropdowns so the
 * existing rows can be imported as they are.
 */

/** How the contact came about */
export const PROSPECT_ENTRIES = [
  'member_network',
  'existing_end_customer',
  'bp_company',
  'marketing',
  'other',
  // Companies a sales agency called (#161)
  'sales_agency',
] as const;
export const prospectEntryEnum = z.enum(PROSPECT_ENTRIES);
export type ProspectEntry = z.infer<typeof prospectEntryEnum>;

export const PROSPECT_SYSTEM_SCOPES = ['core', 'peripheral'] as const;
export const prospectSystemScopeEnum = z.enum(PROSPECT_SYSTEM_SCOPES);
export type ProspectSystemScope = z.infer<typeof prospectSystemScopeEnum>;

export const PROSPECT_REACTIONS = ['has_issue', 'considering', 'no_plan', 'unknown'] as const;
export const prospectReactionEnum = z.enum(PROSPECT_REACTIONS);
export type ProspectReaction = z.infer<typeof prospectReactionEnum>;

export const PROSPECT_NEXT_STEPS = ['hand_over', 'keep_checking', 'ask_more', 'pass'] as const;
export const prospectNextStepEnum = z.enum(PROSPECT_NEXT_STEPS);
export type ProspectNextStep = z.infer<typeof prospectNextStepEnum>;

/**
 * Troubles heard, as chips: the four pains of the pamphlet (people, change, cost, data) plus
 * missing documents, which members hear most often
 */
export const PROSPECT_TROUBLES = [
  'few_maintainers',
  'no_documents',
  'hard_to_change',
  'maintenance_cost',
  'data_unusable',
] as const;
export const prospectTroubleEnum = z.enum(PROSPECT_TROUBLES);
export type ProspectTrouble = z.infer<typeof prospectTroubleEnum>;

/** Whether the support of the system ends within a year */
export const PROSPECT_SUPPORT_END = ['yes', 'no', 'unknown'] as const;
export const prospectSupportEndEnum = z.enum(PROSPECT_SUPPORT_END);

/** Stages written by sales. The first five follow the sales flow; the last two are outcomes */
export const PROSPECT_FUNNEL_STAGES = [
  'interest',
  'quick_diagnosis',
  'spec_survey',
  'proposal',
  'contract',
] as const;
export type ProspectFunnelStage = (typeof PROSPECT_FUNNEL_STAGES)[number];
export const PROSPECT_STAGES = [...PROSPECT_FUNNEL_STAGES, 'nurturing', 'dropped'] as const;
export const prospectStageEnum = z.enum(PROSPECT_STAGES);
export type ProspectStage = z.infer<typeof prospectStageEnum>;

/** Labels of the spreadsheet's dropdowns, for the import */
export const SPREADSHEET_LABELS = {
  entry: {
    '① SASメンバーのつて': 'member_network',
    '② 既存エンド顧客': 'existing_end_customer',
    '③ BP会社': 'bp_company',
    '④ マーケ流入': 'marketing',
    '⑤ その他(交流会など)': 'other',
  },
  systemScope: { 基幹: 'core', 周辺: 'peripheral' },
  reaction: {
    困りごとあり: 'has_issue',
    検討中: 'considering',
    予定なし: 'no_plan',
    不明: 'unknown',
  },
  nextStep: {
    営業へ引き継ぎ: 'hand_over',
    継続的に確認: 'keep_checking',
    追加で聞く: 'ask_more',
    見送り: 'pass',
  },
  stage: {
    '1 関心確認': 'interest',
    '2 簡易診断': 'quick_diagnosis',
    '3 現行仕様調査': 'spec_survey',
    '4 移行提案': 'proposal',
    '5 契約': 'contract',
    育成: 'nurturing',
    見送り: 'dropped',
  },
} as const satisfies {
  entry: Record<string, ProspectEntry>;
  systemScope: Record<string, ProspectSystemScope>;
  reaction: Record<string, ProspectReaction>;
  nextStep: Record<string, ProspectNextStep>;
  stage: Record<string, ProspectStage>;
};

/** For notes: no control or format characters other than line breaks and tabs */
const NO_CONTROL = /^(?:[^\p{Cc}\p{Cf}]|[\n\t])*$/u;

const shortText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .regex(PLAIN_TEXT)
    .transform((value) => value || null)
    .nullable()
    .optional();
const longText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .regex(NO_CONTROL)
    .transform((value) => value || null)
    .nullable()
    .optional();
/**
 * A calendar date (YYYY-MM-DD) that exists, in the years the list can be about. The range keeps
 * the monthly summary short and the database from rejecting a whole import over one bad date.
 */
export function isProspectDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < PROSPECT_MIN_YEAR || year > PROSPECT_MAX_YEAR) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
export const PROSPECT_MIN_YEAR = 2000;
export const PROSPECT_MAX_YEAR = 2100;
/** Longest notes ("what we heard", remarks) */
export const PROSPECT_TEXT_MAX = 2000;

const isoDate = z.string().refine(isProspectDate, 'Invalid date');
const optionalDate = isoDate.nullable().optional();

/** Columns members fill in (yellow in the spreadsheet) */
export const prospectMemberFieldsSchema = z.object({
  contactedOn: isoDate,
  entry: prospectEntryEnum,
  company: z.string().trim().min(1).max(200).regex(PLAIN_TEXT),
  department: shortText(100),
  jobTitle: shortText(100),
  surname: shortText(50),
  explainedOn: optionalDate,
  heard: longText(PROSPECT_TEXT_MAX),
  systemScope: prospectSystemScopeEnum.nullable().optional(),
  reaction: prospectReactionEnum.nullable().optional(),
  nextStep: prospectNextStepEnum.nullable().optional(),
  nextActionOn: optionalDate,
  /** A rough time when there is no date yet */
  nextActionNote: shortText(100),
  targetSystem: targetSystemEnum.nullable().optional(),
  supportEndSoon: prospectSupportEndEnum.nullable().optional(),
  troubles: z
    .array(prospectTroubleEnum)
    .max(PROSPECT_TROUBLES.length)
    .transform((values) => [...new Set(values)])
    .optional(),
});

/** Result of a sales agency's call (#161) */
export const CALL_RESULTS = ['appointment', 'refused', 'absent', 'callback'] as const;
export const callResultEnum = z.enum(CALL_RESULTS);
export type CallResult = z.infer<typeof callResultEnum>;

/** Why a call was turned down: the same values as the hearing's pastBlocker (#157) */
export const REFUSAL_REASONS = OBJECTION_REASONS;
export const refusalReasonEnum = z.enum(REFUSAL_REASONS);
export type RefusalReason = z.infer<typeof refusalReasonEnum>;

/** Columns of a sales agency's call report (#161), written by sales */
export const prospectAgencyFieldsSchema = z.object({
  agencyName: shortText(100),
  estimatedSystemBasis: longText(500),
  challengeHypothesis: longText(500),
  contactName: shortText(100),
  contactPhone: z
    .string()
    .trim()
    .max(30)
    .regex(/^[0-9+\-() ]*$/)
    .transform((value) => value || null)
    .nullable()
    .optional(),
  calledOn: optionalDate,
  callResult: callResultEnum.nullable().optional(),
  refusalReason: refusalReasonEnum.nullable().optional(),
  refusalNote: longText(500),
});
export type ProspectAgencyFields = z.infer<typeof prospectAgencyFieldsSchema>;

/** Columns sales fill in (light blue in the spreadsheet) */
export const prospectSalesFieldsSchema = z.object({
  stage: prospectStageEnum.nullable().optional(),
  meetingOn: optionalDate,
  salesUserId: z.string().uuid().nullable().optional(),
  remarks: longText(PROSPECT_TEXT_MAX),
});

/**
 * all; overdue: an open row whose next action date has passed; handed_over: handed over and not
 * yet a lead; mine: rows the user added or follows as sales; reapproach: calls turned down
 * whose next contact is due within REAPPROACH_DAYS (or past), not a lead yet (#161)
 */
export const PROSPECT_FILTERS = ['all', 'overdue', 'handed_over', 'mine', 'reapproach'] as const;
/** Turned-down calls show in the re-approach list this many days before their next contact */
export const REAPPROACH_DAYS = 30;

export const listProspectsSchema = z.object({
  organizationId: z.string().uuid(),
  filter: z.enum(PROSPECT_FILTERS).default('all'),
});

export const createProspectSchema = prospectMemberFieldsSchema
  .merge(prospectSalesFieldsSchema)
  .merge(prospectAgencyFieldsSchema)
  .extend({ organizationId: z.string().uuid() });
export type CreateProspectInput = z.infer<typeof createProspectSchema>;

export const updateProspectSchema = prospectMemberFieldsSchema
  .merge(prospectSalesFieldsSchema)
  .merge(prospectAgencyFieldsSchema)
  .extend({ organizationId: z.string().uuid(), id: z.string().uuid() });
export type UpdateProspectInput = z.infer<typeof updateProspectSchema>;

export const deleteProspectSchema = z.object({
  organizationId: z.string().uuid(),
  id: z.string().uuid(),
});

/** One imported spreadsheet row, already mapped in the browser */
export const importProspectRowSchema = prospectMemberFieldsSchema
  .merge(prospectSalesFieldsSchema.omit({ salesUserId: true }))
  .extend({
    recorderName: shortText(100),
    /** Sales person written in the spreadsheet; kept in the remarks (no account to match) */
    salesName: shortText(100),
    /** "Updated on" of the spreadsheet */
    updatedOn: optionalDate,
  });
export type ImportProspectRow = z.infer<typeof importProspectRowSchema>;

export const PROSPECT_IMPORT_MAX_ROWS = 500;

export const importProspectsSchema = z.object({
  organizationId: z.string().uuid(),
  rows: z.array(importProspectRowSchema).min(1).max(PROSPECT_IMPORT_MAX_ROWS),
});

/**
 * One row of a sales agency's call report (#161), read in the browser. A row finds the agency's
 * existing row for the same company (sameCompany) and agency, or becomes a new one
 */
export const importCallRowSchema = prospectAgencyFieldsSchema.extend({
  company: z.string().trim().min(1).max(200).regex(PLAIN_TEXT),
  department: shortText(100),
  jobTitle: shortText(100),
  targetSystem: targetSystemEnum.nullable().optional(),
  /** Next time the company may be called: a date, or a rough time */
  nextActionOn: optionalDate,
  nextActionNote: shortText(100),
  heard: longText(PROSPECT_TEXT_MAX),
});
export type ImportCallRow = z.infer<typeof importCallRowSchema>;
export type ImportCallRowInput = z.input<typeof importCallRowSchema>;

export const importCallsSchema = z.object({
  organizationId: z.string().uuid(),
  rows: z.array(importCallRowSchema).min(1).max(PROSPECT_IMPORT_MAX_ROWS),
});

/** Rows of other people about a company with a similar name, while a member types it */
export const similarProspectsSchema = z.object({
  organizationId: z.string().uuid(),
  company: z.string().trim().min(2).max(200),
  excludeId: z.string().uuid().optional(),
});

export const forLeadSchema = z.object({
  organizationId: z.string().uuid(),
  leadId: z.string().uuid(),
});

export const myReferralLinkSchema = z.object({
  organizationId: z.string().uuid(),
  locale: z.enum(['ja', 'en']).default('ja'),
});

export const summarySchema = z.object({
  organizationId: z.string().uuid(),
});

export const setMeetingTargetsSchema = z.object({
  organizationId: z.string().uuid(),
  targets: z
    .array(
      z.object({
        month: z
          .string()
          .regex(/^\d{4}-\d{2}-01$/)
          .refine(isProspectDate, 'Invalid month'),
        meetings: z.number().int().min(0).max(10000),
      })
    )
    .max(24),
});

export const convertToLeadSchema = z.object({
  organizationId: z.string().uuid(),
  id: z.string().uuid(),
  email: z.string().trim().email().max(254),
  name: shortText(100),
  phone: z
    .string()
    .trim()
    .max(30)
    .regex(/^[0-9+\-() ]*$/)
    .transform((value) => value || null)
    .nullable()
    .optional(),
});
