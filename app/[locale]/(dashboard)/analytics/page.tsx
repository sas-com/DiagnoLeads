'use client';

import {
  useAcquisitionCost,
  useAgencyPerformance,
  useConversionFunnel,
  useLeadTrend,
  useOverview,
  useResponseTime,
  useSourceBreakdown,
  useStatusBreakdown,
} from '@/hooks/use-analytics';
import { useExport } from '@/hooks/use-export';
import { useOrganization } from '@/hooks/use-organization';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useState } from 'react';

import { AreaChart, ChartLegend, DonutChart } from '@/components/charts';
import { LEAD_STATUS_COLORS } from '@/components/features/leads/lead-status-styles';
import { Badge } from '@/components/ui/badge';
import { BarList } from '@/components/ui/bar-list';
import { Card } from '@/components/ui/card';
import { Divider, Metric, Text, Title } from '@/components/ui/metric';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { LeadStatus } from '@/lib/features/leads/types';
import { LEAD_STATUSES } from '@/lib/features/leads/types/pipeline';
import { MQL_LEVEL_FILTERS, type MqlLevelFilter } from '@/lib/features/leads/types/schemas';
import { AgencyContractReportCard } from './_components/agency-contract-report-card';
import { DeliveryReportCards } from './_components/delivery-report-cards';
import { AcquisitionCostCard, AgencyPerformanceCard } from './_components/source-cost-cards';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import type { DateRange, TrendGranularity } from '@/lib/features/analytics/types/schemas';
import {
  Activity,
  BadgeCheck,
  BarChart3,
  Calendar,
  Download,
  FileJson,
  FileSpreadsheet,
  FileText,
  PieChart,
  Target,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react';

// Dynamic imports for heavy chart components
const ConversionFunnel = dynamic(
  () =>
    import('@/components/analytics/conversion-funnel').then((mod) => ({
      default: mod.ConversionFunnel,
    })),
  {
    loading: () => <ChartSkeleton />,
    ssr: false,
  }
);

const ResponseTimeChart = dynamic(
  () =>
    import('@/components/analytics/response-time-chart').then((mod) => ({
      default: mod.ResponseTimeChart,
    })),
  {
    loading: () => <ChartSkeleton />,
    ssr: false,
  }
);

/** Bar colors of the MQL levels: 関心あり in emerald like the list's MQL badge */
const MQL_LEVEL_COLORS: Record<MqlLevelFilter, 'emerald' | 'blue' | 'gray' | 'amber'> = {
  interest: 'emerald',
  fit: 'blue',
  none: 'gray',
  unknown: 'amber',
};

/** Leads without a recorded 流入元 */
const UNSET_INFLOW_SOURCE = 'unset';

function ChartSkeleton() {
  return (
    <Card className="animate-pulse p-6">
      <div className="h-8 bg-gray-200 rounded w-1/4 mb-4" />
      <div className="h-64 bg-gray-100 rounded" />
    </Card>
  );
}

/**
 * Check if a string is a valid UUID
 */
function isValidUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * Analytics Dashboard Page
 * Tailwind v4 compatible UI
 */
export default function AnalyticsPage() {
  const t = useTranslations('settings.analytics');
  const tStatus = useTranslations('status');
  const tCommon = useTranslations('common');
  const tInflowSource = useTranslations('pipeline.inflowSource');
  const tLeads = useTranslations('leads');
  const tMqlLevel = useTranslations('leadList.mqlLevelOptions');
  const locale = useLocale();
  const format = useFormatter();
  const { organizationId: contextOrgId, isLoading: contextLoading } = useOrganization();

  // Only use organization ID if it's a valid UUID
  const hasValidOrgId = Boolean(contextOrgId && isValidUUID(contextOrgId));
  const organizationId = hasValidOrgId && contextOrgId ? contextOrgId : '';
  const [dateRange, setDateRange] = useState<DateRange>('30d');
  const [granularity, setGranularity] = useState<TrendGranularity>('daily');

  // Fetch analytics data
  const { data: overview, isLoading: overviewLoading } = useOverview(organizationId, dateRange);
  const { data: leadTrend, isLoading: trendLoading } = useLeadTrend(
    organizationId,
    dateRange,
    granularity
  );
  const { data: sourceBreakdown, isLoading: sourceLoading } = useSourceBreakdown(
    organizationId,
    dateRange
  );
  const { data: statusBreakdown, isLoading: statusLoading } = useStatusBreakdown(
    organizationId,
    dateRange
  );
  const { data: funnelData, isLoading: funnelLoading } = useConversionFunnel(
    organizationId,
    dateRange
  );
  const { data: responseTime, isLoading: responseTimeLoading } = useResponseTime(
    organizationId,
    dateRange
  );
  const { data: acquisitionCost, isLoading: acquisitionCostLoading } = useAcquisitionCost(
    organizationId,
    dateRange
  );
  const { data: agencyPerformance, isLoading: agencyLoading } = useAgencyPerformance(
    organizationId,
    dateRange
  );

  // 流入元 values ('lp_organic', ...) shown with their labels; 'unset' as 未設定
  const sourceLabel = (source: string) => {
    if (source === UNSET_INFLOW_SOURCE) return tLeads('notSet');
    return tInflowSource.has(source) ? tInflowSource(source) : source;
  };
  const labeledSources = sourceBreakdown?.map((item) => ({
    ...item,
    source: sourceLabel(item.source),
  }));

  // Export functionality
  const { exportAnalyticsReport, exportAnalyticsJSON, exportAnalyticsPDF, isExporting } = useExport(
    {
      organizationName: 'Organization',
      locale: locale as 'en' | 'ja',
    }
  );

  const handleExportCSV = () => {
    if (overview && leadTrend && labeledSources && statusBreakdown && funnelData) {
      exportAnalyticsReport({
        overview,
        trend: leadTrend,
        sourceBreakdown: labeledSources,
        statusBreakdown,
        funnel: funnelData,
        dateRange,
      });
    }
  };

  const handleExportJSON = () => {
    if (overview && leadTrend && labeledSources && statusBreakdown && funnelData) {
      exportAnalyticsJSON({
        overview,
        trend: leadTrend,
        sourceBreakdown: labeledSources,
        statusBreakdown,
        funnel: funnelData,
        dateRange,
      });
    }
  };

  const handleExportPDF = () => {
    if (overview) {
      exportAnalyticsPDF({
        overview,
        trend: leadTrend,
        sourceBreakdown: labeledSources,
        statusBreakdown,
        funnel: funnelData,
        dateRange,
      });
    }
  };

  const dateRangeOptions: { value: DateRange; label: string }[] = [
    { value: '7d', label: t('dateRange.7d') },
    { value: '30d', label: t('dateRange.30d') },
    { value: '90d', label: t('dateRange.90d') },
    { value: 'all', label: t('dateRange.all') },
  ];

  const granularityOptions: { value: TrendGranularity; label: string }[] = [
    { value: 'daily', label: t('granularity.daily') },
    { value: 'monthly', label: t('granularity.monthly') },
  ];

  // No period-over-period change is shown until it is computed from real data (#138)

  // Value formatter for charts
  const valueFormatter = (value: number) => t('leadCount', { count: value });

  // Transform lead trend data for chart
  const chartData = (leadTrend || [])
    .map((item) => ({
      date: format.dateTime(new Date(item.date), { month: 'short', day: 'numeric' }),
      [t('charts.totalLeads')]: item.count,
      [t('charts.convertedLeads')]: item.converted,
    }))
    .reverse();

  // Transform status data for donut chart (each status keeps its own color)
  const statusData = (statusBreakdown || []).map((item) => ({
    name: tStatus(item.status),
    value: item.count,
  }));
  const statusColors = (statusBreakdown || []).map(
    (item) => LEAD_STATUS_COLORS[item.status as LeadStatus] ?? 'gray'
  );
  const dateRangeLabel = dateRangeOptions.find((option) => option.value === dateRange)?.label ?? '';

  // Transform source data for bar list
  const sourceBarData = (sourceBreakdown || []).map((item) => ({
    name: sourceLabel(item.source),
    value: item.count,
  }));

  return (
    <div className="container mx-auto py-8 px-4 space-y-8">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="h-14 w-14 bg-gradient-to-br from-blue-100 to-violet-100 dark:from-blue-900/30 dark:to-violet-900/30 rounded-xl flex items-center justify-center">
            <BarChart3 className="h-7 w-7 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">{t('title')}</h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1">{t('description')}</p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-gray-500" />
            <Select value={dateRange} onValueChange={(v) => setDateRange(v as DateRange)}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {dateRangeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Select value={granularity} onValueChange={(v) => setGranularity(v as TrendGranularity)}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {granularityOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={isExporting || !overview}>
                <Download className="h-4 w-4 mr-2" />
                {isExporting ? '...' : t('export')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleExportCSV}>
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportJSON}>
                <FileJson className="h-4 w-4 mr-2" />
                JSON
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportPDF}>
                <FileText className="h-4 w-4 mr-2" />
                PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Total Leads */}
        <Card className="p-6" decoration="top" decorationColor="blue">
          <div className="flex items-start justify-between">
            <div>
              <Text>{t('stats.totalLeads')}</Text>
              {overviewLoading ? (
                <div className="h-9 w-24 bg-gray-200 animate-pulse rounded mt-2" />
              ) : (
                <Metric className="mt-2">{format.number(overview?.totalLeads || 0)}</Metric>
              )}
            </div>
            <div className="p-3 bg-blue-50 rounded-xl">
              <Users className="h-6 w-6 text-blue-600" />
            </div>
          </div>
        </Card>

        {/* New Leads */}
        <Card className="p-6" decoration="top" decorationColor="emerald">
          <div className="flex items-start justify-between">
            <div>
              <Text>{t('stats.newLeadsThisMonth')}</Text>
              {overviewLoading ? (
                <div className="h-9 w-20 bg-gray-200 animate-pulse rounded mt-2" />
              ) : (
                <Metric className="mt-2">{format.number(overview?.newLeadsThisMonth || 0)}</Metric>
              )}
            </div>
            <div className="p-3 bg-emerald-50 rounded-xl">
              <TrendingUp className="h-6 w-6 text-emerald-600" />
            </div>
          </div>
        </Card>

        {/* Conversion Rate */}
        <Card className="p-6" decoration="top" decorationColor="violet">
          <div className="flex items-start justify-between">
            <div>
              <Text>{t('stats.conversionRate')}</Text>
              {overviewLoading ? (
                <div className="h-9 w-20 bg-gray-200 animate-pulse rounded mt-2" />
              ) : (
                <Metric className="mt-2">{(overview?.conversionRate || 0).toFixed(1)}%</Metric>
              )}
            </div>
            <div className="p-3 bg-violet-50 rounded-xl">
              <Target className="h-6 w-6 text-violet-600" />
            </div>
          </div>
          <div className="mt-4">
            <ProgressBar value={overview?.conversionRate || 0} color="violet" />
          </div>
        </Card>

        {/* MQL (interested): the sign of how promising leads are (#447, #605) */}
        <Card className="p-6" decoration="top" decorationColor="emerald">
          <div className="flex items-start justify-between">
            <div>
              <Text>{t('stats.mqlInterest')}</Text>
              {overviewLoading ? (
                <div className="h-9 w-20 bg-gray-200 animate-pulse rounded mt-2" />
              ) : (
                <Metric className="mt-2">{format.number(overview?.mqlLevels.interest || 0)}</Metric>
              )}
            </div>
            <div className="p-3 bg-emerald-50 rounded-xl">
              <BadgeCheck className="h-6 w-6 text-emerald-600" />
            </div>
          </div>
          <div className="mt-4">
            <ProgressBar value={overview?.mqlRate || 0} color="emerald" />
            <Text className="mt-2">
              {t('stats.mqlRate', { rate: (overview?.mqlRate || 0).toFixed(1) })}
            </Text>
          </div>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList className="w-full lg:w-auto">
          <TabsTrigger value="overview" className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            {t('tabs.overview')}
          </TabsTrigger>
          <TabsTrigger value="sources" className="flex items-center gap-2">
            <PieChart className="h-4 w-4" />
            {t('tabs.sources')}
          </TabsTrigger>
          <TabsTrigger value="funnel" className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            {t('tabs.funnel')}
          </TabsTrigger>
          <TabsTrigger value="performance" className="flex items-center gap-2">
            <Zap className="h-4 w-4" />
            {t('tabs.performance')}
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
            {/* Lead Trend Area Chart */}
            <Card className="lg:col-span-2 p-6">
              <Title>{t('charts.leadTrend')}</Title>
              <Text>{t('description')}</Text>
              {trendLoading ? (
                <div className="h-80 bg-gray-100 animate-pulse rounded-lg mt-4" />
              ) : (
                <AreaChart
                  className="h-80 mt-4"
                  data={chartData}
                  index="date"
                  categories={[t('charts.totalLeads'), t('charts.convertedLeads')]}
                  colors={['blue', 'violet']}
                  valueFormatter={valueFormatter}
                  showLegend={true}
                  showGridLines={true}
                  showAnimation={true}
                  curveType="smooth"
                />
              )}
            </Card>

            {/* Status Donut Chart */}
            <Card className="p-6">
              <Title>{t('charts.statusBreakdown')}</Title>
              <Text>{t('charts.statusBreakdownPeriod', { period: dateRangeLabel })}</Text>
              {statusLoading ? (
                <div className="h-48 w-48 mx-auto bg-gray-100 animate-pulse rounded-full mt-4" />
              ) : (
                <>
                  {/* The legend below the card replaces the chart's own (it overlapped the ring) */}
                  <DonutChart
                    className="mt-4"
                    height={240}
                    data={statusData}
                    colors={statusColors}
                    valueFormatter={valueFormatter}
                    totalLabel={t('charts.total')}
                    showLabel={true}
                    showLegend={false}
                    showAnimation={true}
                  />
                  <ChartLegend
                    className="mt-4"
                    categories={statusData.map((d) => d.name)}
                    colors={statusColors}
                  />
                </>
              )}
            </Card>
          </div>

          {/* Leads per MQL level, counted as the list's MQL level filter (#605) */}
          {overview && !overviewLoading && (
            <Card className="mt-6 p-6">
              <Title>{t('charts.mqlLevels')}</Title>
              <Text>{t('charts.mqlLevelsDescription')}</Text>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mt-4">
                {MQL_LEVEL_FILTERS.map((level) => {
                  const value = overview.mqlLevels[level];
                  const percentage =
                    overview.totalLeads > 0 ? (value / overview.totalLeads) * 100 : 0;
                  return (
                    <div key={level} className="space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <Text className="font-medium">{tMqlLevel(level)}</Text>
                        <Text className="font-semibold">{t('leadCount', { count: value })}</Text>
                      </div>
                      <ProgressBar value={percentage} color={MQL_LEVEL_COLORS[level]} />
                      <Text className="text-right">{percentage.toFixed(1)}%</Text>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* Status Progress Cards */}
          {overview && !overviewLoading && (
            <Card className="mt-6 p-6">
              <Title>{t('charts.statusBreakdown')}</Title>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6 mt-4">
                {LEAD_STATUSES.map((key) => ({
                  key,
                  color: LEAD_STATUS_COLORS[key],
                  value: overview.leadsByStatus[key],
                })).map((status) => {
                  const percentage =
                    overview.totalLeads > 0 ? (status.value / overview.totalLeads) * 100 : 0;
                  return (
                    <div key={status.key} className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Badge color={status.color} size="lg">
                          {tStatus(status.key)}
                        </Badge>
                        <Text className="font-semibold">
                          {t('leadCount', { count: status.value })}
                        </Text>
                      </div>
                      <ProgressBar value={percentage} color={status.color} />
                      <Text className="text-right">{percentage.toFixed(1)}%</Text>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </TabsContent>

        {/* Sources Tab */}
        <TabsContent value="sources">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
            {/* Source Donut Chart */}
            <Card className="p-6">
              <Title>{t('charts.sourceBreakdown')}</Title>
              <Text>{t('charts.sourceBreakdownPeriod', { period: dateRangeLabel })}</Text>
              {sourceLoading ? (
                <div className="h-64 flex items-center justify-center">
                  <div className="w-48 h-48 rounded-full bg-gray-200 animate-pulse" />
                </div>
              ) : sourceBreakdown && sourceBreakdown.length > 0 ? (
                <>
                  <DonutChart
                    className="mt-4"
                    height={256}
                    data={sourceBarData}
                    colors={['blue', 'emerald', 'violet', 'amber', 'rose', 'cyan', 'pink']}
                    valueFormatter={valueFormatter}
                    totalLabel={t('charts.total')}
                    showLabel={true}
                    showLegend={false}
                    showAnimation={true}
                  />
                  <ChartLegend
                    className="mt-4 flex-wrap"
                    categories={sourceBarData.map((d) => d.name)}
                    colors={['blue', 'emerald', 'violet', 'amber', 'rose', 'cyan', 'pink']}
                  />
                </>
              ) : (
                <div className="h-64 flex items-center justify-center">
                  <Text>{t('noData')}</Text>
                </div>
              )}
            </Card>

            {/* Source Bar List */}
            <Card className="p-6">
              <Title>{t('charts.sourceTable')}</Title>
              {sourceLoading ? (
                <div className="space-y-3 mt-4">
                  {[...Array(5)].map((_, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholders that are never reordered and have no identity
                    <div key={`skeleton-${i}`} className="h-10 bg-gray-200 animate-pulse rounded" />
                  ))}
                </div>
              ) : sourceBreakdown && sourceBreakdown.length > 0 ? (
                <div className="mt-4">
                  <BarList
                    data={sourceBarData}
                    valueFormatter={valueFormatter}
                    showAnimation={true}
                  />
                  <Divider />
                  <div className="space-y-2">
                    {sourceBreakdown.map((source, index) => (
                      <div key={source.source} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge variant="gray" size="sm">
                            #{index + 1}
                          </Badge>
                          <Text>{sourceLabel(source.source)}</Text>
                        </div>
                        <Text className="font-semibold">{source.percentage.toFixed(1)}%</Text>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="h-64 flex items-center justify-center">
                  <Text>{t('noData')}</Text>
                </div>
              )}
            </Card>
          </div>

          {/* Cost and agencies, from the cost and agency recorded on each lead */}
          <div className="grid grid-cols-1 gap-6 mt-6">
            <AcquisitionCostCard
              data={acquisitionCost}
              isLoading={acquisitionCostLoading}
              sourceLabel={sourceLabel}
            />
            <AgencyPerformanceCard data={agencyPerformance} isLoading={agencyLoading} />
            <AgencyContractReportCard organizationId={organizationId} />
          </div>
        </TabsContent>

        {/* Funnel Tab */}
        <TabsContent value="funnel">
          <Card className="mt-6 p-6">
            <Title>{t('charts.conversionFunnel')}</Title>
            <Text className="mb-4">{t('description')}</Text>
            <ConversionFunnel
              leadsByStatus={overview?.leadsByStatus}
              funnelData={funnelData}
              isLoading={overviewLoading || funnelLoading}
            />
          </Card>

          {/* Funnel Metrics */}
          {overview && !overviewLoading && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6 mt-6">
              {LEAD_STATUSES.map((key) => (
                <Card
                  key={key}
                  className="p-6"
                  decoration="left"
                  decorationColor={LEAD_STATUS_COLORS[key]}
                >
                  <Text>{tStatus(key)}</Text>
                  <Metric className="mt-2">{overview.leadsByStatus[key]}</Metric>
                  <Text className="mt-2">
                    {overview.totalLeads > 0
                      ? ((overview.leadsByStatus[key] / overview.totalLeads) * 100).toFixed(1)
                      : 0}
                    %
                  </Text>
                </Card>
              ))}
            </div>
          )}

          <DeliveryReportCards organizationId={organizationId} />
        </TabsContent>

        {/* Performance Tab */}
        <TabsContent value="performance">
          <div className="grid grid-cols-1 gap-6 mt-6">
            {/* Response Time */}
            <Card className="p-6">
              <Title>{t('charts.responseTime')}</Title>
              {responseTime?.status === 'ready' ? (
                <ResponseTimeChart data={responseTime.distribution} isLoading={false} />
              ) : responseTimeLoading ? (
                <div className="h-64 bg-gray-100 animate-pulse rounded-lg mt-4" />
              ) : (
                // Not measured until the first contact is recorded on leads (#136)
                <div className="h-64 flex items-center justify-center">
                  <Text>{t('charts.responseTimePending')}</Text>
                </div>
              )}
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
