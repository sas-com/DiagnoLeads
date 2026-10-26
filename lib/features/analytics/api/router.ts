import { canReadDeals } from '@/lib/auth/deal-access';
import type { AppAbility } from '@/lib/auth/permissions';
import { leads } from '@/lib/db/schema';
import { countLeadsByMqlLevel, leadIsInterested } from '@/lib/features/leads/service';
import { DEAL_PHASES, LEAD_STATUSES, type LeadStatus } from '@/lib/features/leads/types/pipeline';
import { organizationProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { and, count, desc, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDashboardSummary } from '../dashboard';
import {
  getAcquisitionCost,
  getAgencyPerformance,
  getInflowSourceBreakdown,
} from '../lead-sources';
import { analyticsPeriodStart, jstMonthStart } from '../period';
import { getResponseTimeDistribution } from '../response-time';
import { qrCampaignBreakdown } from '../service';
import {
  type AcquisitionCostSummary,
  type AgencyPerformanceRow,
  type ConversionFunnelData,
  type DateRange,
  FUNNEL_STAGES,
  type FunnelStage,
  type FunnelStageName,
  type OverviewStats,
  type QrCampaignBreakdown,
  type ResponseTimeResult,
  type SourceBreakdown,
  type StatusBreakdown,
  type TrendDataPoint,
  getAcquisitionCostSchema,
  getAgencyPerformanceSchema,
  getConversionFunnelSchema,
  getLeadTrendSchema,
  getOverviewSchema,
  getQrCampaignBreakdownSchema,
  getResponseTimeSchema,
  getSourceBreakdownSchema,
  getStatusBreakdownSchema,
} from '../types/schemas';

/** Every figure here is built from the organization's leads: same rule as the leads list (#356) */
function assertCanReadLeads(ability: AppAbility) {
  if (!ability.can('read', 'Lead')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'リードを閲覧する権限がありません' });
  }
}

/**
 * Analytics Router
 * Provides statistics and analytics for dashboard
 */
export const analyticsRouter = router({
  /**
   * Dashboard figures: real counts for the period with the previous period, daily series,
   * pipeline, migration source, consultation requests waiting for contact, recent leads
   */
  getDashboard: organizationProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        days: z.union([z.literal(7), z.literal(30), z.literal(90)]),
      })
    )
    .query(({ ctx, input }) => {
      // Names and companies of leads are shown: same rule as the leads list
      assertCanReadLeads(ctx.ability);
      return getDashboardSummary(ctx.db, input.organizationId, input.days);
    }),

  /**
   * What the answers carrying each QR campaign's code add to the campaign's counts (#700, owner
   * decision of 2026-10-26): the answers of leads already there, and the new leads that are
   * 関心あり or asked for a consultation. Every campaign of the organization (the settings page
   * lists them all) in one query; the page shows them beside each campaign's own counts, which
   * come from distribution (it imports no other feature)
   */
  getQrCampaignBreakdown: organizationProcedure
    .input(getQrCampaignBreakdownSchema)
    .query(({ ctx }): Promise<QrCampaignBreakdown[]> => {
      // Who may see the campaigns (read Lead, #356); counts only, no lead is named
      assertCanReadLeads(ctx.ability);
      return qrCampaignBreakdown(ctx.db, ctx.organization.id);
    }),

  /**
   * Get Overview Statistics
   * Returns total leads, conversion rate, new leads this month, and leads per MQL level (#605)
   */
  getOverview: organizationProcedure
    .input(getOverviewSchema)
    .query(async ({ ctx, input }): Promise<OverviewStats> => {
      assertCanReadLeads(ctx.ability);
      const { organizationId } = input;

      // Get total leads for organization
      const totalLeadsResult = await ctx.db
        .select({ count: count() })
        .from(leads)
        .where(eq(leads.organizationId, organizationId));

      const totalLeads = totalLeadsResult[0]?.count || 0;

      // Get new leads this month (Japanese calendar month)
      const firstDayOfMonth = jstMonthStart();
      const newLeadsThisMonthResult = await ctx.db
        .select({ count: count() })
        .from(leads)
        .where(
          and(eq(leads.organizationId, organizationId), gte(leads.createdAt, firstDayOfMonth))
        );

      const newLeadsThisMonth = newLeadsThisMonthResult[0]?.count || 0;

      // Get converted leads for conversion rate
      const convertedLeadsResult = await ctx.db
        .select({ count: count() })
        .from(leads)
        .where(and(eq(leads.organizationId, organizationId), eq(leads.status, 'won')));

      const convertedLeads = convertedLeadsResult[0]?.count || 0;
      const conversionRate = totalLeads > 0 ? (convertedLeads / totalLeads) * 100 : 0;

      // Leads per MQL level, as the list filters them (#605): the sign of how promising leads
      // are, instead of the average score (#447)
      const mqlLevels = await countLeadsByMqlLevel(ctx.db, organizationId);
      const mqlRate = totalLeads > 0 ? (mqlLevels.interest / totalLeads) * 100 : 0;

      // Get leads by status
      const leadsByStatusResult = await ctx.db
        .select({
          status: leads.status,
          count: count(),
        })
        .from(leads)
        .where(eq(leads.organizationId, organizationId))
        .groupBy(leads.status);

      const leadsByStatus = Object.fromEntries(
        LEAD_STATUSES.map((status) => [status, 0])
      ) as Record<LeadStatus, number>;

      for (const row of leadsByStatusResult) {
        const status = row.status as LeadStatus;
        if (status in leadsByStatus) {
          leadsByStatus[status] = row.count;
        }
      }

      return {
        totalLeads,
        newLeadsThisMonth,
        conversionRate: Math.round(conversionRate * 100) / 100, // Round to 2 decimal places
        mqlLevels,
        mqlRate: Math.round(mqlRate * 100) / 100,
        leadsByStatus,
      };
    }),

  /**
   * Get Lead Trend
   * Returns time-series data for lead creation and conversion
   */
  getLeadTrend: organizationProcedure
    .input(getLeadTrendSchema)
    .query(async ({ ctx, input }): Promise<TrendDataPoint[]> => {
      assertCanReadLeads(ctx.ability);
      const { organizationId, dateRange, granularity } = input;

      const period = inPeriod(organizationId, dateRange);

      // Day or month in Japan (created_at holds UTC without a time zone), like the dashboard
      const jstCreatedAt = sql`((${leads.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tokyo')`;
      const dateFormat =
        granularity === 'daily'
          ? sql`to_char(${jstCreatedAt}, 'YYYY-MM-DD')`
          : sql`to_char(${jstCreatedAt}, 'YYYY-MM-01')`;

      // Get lead counts by date
      const trendData = await ctx.db
        .select({
          date: dateFormat.as('date'),
          count: count().as('count'),
          converted: sql<number>`SUM(CASE WHEN ${leads.status} = 'won' THEN 1 ELSE 0 END)`.as(
            'converted'
          ),
        })
        .from(leads)
        .where(period)
        .groupBy(dateFormat)
        .orderBy(desc(dateFormat));

      return trendData.map((row) => ({
        date: row.date instanceof Date ? row.date.toISOString() : String(row.date),
        count: row.count,
        converted: Number(row.converted) || 0,
      }));
    }),

  /**
   * Get Source Breakdown
   * Leads of the period by 流入元 (inflow_source; the legacy `source` column is not used),
   * the 'unset' bucket last
   */
  getSourceBreakdown: organizationProcedure
    .input(getSourceBreakdownSchema)
    .query(({ ctx, input }): Promise<SourceBreakdown[]> => {
      assertCanReadLeads(ctx.ability);
      const { organizationId, dateRange } = input;
      return getInflowSourceBreakdown(ctx.db, organizationId, analyticsPeriodStart(dateRange));
    }),

  /**
   * Get Status Breakdown
   * Returns distribution of leads by status
   */
  getStatusBreakdown: organizationProcedure
    .input(getStatusBreakdownSchema)
    .query(async ({ ctx, input }): Promise<StatusBreakdown[]> => {
      assertCanReadLeads(ctx.ability);
      const { organizationId, dateRange } = input;

      const period = inPeriod(organizationId, dateRange);

      // Get total count for percentage calculation
      const totalResult = await ctx.db.select({ count: count() }).from(leads).where(period);

      const total = totalResult[0]?.count || 0;

      // Get counts by status
      const statusData = await ctx.db
        .select({
          status: leads.status,
          count: count().as('count'),
        })
        .from(leads)
        .where(period)
        .groupBy(leads.status)
        .orderBy(desc(count()));

      return statusData.map((row) => ({
        status: row.status,
        count: row.count,
        percentage: total > 0 ? Math.round((row.count / total) * 10000) / 100 : 0,
      }));
    }),

  /**
   * Get Conversion Funnel Data
   * Returns detailed funnel analysis with stage-to-stage conversion rates
   */
  getConversionFunnel: organizationProcedure
    .input(getConversionFunnelSchema)
    .query(async ({ ctx, input }): Promise<ConversionFunnelData> => {
      assertCanReadLeads(ctx.ability);
      const { organizationId, dateRange } = input;

      const period = inPeriod(organizationId, dateRange);

      // One aggregate query over the stages of the lead lifecycle (#802). "Reached" counts are
      // nested by construction (won ⊆ sql ⊆ deal ⊆ mql ⊆ total): a lead counts for every
      // stage before the one it reached, so a lead of an agency appointment that skipped MQL
      // counts as MQL too, and stage rates never exceed 100%. A lead reached 商談 once it had a
      // deal (has_negotiated), SQL once judged qualified; a won lead counts for all.
      const isWon = sql`${leads.status} = 'won'`;
      const isSql = sql`(${leads.sqlDecision} = 'qualified' or ${isWon})`;
      // A deal phase reached counts too, as in the agency funnel (lib/features/agency-contracts):
      // a lead without deals may have its phase set by hand without has_negotiated
      const isDeal = sql`(${leads.hasNegotiated} or ${leads.status} in ('negotiating', 'won') or coalesce(${leads.dealPhaseReachedAt}, '{}'::jsonb) ?| array[${sql.raw(DEAL_PHASES.map((phase) => `'${phase}'`).join(', '))}] or ${isSql})`;
      const isMql = sql`(${leadIsInterested} or ${isDeal})`;
      const [counts] = await ctx.db
        .select({
          total: count(),
          mql: sql<number>`count(*) FILTER (WHERE ${isMql})`,
          deal: sql<number>`count(*) FILTER (WHERE ${isDeal})`,
          sql: sql<number>`count(*) FILTER (WHERE ${isSql})`,
          won: sql<number>`count(*) FILTER (WHERE ${isWon})`,
          nurturing: sql<number>`count(*) FILTER (WHERE ${leads.status} = 'nurturing')`,
        })
        .from(leads)
        .where(period);

      const totalLeads = Number(counts?.total) || 0;
      const reached: Record<FunnelStageName, number> = {
        lead: totalLeads,
        mql: Number(counts?.mql) || 0,
        deal: Number(counts?.deal) || 0,
        sql: Number(counts?.sql) || 0,
        won: Number(counts?.won) || 0,
      };

      const rate = (numerator: number, denominator: number) =>
        denominator > 0 ? Math.round((numerator / denominator) * 10000) / 100 : 0;

      // Each stage: the leads that reached it, and those that stopped there (did not reach the
      // next one)
      const stages: FunnelStage[] = FUNNEL_STAGES.map((name, index) => {
        const next = FUNNEL_STAGES[index + 1];
        const previous = FUNNEL_STAGES[index - 1];
        return {
          name,
          count: reached[name] - (next ? reached[next] : 0),
          cumulativeCount: reached[name],
          percentage: index === 0 ? 100 : rate(reached[name], totalLeads),
          conversionRate: previous ? rate(reached[name], reached[previous]) : 100,
        };
      });

      // No average conversion time: it was `updatedAt - createdAt`, which grows with every later
      // edit. Leads do not record when they were won; 0 hides the figure on the page.
      const averageConversionDays = 0;

      return {
        stages,
        totalLeads,
        nurturingCount: Number(counts?.nurturing) || 0,
        overallConversionRate: rate(reached.won, totalLeads),
        averageConversionDays,
      };
    }),

  /**
   * Get Response Time Distribution
   * Pending until the first contact is recorded on leads (#136)
   */
  getResponseTime: organizationProcedure
    .input(getResponseTimeSchema)
    .query(({ ctx, input }): Promise<ResponseTimeResult> => {
      assertCanReadLeads(ctx.ability);
      const { organizationId, dateRange } = input;
      return getResponseTimeDistribution(ctx.db, organizationId, analyticsPeriodStart(dateRange));
    }),

  /**
   * Get Acquisition Cost by 流入元
   * From `acquisition_cost` recorded on each lead (replaces the ROI with hand-typed unit prices)
   */
  getAcquisitionCost: organizationProcedure
    .input(getAcquisitionCostSchema)
    .query(({ ctx, input }): Promise<AcquisitionCostSummary> => {
      assertCanReadLeads(ctx.ability);
      const { organizationId, dateRange } = input;
      // Amounts of the deals only for those who may read deals (#448)
      return getAcquisitionCost(ctx.db, organizationId, analyticsPeriodStart(dateRange), {
        withDeals: canReadDeals(ctx),
      });
    }),

  /**
   * Get Agency Performance
   * Leads, SQL, wins and cost per sales agency (agency_name), and what their deals brought in
   * for those who may read deals (#448)
   */
  getAgencyPerformance: organizationProcedure
    .input(getAgencyPerformanceSchema)
    .query(({ ctx, input }): Promise<AgencyPerformanceRow[]> => {
      assertCanReadLeads(ctx.ability);
      const { organizationId, dateRange } = input;
      return getAgencyPerformance(ctx.db, organizationId, analyticsPeriodStart(dateRange), {
        withDeals: canReadDeals(ctx),
      });
    }),
});

/**
 * Leads of the organization created in the period (Japanese calendar days, like the dashboard)
 */
function inPeriod(organizationId: string, dateRange: DateRange) {
  const from = analyticsPeriodStart(dateRange);
  const inOrg = eq(leads.organizationId, organizationId);
  return from ? and(inOrg, gte(leads.createdAt, from)) : inOrg;
}
