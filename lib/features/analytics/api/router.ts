import type { AppAbility } from '@/lib/auth/permissions';
import { leads } from '@/lib/db/schema';
import { LEAD_STATUSES, type LeadStatus } from '@/lib/features/leads/types/pipeline';
import { organizationProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { and, count, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDashboardSummary } from '../dashboard';
import {
  getAcquisitionCost,
  getAgencyPerformance,
  getInflowSourceBreakdown,
} from '../lead-sources';
import { analyticsPeriodStart, jstMonthStart } from '../period';
import { getResponseTimeDistribution } from '../response-time';
import {
  type AcquisitionCostSummary,
  type AgencyPerformanceRow,
  type ComparisonResult,
  type ConversionFunnelData,
  type DateRange,
  type FunnelStage,
  type OverviewStats,
  type PeriodMetrics,
  type ResponseTimeResult,
  type ScoreDistributionData,
  type SourceBreakdown,
  type StatusBreakdown,
  type TrendDataPoint,
  getAcquisitionCostSchema,
  getAgencyPerformanceSchema,
  getComparisonSchema,
  getConversionFunnelSchema,
  getLeadTrendSchema,
  getOverviewSchema,
  getResponseTimeSchema,
  getScoreDistributionSchema,
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
   * Get Overview Statistics
   * Returns total leads, conversion rate, new leads this month, and average score
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

      // Get average score (excluding null scores)
      const avgScoreResult = await ctx.db
        .select({
          avg: sql<number>`COALESCE(AVG(${leads.score}), 0)`,
        })
        .from(leads)
        .where(and(eq(leads.organizationId, organizationId), sql`${leads.score} IS NOT NULL`));

      const averageScore = Math.round(Number(avgScoreResult[0]?.avg) || 0);

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
        averageScore,
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

      // One aggregate query. "Reached" counts are nested by construction
      // (won ⊆ negotiation ⊆ nurturing ⊆ total), so stage rates never exceed 100%.
      // Lost leads count toward negotiation only when has_negotiated is set; a lost
      // lead that never negotiated is not counted as nurtured (it cannot be told apart
      // from a lead lost straight from "new").
      const [counts] = await ctx.db
        .select({
          total: count(),
          new: sql<number>`count(*) FILTER (WHERE ${leads.status} = 'new')`,
          nurturing: sql<number>`count(*) FILTER (WHERE ${leads.status} = 'nurturing')`,
          negotiating: sql<number>`count(*) FILTER (WHERE ${leads.status} = 'negotiating')`,
          won: sql<number>`count(*) FILTER (WHERE ${leads.status} = 'won')`,
          reachedNurturing: sql<number>`count(*) FILTER (WHERE ${leads.status} IN ('nurturing', 'negotiating', 'won') OR ${leads.hasNegotiated})`,
          reachedNegotiation: sql<number>`count(*) FILTER (WHERE ${leads.status} IN ('negotiating', 'won') OR ${leads.hasNegotiated})`,
        })
        .from(leads)
        .where(period);

      const totalLeads = Number(counts?.total) || 0;
      const newCount = Number(counts?.new) || 0;
      const nurturingCount = Number(counts?.nurturing) || 0;
      const negotiatingCount = Number(counts?.negotiating) || 0;
      const wonCount = Number(counts?.won) || 0;

      const newTotal = totalLeads;
      const nurturingTotal = Number(counts?.reachedNurturing) || 0;
      const negotiatingTotal = Number(counts?.reachedNegotiation) || 0;
      const wonTotal = wonCount;

      const rate = (numerator: number, denominator: number) =>
        denominator > 0 ? Math.round((numerator / denominator) * 10000) / 100 : 0;

      // Build funnel stages
      const stages: FunnelStage[] = [
        {
          name: 'new',
          count: newCount,
          cumulativeCount: newTotal,
          percentage: 100,
          conversionRate: 100, // First stage always 100%
        },
        {
          name: 'nurturing',
          count: nurturingCount,
          cumulativeCount: nurturingTotal,
          percentage: rate(nurturingTotal, totalLeads),
          conversionRate: rate(nurturingTotal, newTotal),
        },
        {
          name: 'negotiating',
          count: negotiatingCount,
          cumulativeCount: negotiatingTotal,
          percentage: rate(negotiatingTotal, totalLeads),
          conversionRate: rate(negotiatingTotal, nurturingTotal),
        },
        {
          name: 'won',
          count: wonCount,
          cumulativeCount: wonTotal,
          percentage: rate(wonTotal, totalLeads),
          conversionRate: rate(wonTotal, negotiatingTotal),
        },
      ];

      // No average conversion time: it was `updatedAt - createdAt`, which grows with every later
      // edit. Leads do not record when they were won; 0 hides the figure on the page.
      const averageConversionDays = 0;

      return {
        stages,
        totalLeads,
        overallConversionRate: rate(wonTotal, totalLeads),
        averageConversionDays,
      };
    }),

  /**
   * Get Score Distribution
   * Returns distribution of leads by score ranges (0-25, 26-50, 51-75, 76-100)
   */
  getScoreDistribution: organizationProcedure
    .input(getScoreDistributionSchema)
    .query(async ({ ctx, input }): Promise<ScoreDistributionData[]> => {
      assertCanReadLeads(ctx.ability);
      const { organizationId, dateRange } = input;

      const period = inPeriod(organizationId, dateRange);

      // Get total count of leads with scores
      const totalResult = await ctx.db
        .select({ count: count() })
        .from(leads)
        .where(and(period, sql`${leads.score} IS NOT NULL`));

      const total = totalResult[0]?.count || 0;

      // Get counts for each score range
      const ranges = [
        { min: 0, max: 25, label: '0-25' },
        { min: 26, max: 50, label: '26-50' },
        { min: 51, max: 75, label: '51-75' },
        { min: 76, max: 100, label: '76-100' },
      ];

      const distribution: ScoreDistributionData[] = [];

      for (const range of ranges) {
        const countResult = await ctx.db
          .select({ count: count() })
          .from(leads)
          .where(and(period, gte(leads.score, range.min), lte(leads.score, range.max)));

        const rangeCount = countResult[0]?.count || 0;

        distribution.push({
          range: range.label,
          count: rangeCount,
          percentage: total > 0 ? Math.round((rangeCount / total) * 10000) / 100 : 0,
        });
      }

      return distribution;
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
      return getAcquisitionCost(ctx.db, organizationId, analyticsPeriodStart(dateRange));
    }),

  /**
   * Get Agency Performance
   * Leads, SQL, wins and cost per sales agency (agency_name)
   */
  getAgencyPerformance: organizationProcedure
    .input(getAgencyPerformanceSchema)
    .query(({ ctx, input }): Promise<AgencyPerformanceRow[]> => {
      assertCanReadLeads(ctx.ability);
      const { organizationId, dateRange } = input;
      return getAgencyPerformance(ctx.db, organizationId, analyticsPeriodStart(dateRange));
    }),

  /**
   * Get Comparison Analysis
   * Compare metrics between two time periods
   */
  getComparison: organizationProcedure
    .input(getComparisonSchema)
    .query(async ({ ctx, input }): Promise<ComparisonResult> => {
      assertCanReadLeads(ctx.ability);
      const { organizationId, currentPeriod, previousPeriod } = input;

      // Helper to get metrics for a period
      const getMetricsForPeriod = async (start: Date, end: Date): Promise<PeriodMetrics> => {
        // Get total and converted counts
        const countsResult = await ctx.db
          .select({
            total: count().as('total'),
            converted: sql<number>`SUM(CASE WHEN ${leads.status} = 'won' THEN 1 ELSE 0 END)`.as(
              'converted'
            ),
            avgScore: sql<number>`COALESCE(AVG(${leads.score}), 0)`.as('avgScore'),
          })
          .from(leads)
          .where(
            and(
              eq(leads.organizationId, organizationId),
              gte(leads.createdAt, start),
              lte(leads.createdAt, end)
            )
          );

        const totalLeads = countsResult[0]?.total || 0;
        const convertedLeads = Number(countsResult[0]?.converted) || 0;
        const averageScore = Math.round(Number(countsResult[0]?.avgScore) || 0);

        // Get by source
        const sourceData = await ctx.db
          .select({
            source: sql<string>`COALESCE(${leads.source}, 'unknown')`.as('source'),
            count: count().as('count'),
          })
          .from(leads)
          .where(
            and(
              eq(leads.organizationId, organizationId),
              gte(leads.createdAt, start),
              lte(leads.createdAt, end)
            )
          )
          .groupBy(sql`COALESCE(${leads.source}, 'unknown')`);

        const bySource: Record<string, number> = {};
        for (const row of sourceData) {
          bySource[row.source] = row.count;
        }

        // Get by status
        const statusData = await ctx.db
          .select({
            status: leads.status,
            count: count().as('count'),
          })
          .from(leads)
          .where(
            and(
              eq(leads.organizationId, organizationId),
              gte(leads.createdAt, start),
              lte(leads.createdAt, end)
            )
          )
          .groupBy(leads.status);

        const byStatus: Record<string, number> = {};
        for (const row of statusData) {
          byStatus[row.status] = row.count;
        }

        return {
          totalLeads,
          convertedLeads,
          conversionRate:
            totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 10000) / 100 : 0,
          averageScore,
          bySource,
          byStatus,
        };
      };

      // Get metrics for both periods
      const current = await getMetricsForPeriod(
        new Date(currentPeriod.start),
        new Date(currentPeriod.end)
      );
      const previous = await getMetricsForPeriod(
        new Date(previousPeriod.start),
        new Date(previousPeriod.end)
      );

      // Calculate percentage changes
      const calculateChange = (currentVal: number, previousVal: number): number => {
        if (previousVal === 0) return currentVal > 0 ? 100 : 0;
        return Math.round(((currentVal - previousVal) / previousVal) * 10000) / 100;
      };

      const changes = {
        totalLeads: calculateChange(current.totalLeads, previous.totalLeads),
        convertedLeads: calculateChange(current.convertedLeads, previous.convertedLeads),
        conversionRate: calculateChange(current.conversionRate, previous.conversionRate),
        averageScore: calculateChange(current.averageScore, previous.averageScore),
      };

      // Generate insights
      const insights: string[] = [];

      if (changes.totalLeads > 10) {
        insights.push(`Lead volume increased by ${changes.totalLeads}%`);
      } else if (changes.totalLeads < -10) {
        insights.push(`Lead volume decreased by ${Math.abs(changes.totalLeads)}%`);
      }

      if (changes.conversionRate > 5) {
        insights.push(`Conversion rate improved by ${changes.conversionRate}%`);
      } else if (changes.conversionRate < -5) {
        insights.push(`Conversion rate dropped by ${Math.abs(changes.conversionRate)}%`);
      }

      if (changes.averageScore > 5) {
        insights.push(`Lead quality improved (score up ${changes.averageScore}%)`);
      } else if (changes.averageScore < -5) {
        insights.push(`Lead quality declined (score down ${Math.abs(changes.averageScore)}%)`);
      }

      // Source comparison
      const currentTopSource = Object.entries(current.bySource).sort((a, b) => b[1] - a[1])[0];
      const previousTopSource = Object.entries(previous.bySource).sort((a, b) => b[1] - a[1])[0];

      if (currentTopSource && previousTopSource && currentTopSource[0] !== previousTopSource[0]) {
        insights.push(
          `Top lead source changed from ${previousTopSource[0]} to ${currentTopSource[0]}`
        );
      }

      return {
        currentPeriod: current,
        previousPeriod: previous,
        changes,
        insights,
      };
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
