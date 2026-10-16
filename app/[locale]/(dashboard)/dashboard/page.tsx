'use client';

import {
  BreakdownSection,
  type CardState,
  KpiSection,
  PendingSection,
  RecentSection,
  TrendSection,
  leadListHref,
} from '@/components/dashboard/ax-dashboard-sections';
import {
  DashboardWidget,
  type WidgetDefinition,
  WidgetSettings,
  useWidgetConfig,
  visibleWidgetIds,
} from '@/components/dashboard/widget-settings';
import { DueTasksSection } from '@/components/features/lead-follow-up/due-tasks-section';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useLeadAccess } from '@/hooks/use-leads';
import { useOrganization } from '@/hooks/use-organization';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { Activity, ArrowUpRight, BarChart3, Clock, Layers, ListTodo, Users } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { Fragment, type ReactNode, useEffect, useState } from 'react';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERIODS = [7, 30, 90] as const;
type Period = (typeof PERIODS)[number];

/** Default order: what needs a reply first, the next actions due, then the figures of the period */
const WIDGET_IDS = ['pending', 'today', 'kpis', 'trend', 'breakdown', 'recent'] as const;
/** Widgets whose figures follow the chosen period; the period switch sits above the first one */
const PERIOD_WIDGETS: readonly string[] = ['kpis', 'trend', 'breakdown'];

const iconClass = 'h-4 w-4 text-gray-500 dark:text-gray-400';
const WIDGET_DEFINITIONS: WidgetDefinition[] = [
  {
    id: 'pending',
    titleKey: 'pending',
    descriptionKey: 'pendingDesc',
    icon: <Clock className={iconClass} />,
  },
  {
    id: 'today',
    titleKey: 'today',
    descriptionKey: 'todayDesc',
    icon: <ListTodo className={iconClass} />,
  },
  {
    id: 'kpis',
    titleKey: 'kpis',
    descriptionKey: 'kpisDesc',
    icon: <BarChart3 className={iconClass} />,
  },
  {
    id: 'trend',
    titleKey: 'trend',
    descriptionKey: 'trendDesc',
    icon: <Activity className={iconClass} />,
  },
  {
    id: 'breakdown',
    titleKey: 'breakdown',
    descriptionKey: 'breakdownDesc',
    icon: <Layers className={iconClass} />,
  },
  {
    id: 'recent',
    titleKey: 'recent',
    descriptionKey: 'recentDesc',
    icon: <Users className={iconClass} />,
  },
];

/**
 * Dashboard for the AX migration sales team: the consultation requests waiting for a reply (by
 * contact deadline) first, then real figures for the chosen period against the previous one,
 * the trend, the pipeline and migration sources, and the latest leads.
 */
export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const tw = useTranslations('dashboard.ax');
  const locale = useLocale();
  const { organizationId: contextOrgId } = useOrganization();
  const organizationId = contextOrgId && UUID.test(contextOrgId) ? contextOrgId : '';
  const [days, setDays] = useState<Period>(30);
  const [widgetConfig, setWidgetConfig] = useWidgetConfig([...WIDGET_IDS]);
  const narrow = useNarrowScreen();
  const access = useLeadAccess(organizationId);

  const { data, isError, isPlaceholderData, refetch } = trpc.analytics.getDashboard.useQuery(
    { organizationId, days },
    {
      enabled: Boolean(organizationId),
      staleTime: 60 * 1000,
      // Keep the figures on screen while another period loads
      placeholderData: (previous) => previous,
    }
  );
  const state: CardState = data ? 'ready' : isError ? 'error' : 'loading';
  const retry = () => {
    void refetch();
  };

  const order = visibleWidgetIds(widgetConfig);
  const toolbarBefore = order.find((id) => PERIOD_WIDGETS.includes(id));

  const toolbar = (
    <div className="flex items-center justify-between gap-3">
      {toolbarBefore ? (
        <ToggleGroup
          type="single"
          size="sm"
          value={String(days)}
          onValueChange={(value) => {
            if (value) setDays(Number(value) as Period);
          }}
          aria-label={tw('periodLabel')}
          className="rounded-lg border border-gray-200 bg-white p-1 dark:border-gray-700 dark:bg-gray-900"
        >
          {PERIODS.map((value) => (
            <ToggleGroupItem key={value} value={String(value)}>
              {tw(`period.${value}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      ) : (
        <span />
      )}
      <WidgetSettings
        widgets={WIDGET_DEFINITIONS}
        config={widgetConfig}
        onConfigChange={setWidgetConfig}
        compact={narrow}
      />
    </div>
  );

  const sections: Record<string, ReactNode> = {
    pending: (
      <PendingSection
        state={state}
        data={data}
        onRetry={retry}
        organizationId={organizationId}
        canRecordContact={access.canEdit}
      />
    ),
    today: <DueTasksSection organizationId={organizationId} />,
    kpis: <KpiSection state={state} data={data} onRetry={retry} />,
    trend: <TrendSection state={state} data={data} onRetry={retry} narrow={narrow} days={days} />,
    breakdown: <BreakdownSection state={state} data={data} onRetry={retry} days={days} />,
    recent: <RecentSection state={state} data={data} onRetry={retry} />,
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4 py-1 sm:space-y-6 sm:px-2 sm:py-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl dark:text-gray-50">
              {t('title')}
            </h1>
            <p className="mt-1 hidden text-gray-500 sm:block dark:text-gray-400">
              {tw('description')}
            </p>
          </div>
          <Link
            href={leadListHref(locale)}
            className="hidden items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-brand-600 hover:bg-brand-50 sm:inline-flex dark:text-brand-400 dark:hover:bg-brand-500/10"
          >
            {tw('toLeads')}
            <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>

        {!organizationId ? (
          <p
            role="status"
            className="rounded-lg bg-gray-50 px-4 py-6 text-center text-sm text-gray-600 dark:bg-gray-800/50 dark:text-gray-300"
          >
            {tw('noOrganization')}
          </p>
        ) : (
          <>
            {!toolbarBefore && toolbar}
            {order.map((id) => (
              <Fragment key={id}>
                {id === toolbarBefore && toolbar}
                <DashboardWidget id={id} config={widgetConfig}>
                  <section
                    aria-busy={isPlaceholderData && PERIOD_WIDGETS.includes(id)}
                    className={cn(
                      'transition-opacity',
                      isPlaceholderData && PERIOD_WIDGETS.includes(id) && 'opacity-60'
                    )}
                  >
                    {sections[id]}
                  </section>
                </DashboardWidget>
              </Fragment>
            ))}
          </>
        )}
      </div>
    </TooltipProvider>
  );
}

/** Phone-width screens get fewer date labels and an icon-only settings button */
function useNarrowScreen() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(max-width: 639px)');
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return narrow;
}
