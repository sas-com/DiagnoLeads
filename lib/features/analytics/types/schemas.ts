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
}

export interface AcquisitionCostSummary extends Omit<AcquisitionCostRow, 'source'> {
  bySource: AcquisitionCostRow[];
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
}
