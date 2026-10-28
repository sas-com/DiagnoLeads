'use client';

import { useDueTasks } from '@/components/features/lead-follow-up/use-due-tasks';
import { STUDIO_PAGE_CLASS, StudioPageHeader } from '@/components/studio';
import { Skeleton } from '@/components/ui/skeleton';
import { useOrganization } from '@/hooks/use-organization';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { useFormatter, useTranslations } from 'next-intl';
import { TodayActivities } from './today-activities';
import { TodayDeals } from './today-deals';
import { TodayMeetings } from './today-meetings';
import { TodayNextActions } from './today-next-actions';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * "Today" changes at midnight: the sections are read again when the screen opens or the window
 * comes back after this (the app's default reads only when a screen opens)
 */
const TODAY_QUERY_OPTIONS = { staleTime: 30 * 1000, refetchOnWindowFocus: true };

/**
 * 今日 (#556): the signed-in member's day on one screen, in the order of the day's work: their
 * next actions due today or earlier, their meetings this week from today, their deals that need
 * attention, and the contacts they recorded today. Each section reads on its own, so one that
 * fails leaves the others shown. The heading says which day (Japan) the server read them for,
 * so a screen left open past midnight shows it is of the day before.
 */
export function TodayScreen() {
  const t = useTranslations('today');
  const format = useFormatter();
  const { organizationId: contextOrgId } = useOrganization();
  const organizationId = contextOrgId && UUID.test(contextOrgId) ? contextOrgId : '';
  const options = { enabled: !!organizationId, ...TODAY_QUERY_OPTIONS };
  const due = useDueTasks(organizationId, 'mine', TODAY_QUERY_OPTIONS);
  const meetings = trpc.leads.myMeetings.useQuery({ organizationId }, options);
  const deals = trpc.deals.board.useQuery(
    // Closed deals are never marked: only those closed today come along
    { organizationId, owner: 'mine', closedWithinDays: 0 },
    options
  );
  const activities = trpc.leadActivity.myDay.useQuery({ organizationId }, options);
  const day = activities.data?.day ?? meetings.data?.today ?? due.data?.today ?? deals.data?.today;
  // The line keeps its place while the day comes, so the sections do not move
  const waitingForDay =
    !day &&
    !!organizationId &&
    ![due.query, meetings, deals, activities].every((query) => query.isError);

  return (
    <div className={cn(STUDIO_PAGE_CLASS, 'space-y-6 py-1 sm:px-2 sm:py-6')}>
      <div className="space-y-2">
        <StudioPageHeader title={t('title')} description={t('description')} />
        {day && (
          <p className="text-base font-semibold text-gray-900 dark:text-gray-50">
            {t('dateLine', {
              date: format.dateTime(new Date(`${day}T00:00:00Z`), {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                weekday: 'short',
                timeZone: 'UTC',
              }),
            })}
          </p>
        )}
        {waitingForDay && <Skeleton className="h-6 w-56" data-testid="day-loading" />}
      </div>
      {!organizationId ? (
        // biome-ignore lint/a11y/useSemanticElements: live-region notice, not the result of a form calculation
        <p
          role="status"
          className="rounded-lg bg-gray-50 px-4 py-6 text-center text-sm text-gray-600 dark:bg-gray-800/50 dark:text-gray-300"
        >
          {t('noOrganization')}
        </p>
      ) : (
        <>
          <TodayNextActions due={due} organizationId={organizationId} />
          <TodayMeetings query={meetings} />
          <TodayDeals query={deals} />
          <TodayActivities query={activities} />
        </>
      )}
    </div>
  );
}
