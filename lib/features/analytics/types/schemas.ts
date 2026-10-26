import type { LeadStatus } from '@/lib/features/leads/types/pipeline';
import type { MqlLevelFilter } from '@/lib/features/leads/types/schemas';
import { z } from 'zod';

/**
 * Analytics Zod Schemas
 * Type-safe input validation for analytics procedures
 */

/**
 * Date range for analytics queries
 */
export const dateRangeSchema = z.enum(['7d', '30d', '90d', 'all']);
export type DateRange = z.infer<typeof dateRangeSchema>;

/**
 * Trend granularity (daily or monthly)
 */
export const trendGranularitySchema = z.enum(['daily', 'monthly']);
export type TrendGranularity = z.infer<typeof trendGranularitySchema>;

/**
 * Get Overview Schema
 */
export const getOverviewSchema = z.object({
  organizationId: z.string().uuid(),
  dateRange: dateRangeSchema.default('30d'),
});
export type GetOverviewInput = z.infer<typeof getOverviewSchema>;

/**
 * Get Lead Trend Schema
 */
export const getLeadTrendSchema = z.object({
  organizationId: z.string().uuid(),
  dateRange: dateRangeSchema.default('30d'),
  granularity: trendGranularitySchema.default('daily'),
});
export type GetLeadTrendInput = z.infer<typeof getLeadTrendSchema>;

/**
 * Get Source Breakdown Schema
 */
export const getSourceBreakdownSchema = z.object({
  organizationId: z.string().uuid(),
  dateRange: dateRangeSchema.default('30d'),
});
export type GetSourceBreakdownInput = z.infer<typeof getSourceBreakdownSchema>;

/**
 * Get Status Breakdown Schema
 */
export const getStatusBreakdownSchema = z.object({
  organizationId: z.string().uuid(),
  dateRange: dateRangeSchema.default('30d'),
});
export type GetStatusBreakdownInput = z.infer<typeof getStatusBreakdownSchema>;

/**
 * Get Conversion Funnel Schema
 */
export const getConversionFunnelSchema = z.object({
  organizationId: z.string().uuid(),
  dateRange: dateRangeSchema.default('30d'),
});
export type GetConversionFunnelInput = z.infer<typeof getConversionFunnelSchema>;

/**
 * Get Response Time Schema
 */
export const getResponseTimeSchema = z.object({
  organizationId: z.string().uuid(),
  dateRange: dateRangeSchema.default('30d'),
});

/**
 * Response Types
 */

export interface OverviewStats {
  totalLeads: number;
  newLeadsThisMonth: number;
  conversionRate: number;
  /**
   * Leads per MQL level (#605), counted like the list's MQL level filter: 'interest' includes
   * leads with an MQL date, 'unknown' has neither a diagnosis nor an MQL date
   */
  mqlLevels: Record<MqlLevelFilter, number>;
  /** 関心あり（MQL） out of all leads, in percent with 2 decimals */
  mqlRate: number;
  leadsByStatus: Record<LeadStatus, number>;
}

export interface TrendDataPoint {
  date: string; // ISO 8601 date string
  count: number;
  /** Number of leads won (status = 'won') */
  converted: number;
}

export interface SourceBreakdown {
  /** 流入元 (inflow_source value), or 'unset' when not recorded */
  source: string;
  count: number;
  percentage: number;
}

export interface StatusBreakdown {
  status: string;
  count: number;
  percentage: number;
}

export interface FunnelStage {
  name: string;
  count: number;
  cumulativeCount: number;
  percentage: number;
  conversionRate: number;
}

export interface ConversionFunnelData {
  stages: FunnelStage[];
  totalLeads: number;
  overallConversionRate: number;
  averageConversionDays: number;
}

/**
 * Response time: shown only once the first contact is recorded on leads (#136)
 */
export type ResponseTimeResult =
  | { status: 'pending'; reason: 'first_contact_not_recorded' }
  | { status: 'ready'; distribution: ResponseTimeData[] };

export interface ResponseTimeData {
  period: string; // e.g., "< 1 hour", "1-24 hours", "1-3 days", "3+ days"
  count: number;
  percentage: number;
  averageHours: number;
}

/**
 * Acquisition cost schema (replaces the ROI calculator, which multiplied lead counts by unit
 * prices typed in by hand; costs now come from `acquisition_cost` recorded on each lead)
 */
export const getAcquisitionCostSchema = z.object({
  organizationId: z.string().uuid(),
  dateRange: dateRangeSchema.default('30d'),
});
export type GetAcquisitionCostInput = z.infer<typeof getAcquisitionCostSchema>;

/** Acquisition cost of the leads of one 流入元 (inflow source, or 'unset') */
export interface AcquisitionCostRow {
  source: string;
  leadCount: number;
  /** Leads with an acquisition cost recorded (the others add no cost) */
  costedLeadCount: number;
  /** Leads judged SQL by sales (sql_decision = 'qualified') */
  sqlCount: number;
  /** Leads won (status = 'won') */
  wonCount: number;
  /** Sum of acquisition_cost, yen excluding tax */
  totalCost: number;
  /** totalCost / sqlCount, null without SQL */
  costPerSql: number | null;
  /** totalCost / wonCount, null without a win */
  costPerWon: number | null;
  /** Deals of these leads (#448); null for those who may not read deals */
  deals: DealReturns | null;
}

export interface AcquisitionCostSummary extends Omit<AcquisitionCostRow, 'source'> {
  bySource: AcquisitionCostRow[];
}

/**
 * What the deals of the leads brought in (#448), next to the acquisition cost of those leads.
 * Null for those who may not read deals (canReadDeals: a parent organization's viewers and the
 * agency accounts of #276 see no amounts).
 */
export interface DealReturns {
  /** Deals of the leads, any stage */
  dealCount: number;
  wonDealCount: number;
  /** Sum of the amounts of the won deals, yen excluding tax (a won deal without an amount adds 0) */
  wonAmount: number;
  /** Acquisition cost / won deals, null without a won deal */
  costPerWonDeal: number | null;
  /** Won amount / acquisition cost (2.5 = 2.5 times the cost), null when nothing was spent */
  roi: number | null;
  /**
   * Median days from the lead's creation (Japan day) to the close day of its first won deal,
   * null without a win
   */
  medianDaysToWin: number | null;
}

/**
 * Agency performance schema
 */
export const getAgencyPerformanceSchema = z.object({
  organizationId: z.string().uuid(),
  dateRange: dateRangeSchema.default('30d'),
});

/** Leads set up by one sales agency (agency_name) */
export interface AgencyPerformanceRow {
  agencyName: string;
  leadCount: number;
  sqlCount: number;
  /** sqlCount / leadCount, percent */
  sqlRate: number;
  wonCount: number;
  costedLeadCount: number;
  /** Sum of acquisition_cost, yen excluding tax */
  totalCost: number;
  /** totalCost / sqlCount, null without SQL */
  costPerSql: number | null;
  /** Deals of these leads (#448); null for those who may not read deals */
  deals: DealReturns | null;
}

/** Input of analytics.getQrCampaignBreakdown: every campaign of the organization (#700) */
export const getQrCampaignBreakdownSchema = z.object({
  organizationId: z.string().uuid(),
});

/**
 * What the answers carrying a QR campaign's short code (tracking.qr) add to the campaign's own
 * counts (#700, owner decision of 2026-10-26), from the campaign's creation, test answers left
 * out. The campaign row keeps the scans and the new leads (distribution); these come from the
 * answers and the leads, so they are counted here and shown beside them
 */
export interface QrCampaignBreakdown {
  campaignId: string;
  /**
   * Answers that matched a lead already there (既存リードの再回答: the submission did not create
   * its lead). Never new leads, never in the new-lead rate
   */
  existingLeadAnswers: number;
  /** New leads from the code whose MQL level is 関心あり, by the lead list's own rule */
  interestedNewLeads: number;
  /** New leads from the code that asked for a consultation (相談申込), by the list's filter */
  consultationNewLeads: number;
}
