'use client';

import { BarChart } from '@/components/charts';
import {
  DashboardWidget,
  type WidgetDefinition,
  WidgetSettings,
  useWidgetConfig,
} from '@/components/dashboard/widget-settings';
import { LEAD_STATUS_COLORS } from '@/components/features/leads/lead-status-styles';
import { Card } from '@/components/ui/card';
import { ProgressBar } from '@/components/ui/progress-bar';
import { useOrganization } from '@/hooks/use-organization';
import { AX_MIGRATION_CONFIG } from '@/lib/features/diagnostics/ax-migration/config';
import { trpc } from '@/lib/trpc/client';
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  BarChart3,
  Clock,
  Layers,
  MessageSquare,
  Star,
  Target,
  Users,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERIODS = [7, 30, 90] as const;
type Period = (typeof PERIODS)[number];

const WIDGET_IDS = ['kpis', 'pending', 'trend', 'breakdown', 'recent'] as const;

const KNOWN_PLATFORMS = ['as400', 'acos', 'access', 'other', 'unknown'] as const;

/**
 * Dashboard for the AX migration sales team: real figures for the chosen period, the
 * consultation requests waiting for a reply (by contact deadline), the daily trend, the
 * breakdown by status and migration source, and the latest leads.
 */
export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const tw = useTranslations('dashboard.ax');
  const tStatus = useTranslations('status');
  const locale = useLocale();
  const { organizationId: contextOrgId } = useOrganization();
  const organizationId = contextOrgId && UUID.test(contextOrgId) ? contextOrgId : '';
  const [days, setDays] = useState<Period>(30);
  const [widgetConfig, setWidgetConfig] = useWidgetConfig([...WIDGET_IDS]);
  // Fewer date labels on a phone; the chart renders on the client only
  const narrow = typeof window !== 'undefined' && window.innerWidth < 640;

  const { data, isLoading } = trpc.analytics.getDashboard.useQuery(
    { organizationId, days },
    { enabled: Boolean(organizationId), staleTime: 60 * 1000 }
  );

  const widgetDefinitions: WidgetDefinition[] = [
    {
      id: 'kpis',
      titleKey: 'kpis',
      descriptionKey: 'kpisDesc',
      icon: <BarChart3 className="h-4 w-4 text-blue-600" />,
    },
    {
      id: 'pending',
      titleKey: 'pending',
      descriptionKey: 'pendingDesc',
      icon: <Clock className="h-4 w-4 text-rose-600" />,
    },
    {
      id: 'trend',
      titleKey: 'trend',
      descriptionKey: 'trendDesc',
      icon: <Activity className="h-4 w-4 text-violet-600" />,
    },
    {
      id: 'breakdown',
      titleKey: 'breakdown',
      descriptionKey: 'breakdownDesc',
      icon: <Layers className="h-4 w-4 text-emerald-600" />,
    },
    {
      id: 'recent',
      titleKey: 'recent',
      descriptionKey: 'recentDesc',
      icon: <Users className="h-4 w-4 text-cyan-600" />,
    },
  ];

  const leadHref = (id: string) => `/${locale}/leads?leadId=${id}`;
  const dateFormat = new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
  });
  const platformName = (platform: string | null) => {
    const key = platform ?? 'unknown';
    return (KNOWN_PLATFORMS as readonly string[]).includes(key)
      ? tw(`platforms.${key as (typeof KNOWN_PLATFORMS)[number]}`)
      : key;
  };
  const previousText = (value: number) =>
    value === 0 ? tw('kpi.noPrevious', { days }) : tw('kpi.vsPrevious', { days, value });

  const chartData = (data?.daily ?? []).map((day) => ({
    date: dateFormat.format(new Date(`${day.date}T12:00:00+09:00`)),
    [tw('trend.leads')]: day.leads,
    [tw('trend.consultations')]: day.consultations,
  }));
  const hasTrend = (data?.daily ?? []).some((day) => day.leads > 0);
  const totalStatus = (data?.statuses ?? []).reduce((sum, s) => sum + s.count, 0);
  const totalPlatform = (data?.platforms ?? []).reduce((sum, p) => sum + p.count, 0);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' })
    .format(new Date())
    .replaceAll('-', '/');

  return (
    <div className="container mx-auto space-y-6 px-4 py-8">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-50">{t('title')}</h1>
          <p className="mt-1 text-gray-500 dark:text-gray-400">{tw('description')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <fieldset className="inline-flex rounded-lg border border-gray-200 bg-white p-1 dark:border-gray-700 dark:bg-gray-900">
            <legend className="sr-only">{tw('periodLabel')}</legend>
            {PERIODS.map((value) => (
              <label
                key={value}
                className={`cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500 ${
                  days === value
                    ? 'bg-brand-500 text-white'
                    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                }`}
              >
                <input
                  type="radio"
                  name="dashboard-period"
                  value={value}
                  checked={days === value}
                  onChange={() => setDays(value)}
                  className="sr-only"
                />
                {tw(`period.${value}`)}
              </label>
            ))}
          </fieldset>
          <WidgetSettings
            widgets={widgetDefinitions}
            config={widgetConfig}
            onConfigChange={setWidgetConfig}
          />
          <Link
            href={`/${locale}/leads`}
            className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-500/10"
          >
            {tw('toLeads')}
            <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>

      {/* Key figures */}
      <DashboardWidget id="kpis" config={widgetConfig}>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          <Kpi
            label={tw('kpi.newLeads')}
            icon={<Users className="h-5 w-5 text-blue-600" />}
            value={data?.newLeads}
            note={data ? previousText(data.previousNewLeads) : undefined}
            loading={isLoading}
          />
          <Kpi
            label={tw('kpi.consultations')}
            icon={<MessageSquare className="h-5 w-5 text-rose-600" />}
            value={data?.consultations}
            note={data ? previousText(data.previousConsultations) : undefined}
            loading={isLoading}
          />
          <Kpi
            label={tw('kpi.mql')}
            icon={<Target className="h-5 w-5 text-violet-600" />}
            value={data?.mql}
            note={data ? previousText(data.previousMql) : undefined}
            loading={isLoading}
          />
          <Kpi
            label={tw('kpi.averageScore')}
            icon={<Star className="h-5 w-5 text-amber-600" />}
            value={data?.averageScore ?? undefined}
            emptyValue={data && data.averageScore === null ? tw('kpi.noScore') : undefined}
            suffix={tw('kpi.scoreSuffix')}
            note={tw('kpi.periodNote', { days })}
            loading={isLoading}
          />
        </div>
      </DashboardWidget>

      {/* Consultation requests waiting for contact */}
      <DashboardWidget id="pending" config={widgetConfig}>
        <Card className="p-6">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">
                {tw('pending.title')}
                {data && data.pendingConsultationTotal > 0 && (
                  <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-sm font-bold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                    {data.pendingConsultationTotal}
                  </span>
                )}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {tw('pending.description', {
                  days: AX_MIGRATION_CONFIG.consultationResponseBusinessDays,
                })}
              </p>
            </div>
          </div>
          {data && data.pendingConsultations.length === 0 ? (
            <p className="rounded-lg bg-gray-50 px-4 py-6 text-center text-sm text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
              {tw('pending.empty')}
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {(data?.pendingConsultations ?? []).map((item) => {
                const dueToday = !item.overdue && item.deadline === today;
                return (
                  <li key={item.id}>
                    <Link
                      href={leadHref(item.id)}
                      className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg px-2 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/60"
                    >
                      <span
                        className={`inline-flex min-w-[7rem] items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${
                          item.overdue
                            ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
                            : dueToday
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'
                              : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                        }`}
                      >
                        {item.overdue && <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />}
                        {item.overdue
                          ? `${tw('pending.overdue')}（${item.deadline.slice(5)}）`
                          : dueToday
                            ? tw('pending.dueToday')
                            : tw('pending.due', { date: item.deadline.slice(5) })}
                      </span>
                      <span className="min-w-0 flex-1 basis-full sm:basis-auto">
                        <span className="font-medium text-gray-900 dark:text-gray-50">
                          {item.company ?? tw('recent.unnamed')}
                        </span>
                        <span className="ml-2 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                          {item.name}
                        </span>
                      </span>
                      <span className="whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        {platformName(item.platform)}
                        <span className="mx-2 text-gray-300" aria-hidden="true">
                          ·
                        </span>
                        {tw('pending.requestedAt', {
                          date: dateFormat.format(new Date(item.requestedAt)),
                        })}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          {data && data.pendingConsultationTotal > data.pendingConsultations.length && (
            <p className="mt-3 text-right text-sm text-gray-500">
              {tw('pending.more', {
                count: data.pendingConsultationTotal - data.pendingConsultations.length,
              })}
            </p>
          )}
        </Card>
      </DashboardWidget>

      {/* Daily trend */}
      <DashboardWidget id="trend" config={widgetConfig}>
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">
            {tw('trend.title')}
          </h2>
          <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">{tw('trend.description')}</p>
          {data && !hasTrend ? (
            <p className="rounded-lg bg-gray-50 px-4 py-10 text-center text-sm text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
              {tw('trend.empty')}
            </p>
          ) : (
            <BarChart
              data={chartData}
              index="date"
              categories={[tw('trend.leads'), tw('trend.consultations')]}
              colors={['blue', 'red']}
              valueFormatter={(value) => (locale === 'ja' ? `${value}件` : String(value))}
              showLegend
              integerValues
              maxCategoryLabels={narrow ? 4 : 10}
              columnWidth={days === 7 ? '45%' : '85%'}
              height={260}
            />
          )}
        </Card>
      </DashboardWidget>

      {/* Breakdown */}
      <DashboardWidget id="breakdown" config={widgetConfig}>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card className="p-6">
            <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-50">
              {tw('statuses.title')}
            </h2>
            <ul className="space-y-3">
              {(data?.statuses ?? []).map((item) => (
                <BreakdownRow
                  key={item.status}
                  label={tStatus(item.status)}
                  count={item.count}
                  total={totalStatus}
                  color={LEAD_STATUS_COLORS[item.status]}
                />
              ))}
            </ul>
          </Card>
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">
              {tw('platforms.title')}
            </h2>
            <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
              {tw('platforms.description', { days })}
            </p>
            {data && data.platforms.length === 0 ? (
              <p className="text-sm text-gray-500">{tw('platforms.empty')}</p>
            ) : (
              <ul className="space-y-3">
                {(data?.platforms ?? []).map((item) => (
                  <BreakdownRow
                    key={item.platform}
                    label={platformName(item.platform)}
                    count={item.count}
                    total={totalPlatform}
                    color="blue"
                  />
                ))}
              </ul>
            )}
          </Card>
        </div>
      </DashboardWidget>

      {/* Recent leads */}
      <DashboardWidget id="recent" config={widgetConfig}>
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between px-6 pt-6 pb-3">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">
              {tw('recent.title')}
            </h2>
            <Link
              href={`/${locale}/leads`}
              className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
            >
              {t('viewAll')}
            </Link>
          </div>
          {data && data.recentLeads.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-gray-500">{tw('recent.empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y border-gray-100 bg-gray-50 text-left text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-800/50 dark:text-gray-400">
                    <th scope="col" className="px-6 py-2 font-medium">
                      {tw('recent.name')}
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {tw('recent.platform')}
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      {tw('recent.score')}
                    </th>
                    <th scope="col" className="px-6 py-2 text-right font-medium">
                      {tw('recent.received')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {(data?.recentLeads ?? []).map((lead) => (
                    <tr key={lead.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/60">
                      <td className="px-6 py-3">
                        <Link href={leadHref(lead.id)} className="block">
                          <span className="font-medium text-gray-900 hover:underline dark:text-gray-50">
                            {lead.name ?? tw('recent.unnamed')}
                          </span>
                          {lead.consultation && (
                            <span className="ml-2 rounded bg-rose-50 px-1.5 py-0.5 text-xs font-semibold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                              {tw('recent.consultation')}
                            </span>
                          )}
                          <span className="block text-xs text-gray-500 dark:text-gray-400">
                            {lead.company}
                          </span>
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-gray-600 dark:text-gray-300">
                        {platformName(lead.platform)}
                      </td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums text-gray-900 dark:text-gray-50">
                        {lead.score ?? '—'}
                      </td>
                      <td className="px-6 py-3 text-right text-gray-500 tabular-nums dark:text-gray-400">
                        {dateFormat.format(new Date(lead.createdAt))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </DashboardWidget>
    </div>
  );
}

function Kpi({
  label,
  icon,
  value,
  emptyValue,
  suffix,
  note,
  loading,
}: {
  label: string;
  icon: ReactNode;
  value?: number;
  emptyValue?: string;
  suffix?: string;
  note?: string;
  loading: boolean;
}) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{label}</p>
        <span className="rounded-lg bg-gray-50 p-2 dark:bg-gray-800" aria-hidden="true">
          {icon}
        </span>
      </div>
      {loading ? (
        <span className="mt-2 inline-block h-9 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
      ) : (
        <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900 sm:text-3xl dark:text-gray-50">
          {value ?? emptyValue ?? '—'}
          {value !== undefined && suffix && (
            <span className="ml-1 text-base font-normal text-gray-400">{suffix}</span>
          )}
        </p>
      )}
      {note && <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{note}</p>}
    </Card>
  );
}

function BreakdownRow({
  label,
  count,
  total,
  color,
}: {
  label: string;
  count: number;
  total: number;
  color: Parameters<typeof ProgressBar>[0]['color'];
}) {
  const percent = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <li>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
        <span className="text-gray-700 dark:text-gray-200">{label}</span>
        <span className="tabular-nums text-gray-900 dark:text-gray-50">
          <span className="font-semibold">{count}</span>
          <span className="ml-2 text-xs text-gray-500">{percent}%</span>
        </span>
      </div>
      <ProgressBar value={percent} color={color} />
    </li>
  );
}
