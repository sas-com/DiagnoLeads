'use client';

import { DueTasksSection } from '@/components/features/lead-follow-up/due-tasks-section';
import { STUDIO_PAGE_CLASS, StudioPageHeader } from '@/components/studio';
import { useOrganization } from '@/hooks/use-organization';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { useFormatter, useTranslations } from 'next-intl';
import { TodayActivities } from './today-activities';
import { TodayDeals } from './today-deals';
import { TodayMeetings } from './today-meetings';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** "Today" changes at midnight: the sections are read again when the screen opens after this */
const TODAY_STALE_TIME = 30 * 1000;

/**
 * 今日 (#556): the signed-in member's day on one screen, in the order of the day's work: their
 * next actions due today or earlier, their meetings this week from today, the contacts they
 * recorded today, and their deals that need attention. Each section reads on its own, so one that
 * fails leaves the others shown. The heading says which day (Japan) the server read them for,
 * so a screen left open past midnight shows it is of the day before.
 */
export function TodayScreen() {
  const t = useTranslations('today');
  const format = useFormatter();
  const { organizationId: contextOrgId } = useOrganization();
  const organizationId = contextOrgId && UUID.test(contextOrgId) ? contextOrgId : '';
  const options = { enabled: !!organizationId, staleTime: TODAY_STALE_TIME };
  const meetings = trpc.leads.myMeetings.useQuery({ organizationId }, options);
  const activities = trpc.leadActivity.myDay.useQuery({ organizationId }, options);
  const deals = trpc.deals.board.useQuery(
    // Closed deals are never marked: only those closed today come along
    { organizationId, owner: 'mine', closedWithinDays: 0 },
    options
  );
  const day = activities.data?.day ?? meetings.data?.today ?? deals.data?.today;

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
      </div>
      {organizationId && (
        <>
          <DueTasksSection organizationId={organizationId} mineOnly />
          <TodayMeetings query={meetings} />
          <TodayActivities query={activities} />
          <TodayDeals query={deals} />
        </>
      )}
    </div>
  );
}
