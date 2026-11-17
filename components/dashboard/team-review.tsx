'use client';

import { TooltipProvider } from '@/components/ui/tooltip';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';
import type { CardState } from './ax-dashboard-sections';
import { NextMeetingRateSection } from './meeting-sections';
import { AnalyticsPanel, PipelineSection, StatusOverview } from './studio-sections';

export type TeamReviewDays = 7 | 30 | 90;

/**
 * The days of the review for the period chosen on the analytics page. The review reads 7, 30 or
 * 90 days; "all" shows the longest, and the panel says which days its figures are of.
 */
export function teamReviewDays(range: string): TeamReviewDays {
  if (range === '7d') return 7;
  if (range === '30d') return 30;
  return 90;
}

/**
 * The team's figures to look back on, once the dashboard's (#1164, decision
 * 2026-11-14-navigation-one-path): where things stand, the period's figure and curve with its
 * sources and changes, the rate of next meetings fixed at the first one, and the pipeline. Shown
 * on the analytics page, for the period chosen there.
 */
export function TeamReview({
  organizationId,
  days,
}: {
  organizationId: string;
  days: TeamReviewDays;
}) {
  const narrow = useNarrowScreen();
  const { data, dataUpdatedAt, isError, isPlaceholderData, refetch } =
    trpc.analytics.getDashboard.useQuery(
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

  return (
    <TooltipProvider delayDuration={200}>
      <div
        aria-busy={isPlaceholderData}
        className={cn('space-y-10 transition-opacity', isPlaceholderData && 'opacity-60')}
      >
        <StatusOverview organizationId={organizationId} state={state} data={data} />
        <AnalyticsPanel
          state={state}
          data={data}
          onRetry={retry}
          days={days}
          narrow={narrow}
          updatedAt={dataUpdatedAt || undefined}
        />
        <NextMeetingRateSection organizationId={organizationId} days={days} />
        <PipelineSection state={state} data={data} onRetry={retry} />
      </div>
    </TooltipProvider>
  );
}

/** Phone-width screens get fewer date labels */
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
