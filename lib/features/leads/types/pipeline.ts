import { z } from 'zod';

/**
 * Sales pipeline definitions shared by DB, API and UI.
 *
 * Based on the AX migration sales & marketing flow (2026-10-08).
 * Labels live in locales/{ja,en}/common.json under the matching namespace.
 */

/** 5-stage lead status: 新規 / ナーチャリング / 商談中 / 成約 / 失注 */
export const LEAD_STATUSES = ['new', 'nurturing', 'negotiating', 'won', 'lost'] as const;
export const leadStatusEnum = z.enum(LEAD_STATUSES);
export type LeadStatus = z.infer<typeof leadStatusEnum>;

/** Statuses that count as "has been in negotiation" (商談済みフラグ) */
export const NEGOTIATED_STATUSES: readonly LeadStatus[] = ['negotiating', 'won'];

/** 流入元 */
export const INFLOW_SOURCES = [
  'existing_customer',
  'referral_partner',
  'executive_network',
  'lp_organic',
  'seminar',
  'advertising',
  // Outsourced sales (#83): the agency name and cost are recorded on the lead
  'telemarketing_agency',
  'referral_agency',
  // An employee's own diagnosis link or customer search row (#265); referrerName is the employee
  'member_referral',
] as const;
export const inflowSourceEnum = z.enum(INFLOW_SOURCES);
export type InflowSource = z.infer<typeof inflowSourceEnum>;

/** コンバージョンポイント */
export const CONVERSION_POINTS = [
  'consultation',
  'document_download',
  'demo_view',
  'seminar',
  'via_sales',
  'web_diagnosis',
] as const;
export const conversionPointEnum = z.enum(CONVERSION_POINTS);
export type ConversionPoint = z.infer<typeof conversionPointEnum>;

/** 商談フェーズ */
export const DEAL_PHASES = [
  'initial_hearing',
  'simple_diagnosis',
  'proposal',
  'survey_won',
  'migration_won',
  'ax',
] as const;
export const dealPhaseEnum = z.enum(DEAL_PHASES);
export type DealPhase = z.infer<typeof dealPhaseEnum>;

/** 対象システム */
// AS/400 / NEC ACOS / other office computers & mainframes / VB client-server / Microsoft Access
// (incl. department-level tools) / WebPerformer (the first low-code target) / other.
// Added for the sales hearing sheet (#83): in-house open systems / packages / unknown.
export const TARGET_SYSTEMS = [
  'as400',
  'acos',
  'other_legacy',
  'vb',
  'access',
  'webperformer',
  'custom_open',
  'package',
  'unknown',
  'other',
] as const;
export const targetSystemEnum = z.enum(TARGET_SYSTEMS);
export type TargetSystem = z.infer<typeof targetSystemEnum>;

/** 失注・保留理由 */
export const LOST_REASONS = [
  'budget',
  'timing',
  'competitor',
  'internal_structure',
  // Added for the sales hearing sheet (#83)
  'system_out_of_scope',
  'no_decision_maker',
  'no_need',
  'on_hold',
  'other',
] as const;
export const lostReasonEnum = z.enum(LOST_REASONS);
export type LostReason = z.infer<typeof lostReasonEnum>;

/** Message for a lead that would be 失注 with the reason 保留 (#445) */
export const LOST_ON_HOLD_MESSAGE =
  '「保留」のままでは失注にできません。失注にするときは失注・保留理由を「保留」以外に変え、保留のままにするときは状態をナーチャリングにしてください';

/**
 * 保留 is not a loss (#445): a lead on hold is nurtured, so the act timing (#151) follows it and
 * it is not counted as lost. True when the write names 保留 as the reason of a lost lead. A lead
 * already lost on hold (before #445) can still be saved while it stays so. Moving a lead on hold
 * to lost without a reason is not refused: the reason 保留 is dropped (dropsOnHoldReason), so the
 * lost reason can be asked for, as the deals do (#435).
 */
export function makesLostOnHold(
  before: { status: string; lostReason: string | null } | null | undefined,
  input: { status?: string; lostReason?: string | null }
): boolean {
  if (input.lostReason !== 'on_hold') return false;
  if ((input.status ?? before?.status) !== 'lost') return false;
  return before?.status !== 'lost' || before.lostReason !== 'on_hold';
}

/** Whether moving the lead to lost drops its reason 保留 (#445): it held, it did not lose */
export function dropsOnHoldReason(
  before: { status: string; lostReason: string | null } | null | undefined,
  input: { status?: string; lostReason?: string | null }
): boolean {
  return (
    input.status === 'lost' &&
    input.lostReason === undefined &&
    before?.lostReason === 'on_hold' &&
    before.status !== 'lost'
  );
}

/** Whether a lost reason was given: 保留 is no reason for a loss (the lost reason prompt) */
export const hasLostReason = (lostReason: string | null | undefined): boolean =>
  !!lostReason && lostReason !== 'on_hold';

/** SQL判定: recorded by sales after the hearing（null = 未判定） */
export const SQL_DECISIONS = ['qualified', 'not_qualified'] as const;
export const sqlDecisionEnum = z.enum(SQL_DECISIONS);
export type SqlDecision = z.infer<typeof sqlDecisionEnum>;

/** Pipeline fields accepted on lead create / update */
export const leadPipelineFieldsSchema = z.object({
  inflowSource: inflowSourceEnum.nullable().optional(),
  /** Sales agency that set up the meeting (inflowSource = *_agency) */
  agencyName: z.string().trim().max(200).nullable().optional(),
  /** What this lead cost to acquire, in yen excluding tax */
  acquisitionCost: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  conversionPoint: conversionPointEnum.nullable().optional(),
  dealPhase: dealPhaseEnum.nullable().optional(),
  targetSystem: targetSystemEnum.nullable().optional(),
  referrerName: z.string().max(200).nullable().optional(),
  lostReason: lostReasonEnum.nullable().optional(),
  /** MQL判定 by marketing (true = MQL) */
  mqlQualified: z.boolean().optional(),
  /** SQL判定 by sales after the hearing */
  sqlDecision: sqlDecisionEnum.nullable().optional(),
});
export type LeadPipelineFields = z.infer<typeof leadPipelineFieldsSchema>;

/**
 * Fields to write when the status changes.
 * 商談済みフラグ is only ever turned on here (never written as false), so it is
 * never cleared, not even by concurrent updates based on a stale read.
 */
export function statusUpdateFields(status: LeadStatus): {
  status: LeadStatus;
  hasNegotiated?: true;
} {
  return NEGOTIATED_STATUSES.includes(status) ? { status, hasNegotiated: true } : { status };
}

/**
 * Fields to write for the MQL / SQL judgements.
 * Dates are recorded only when someone records a judgement explicitly; changing
 * the status never sets them (the sales flow decides SQL after the hearing).
 */
export function qualificationUpdateFields(
  input: Pick<LeadPipelineFields, 'mqlQualified' | 'sqlDecision'>,
  existing: {
    mqlQualifiedAt: Date | null;
    sqlDecision: string | null;
    sqlDecidedAt: Date | null;
  } | null,
  now: Date = new Date()
): { mqlQualifiedAt?: Date | null; sqlDecision?: SqlDecision | null; sqlDecidedAt?: Date | null } {
  const fields: {
    mqlQualifiedAt?: Date | null;
    sqlDecision?: SqlDecision | null;
    sqlDecidedAt?: Date | null;
  } = {};
  if (input.mqlQualified !== undefined) {
    fields.mqlQualifiedAt = input.mqlQualified ? (existing?.mqlQualifiedAt ?? now) : null;
  }
  if (input.sqlDecision !== undefined) {
    fields.sqlDecision = input.sqlDecision;
    if (input.sqlDecision === null) {
      fields.sqlDecidedAt = null;
    } else if (existing?.sqlDecision === input.sqlDecision) {
      fields.sqlDecidedAt = existing.sqlDecidedAt ?? now;
    } else {
      fields.sqlDecidedAt = now;
    }
  }
  return fields;
}

/** Date (YYYY-MM-DD) each deal phase was first reached, keyed by phase */
export type DealPhaseReachedAt = Partial<Record<DealPhase, string>>;

/** Calendar date in Japan, for the deal phase dates */
export function jstDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(now);
}

/** Legacy status values (before #54) mapped to the 5-stage pipeline */
export const LEGACY_LEAD_STATUS_MAP: Record<string, LeadStatus> = {
  contacted: 'nurturing',
  qualified: 'negotiating',
  converted: 'won',
};

/** Normalize a status value, accepting legacy values (e.g. from old CSV exports) */
export function normalizeLeadStatus(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim().toLowerCase();
  return LEGACY_LEAD_STATUS_MAP[trimmed] ?? trimmed;
}
