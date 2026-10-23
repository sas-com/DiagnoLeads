'use client';

import {
  type CardState,
  PendingSection,
  RecentSection,
} from '@/components/dashboard/ax-dashboard-sections';
import {
  NextMeetingRateSection,
  WeekMeetingsSection,
} from '@/components/dashboard/meeting-sections';
import {
  AnalyticsPanel,
  PipelineSection,
  StatusOverview,
} from '@/components/dashboard/studio-sections';
import {
  DashboardWidget,
  type WidgetDefinition,
  WidgetSettings,
  useWidgetConfig,
  visibleWidgetIds,
} from '@/components/dashboard/widget-settings';
import { DueTasksSection } from '@/components/features/lead-follow-up/due-tasks-section';
import { STUDIO_PAGE_CLASS, StudioPageHeader } from '@/components/studio';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useLeadAccess } from '@/hooks/use-leads';
import { useOrganization } from '@/hooks/use-organization';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import {
  Activity,
  BarChart3,
  CalendarCheck,
  CalendarClock,
  Clock,
  Layers,
  ListTodo,
  Users,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Fragment, type ReactNode, useEffect, useState } from 'react';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERIODS = [7, 30, 90] as const;
type Period = (typeof PERIODS)[number];

/** Default order: what needs a reply first, the next actions due, then the figures of the period */
const WIDGET_IDS = [
  'pending',
  'today',
  'meetings',
  'kpis',
  'meetingRate',
  'trend',
  'breakdown',
  'recent',
] as const;
/** Widgets whose figures follow the chosen period */
const PERIOD_WIDGETS: readonly string[] = ['kpis', 'meetingRate', 'trend', 'breakdown'];
/** Widgets shown together in the analytics panel, at the place of the first of them (#410) */
const ANALYTICS_WIDGETS: readonly string[] = ['trend', 'breakdown', 'kpis'];

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
    // This week's meetings from the hearings (#137)
    id: 'meetings',
    titleKey: 'meetings',
    descriptionKey: 'meetingsDesc',
    icon: <CalendarClock className={iconClass} />,
  },
  {
    id: 'kpis',
    titleKey: 'kpis',
    descriptionKey: 'kpisDesc',
    icon: <BarChart3 className={iconClass} />,
  },
  {
    // KPI: next meeting fixed at the first meeting (#137)
    id: 'meetingRate',
    titleKey: 'meetingRate',
    descriptionKey: 'meetingRateDesc',
    icon: <CalendarCheck className={iconClass} />,
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
 * Dashboard for the AX migration sales team, in the look of the STUDIO dashboard (#410): where
 * things stand now (consultations waiting for a reply, next actions, this week's meetings), the
 * lists behind them, then the analytics panel (the period's figure and curve, migration sources,
 * what changed against the previous period), the pipeline and the latest leads.
 */
export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const tw = useTranslations('dashboard.ax');
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
  const showsPeriod = order.some((id) => PERIOD_WIDGETS.includes(id));
  const firstAnalytics = order.find((id) => ANALYTICS_WIDGETS.includes(id));
  const visible = (id: string) => order.includes(id);

  const toolbar = (
    <>
      {showsPeriod && (
        <ToggleGroup
          type="single"
          size="sm"
          value={String(days)}
          onValueChange={(value) => {
            if (value) setDays(Number(value) as Period);
          }}
          aria-label={tw('periodLabel')}
          className="rounded-md border border-gray-200 bg-white p-0.5 dark:border-gray-700 dark:bg-gray-900"
        >
          {PERIODS.map((value) => (
            <ToggleGroupItem key={value} value={String(value)}>
              {tw(`period.${value}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}
      <WidgetSettings
        widgets={WIDGET_DEFINITIONS}
        config={widgetConfig}
        onConfigChange={setWidgetConfig}
        compact={narrow}
      />
    </>
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
    // The "next actions" figure of the status block jumps here
    today: (
      <div id="dashboard-today" className="scroll-mt-24">
        <DueTasksSection organizationId={organizationId} />
      </div>
    ),
    meetings: <WeekMeetingsSection organizationId={organizationId} />,
    meetingRate: <NextMeetingRateSection organizationId={organizationId} days={days} />,
    recent: <RecentSection state={state} data={data} onRetry={retry} />,
  };
  const analytics = (
    <AnalyticsPanel
      state={state}
      data={data}
      onRetry={retry}
      days={days}
      narrow={narrow}
      show={{ trend: visible('trend'), breakdown: visible('breakdown'), kpis: visible('kpis') }}
    />
  );

  return (
    <TooltipProvider delayDuration={200}>
      <div className={cn(STUDIO_PAGE_CLASS, 'space-y-10 py-1 sm:space-y-14 sm:px-2 sm:py-6')}>
        <StudioPageHeader
          title={t('title')}
          description={tw('description')}
          actions={organizationId ? toolbar : undefined}
        />

        {!organizationId ? (
          // biome-ignore lint/a11y/useSemanticElements: live-region notice, not the result of a form calculation
          <p
            role="status"
            className="rounded-lg bg-gray-50 px-4 py-6 text-center text-sm text-gray-600 dark:bg-gray-800/50 dark:text-gray-300"
          >
            {tw('noOrganization')}
          </p>
        ) : (
          <>
            <StatusOverview organizationId={organizationId} state={state} data={data} />
            {order.map((id) => {
              if (ANALYTICS_WIDGETS.includes(id)) {
                // The three share one panel, at the place of the first of them; the pipeline (all
                // leads by status, part of the breakdown) stays at the breakdown's own place
                return (
                  <Fragment key={id}>
                    {id === firstAnalytics && (
                      <div
                        aria-busy={isPlaceholderData}
                        className={cn('transition-opacity', isPlaceholderData && 'opacity-60')}
                      >
                        {analytics}
                      </div>
                    )}
                    {id === 'breakdown' && (
                      <PipelineSection state={state} data={data} onRetry={retry} />
                    )}
                  </Fragment>
                );
              }
              return (
                <DashboardWidget key={id} id={id} config={widgetConfig}>
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
              );
            })}
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
