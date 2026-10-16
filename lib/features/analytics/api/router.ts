import { leads } from '@/lib/db/schema';
import { LEAD_STATUSES, type LeadStatus } from '@/lib/features/leads/types/pipeline';
import { organizationProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { and, avg, count, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDashboardSummary } from '../dashboard';
import {
  type ComparisonResult,
  type ConversionFunnelData,
  type FunnelStage,
  type OverviewStats,
  type PeriodMetrics,
  type ROISummary,
  type ResponseTimeData,
  type ScoreDistributionData,
  type SourceBreakdown,
  type SourceROIData,
  type StatusBreakdown,
  type TrendDataPoint,
  getComparisonSchema,
  getConversionFunnelSchema,
  getLeadTrendSchema,
  getOverviewSchema,
  getROISchema,
  getResponseTimeSchema,
  getScoreDistributionSchema,
  getSourceBreakdownSchema,
  getStatusBreakdownSchema,
} from '../types/schemas';

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
      if (!ctx.ability.can('read', 'Lead')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'リードを閲覧する権限がありません' });
      }
      return getDashboardSummary(ctx.db, input.organizationId, input.days);
    }),

  /**
   * Get Overview Statistics
   * Returns total leads, conversion rate, new leads this month, and average score
   */
  getOverview: organizationProcedure
    .input(getOverviewSchema)
    .query(async ({ ctx, input }): Promise<OverviewStats> => {
      const { organizationId, dateRange } = input;

      // Calculate date threshold based on range
      const now = new Date();
      const dateThreshold = getDateThreshold(dateRange);

      // Get total leads for organization
      const totalLeadsResult = await ctx.db
        .select({ count: count() })
        .from(leads)
        .where(eq(leads.organizationId, organizationId));

      const totalLeads = totalLeadsResult[0]?.count || 0;

      // Get new leads this month
      const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
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
      const { organizationId, dateRange, granularity } = input;

      const dateThreshold = getDateThreshold(dateRange);

      // SQL format for date truncation
      const dateFormat =
        granularity === 'daily'
          ? sql`DATE(${leads.createdAt})`
          : sql`DATE_TRUNC('month', ${leads.createdAt})`;

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
        .where(and(eq(leads.organizationId, organizationId), gte(leads.createdAt, dateThreshold)))
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
   * Returns distribution of leads by source channel
   */
  getSourceBreakdown: organizationProcedure
    .input(getSourceBreakdownSchema)
    .query(async ({ ctx, input }): Promise<SourceBreakdown[]> => {
      const { organizationId, dateRange } = input;

      const dateThreshold = getDateThreshold(dateRange);

      // Get total count for percentage calculation
      const totalResult = await ctx.db
        .select({ count: count() })
        .from(leads)
        .where(and(eq(leads.organizationId, organizationId), gte(leads.createdAt, dateThreshold)));

      const total = totalResult[0]?.count || 0;

      // Get counts by source
      const sourceData = await ctx.db
        .select({
          source: sql<string>`COALESCE(${leads.source}, 'unknown')`.as('source'),
          count: count().as('count'),
        })
        .from(leads)
        .where(and(eq(leads.organizationId, organizationId), gte(leads.createdAt, dateThreshold)))
        .groupBy(sql`COALESCE(${leads.source}, 'unknown')`)
        .orderBy(desc(count()));

      return sourceData.map((row) => ({
        source: row.source,
        count: row.count,
        percentage: total > 0 ? Math.round((row.count / total) * 10000) / 100 : 0,
      }));
    }),

  /**
   * Get Status Breakdown
   * Returns distribution of leads by status
   */
  getStatusBreakdown: organizationProcedure
    .input(getStatusBreakdownSchema)
    .query(async ({ ctx, input }): Promise<StatusBreakdown[]> => {
      const { organizationId, dateRange } = input;

      const dateThreshold = getDateThreshold(dateRange);

      // Get total count for percentage calculation
      const totalResult = await ctx.db
        .select({ count: count() })
        .from(leads)
        .where(and(eq(leads.organizationId, organizationId), gte(leads.createdAt, dateThreshold)));

      const total = totalResult[0]?.count || 0;

      // Get counts by status
      const statusData = await ctx.db
        .select({
          status: leads.status,
          count: count().as('count'),
        })
        .from(leads)
        .where(and(eq(leads.organizationId, organizationId), gte(leads.createdAt, dateThreshold)))
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
      const { organizationId, dateRange } = input;

      const dateThreshold = getDateThreshold(dateRange);

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
        .where(and(eq(leads.organizationId, organizationId), gte(leads.createdAt, dateThreshold)));

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

      // Calculate average conversion time (for leads that have been converted)
      const avgTimeResult = await ctx.db
        .select({
          avgDays: sql<number>`COALESCE(
            AVG(EXTRACT(EPOCH FROM (${leads.updatedAt} - ${leads.createdAt})) / 86400),
            0
          )`.as('avgDays'),
        })
        .from(leads)
        .where(
          and(
            eq(leads.organizationId, organizationId),
            eq(leads.status, 'won'),
            gte(leads.createdAt, dateThreshold)
          )
        );

      const averageConversionDays = Math.round(Number(avgTimeResult[0]?.avgDays) * 10) / 10 || 0;

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
      const { organizationId, dateRange } = input;

      const dateThreshold = getDateThreshold(dateRange);

      // Get total count of leads with scores
      const totalResult = await ctx.db
        .select({ count: count() })
        .from(leads)
        .where(
          and(
            eq(leads.organizationId, organizationId),
            gte(leads.createdAt, dateThreshold),
            sql`${leads.score} IS NOT NULL`
          )
        );

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
          .where(
            and(
              eq(leads.organizationId, organizationId),
              gte(leads.createdAt, dateThreshold),
              gte(leads.score, range.min),
              lte(leads.score, range.max)
            )
          );

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
   * Returns distribution of leads by response time categories
   */
  getResponseTime: organizationProcedure
    .input(getResponseTimeSchema)
    .query(async ({ ctx, input }): Promise<ResponseTimeData[]> => {
      const { organizationId, dateRange } = input;

      const dateThreshold = getDateThreshold(dateRange);

      // Get leads with both createdAt and updatedAt for response time calculation
      // Response time is calculated as time between creation and first status change (updatedAt)
      const leadsData = await ctx.db
        .select({
          id: leads.id,
          createdAt: leads.createdAt,
          updatedAt: leads.updatedAt,
          status: leads.status,
        })
        .from(leads)
        .where(
          and(
            eq(leads.organizationId, organizationId),
            gte(leads.createdAt, dateThreshold),
            // Only count leads that have been updated (status changed)
            sql`${leads.status} != 'new'`
          )
        );

      // Calculate response times in hours
      const responseTimes = leadsData.map((lead) => {
        const created = new Date(lead.createdAt);
        const updated = new Date(lead.updatedAt);
        return (updated.getTime() - created.getTime()) / (1000 * 60 * 60); // hours
      });

      const total = responseTimes.length;

      // Categorize by time periods
      const periods = [
        { min: 0, max: 1, label: '< 1 hour' },
        { min: 1, max: 24, label: '1-24 hours' },
        { min: 24, max: 72, label: '1-3 days' },
        { min: 72, max: Number.POSITIVE_INFINITY, label: '3+ days' },
      ];

      const distribution: ResponseTimeData[] = [];

      for (const period of periods) {
        const periodTimes = responseTimes.filter((time) => time >= period.min && time < period.max);
        const periodCount = periodTimes.length;
        const avgHours =
          periodTimes.length > 0 ? periodTimes.reduce((a, b) => a + b, 0) / periodTimes.length : 0;

        distribution.push({
          period: period.label,
          count: periodCount,
          percentage: total > 0 ? Math.round((periodCount / total) * 10000) / 100 : 0,
          averageHours: Math.round(avgHours * 10) / 10,
        });
      }

      return distribution;
    }),

  /**
   * Get ROI Analysis by Lead Source
   * Calculates return on investment for each lead source
   */
  getROI: organizationProcedure
    .input(getROISchema)
    .query(async ({ ctx, input }): Promise<ROISummary> => {
      const { organizationId, dateRange, costPerLead, averageDealValue } = input;

      const dateThreshold = getDateThreshold(dateRange);

      // Default costs per lead by source (in currency units)
      const defaultCosts: Record<string, number> = {
        website: costPerLead?.website ?? 50,
        embed: costPerLead?.embed ?? 30,
        api: costPerLead?.api ?? 20,
        unknown: costPerLead?.unknown ?? 40,
      };

      // Default average deal value
      const dealValue = averageDealValue ?? 5000;

      // Get leads grouped by source with conversion counts
      const sourceData = await ctx.db
        .select({
          source: sql<string>`COALESCE(${leads.source}, 'unknown')`.as('source'),
          total: count().as('total'),
          converted: sql<number>`SUM(CASE WHEN ${leads.status} = 'won' THEN 1 ELSE 0 END)`.as(
            'converted'
          ),
        })
        .from(leads)
        .where(and(eq(leads.organizationId, organizationId), gte(leads.createdAt, dateThreshold)))
        .groupBy(sql`COALESCE(${leads.source}, 'unknown')`);

      // Calculate ROI for each source
      const bySource: SourceROIData[] = sourceData.map((row) => {
        const source = row.source;
        const leadCount = row.total;
        const convertedCount = Number(row.converted) || 0;
        const costPerLeadForSource = defaultCosts[source] ?? defaultCosts.unknown;

        const totalCost = leadCount * costPerLeadForSource;
        const totalRevenue = convertedCount * dealValue;
        const roi = totalCost > 0 ? ((totalRevenue - totalCost) / totalCost) * 100 : 0;
        const conversionRate = leadCount > 0 ? (convertedCount / leadCount) * 100 : 0;
        const costPerAcquisition = convertedCount > 0 ? totalCost / convertedCount : 0;
        const revenuePerLead = leadCount > 0 ? totalRevenue / leadCount : 0;

        return {
          source,
          leadCount,
          convertedCount,
          conversionRate: Math.round(conversionRate * 100) / 100,
          totalCost: Math.round(totalCost * 100) / 100,
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          roi: Math.round(roi * 100) / 100,
          costPerAcquisition: Math.round(costPerAcquisition * 100) / 100,
          revenuePerLead: Math.round(revenuePerLead * 100) / 100,
        };
      });

      // Calculate totals
      const totalLeads = bySource.reduce((sum, s) => sum + s.leadCount, 0);
      const totalConverted = bySource.reduce((sum, s) => sum + s.convertedCount, 0);
      const totalCost = bySource.reduce((sum, s) => sum + s.totalCost, 0);
      const totalRevenue = bySource.reduce((sum, s) => sum + s.totalRevenue, 0);
      const overallROI = totalCost > 0 ? ((totalRevenue - totalCost) / totalCost) * 100 : 0;
      const overallConversionRate = totalLeads > 0 ? (totalConverted / totalLeads) * 100 : 0;
      const averageCostPerLead = totalLeads > 0 ? totalCost / totalLeads : 0;
      const averageCostPerAcquisition = totalConverted > 0 ? totalCost / totalConverted : 0;
      const averageRevenuePerLead = totalLeads > 0 ? totalRevenue / totalLeads : 0;

      // Find best and worst performing sources
      const sourcesWithROI = bySource.filter((s) => s.leadCount > 0);
      const sortedByROI = [...sourcesWithROI].sort((a, b) => b.roi - a.roi);
      const bestPerformingSource = sortedByROI[0]?.source ?? null;
      const worstPerformingSource = sortedByROI[sortedByROI.length - 1]?.source ?? null;

      return {
        totalLeads,
        totalConverted,
        totalCost: Math.round(totalCost * 100) / 100,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        overallROI: Math.round(overallROI * 100) / 100,
        overallConversionRate: Math.round(overallConversionRate * 100) / 100,
        averageCostPerLead: Math.round(averageCostPerLead * 100) / 100,
        averageCostPerAcquisition: Math.round(averageCostPerAcquisition * 100) / 100,
        averageRevenuePerLead: Math.round(averageRevenuePerLead * 100) / 100,
        bySource,
        bestPerformingSource,
        worstPerformingSource,
      };
    }),

  /**
   * Get Comparison Analysis
   * Compare metrics between two time periods
   */
  getComparison: organizationProcedure
    .input(getComparisonSchema)
    .query(async ({ ctx, input }): Promise<ComparisonResult> => {
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
 * Helper function to calculate date threshold based on range
 */
function getDateThreshold(dateRange: '7d' | '30d' | '90d' | 'all'): Date {
  const now = new Date();

  switch (dateRange) {
    case '7d':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case '30d':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case '90d':
      return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    case 'all':
      return new Date(0); // Beginning of time
    default:
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // Default to 30 days
  }
}
