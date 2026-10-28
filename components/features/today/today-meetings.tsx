'use client';

import { TAP_TARGET } from '@/components/common/tap-target';
import { DealRatingBadge } from '@/components/features/leads/next-meeting';
import { Badge } from '@/components/ui/badge';
import { NEXT_MEETING_CLOSED_STATUSES, leadListHref } from '@/lib/features/leads/list-query';
import type { RouterOutputs } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useId } from 'react';
import { splitMeetings } from './today-format';
import { type TodayQuery, TodaySection, sectionState } from './today-section';

type MyMeetings = RouterOutputs['leads']['myMeetings'];
type Meeting = MyMeetings['items'][number];

/** 'YYYY-MM-DD' -> a short day with its weekday ('10/30(金)') */
function useMeetingDay() {
  const format = useFormatter();
  return (day: string) =>
    format.dateTime(new Date(`${day}T00:00:00Z`), {
      month: 'numeric',
      day: 'numeric',
      weekday: 'short',
      timeZone: 'UTC',
    });
}

/** One meeting: when, the lead (a link to its page) and what to know before going */
function MeetingItem({ meeting, withDay }: { meeting: Meeting; withDay: boolean }) {
  const t = useTranslations('today.meetings');
  const tStatus = useTranslations('status');
  const locale = useLocale();
  const meetingDay = useMeetingDay();
  const closed = (NEXT_MEETING_CLOSED_STATUSES as readonly string[]).includes(meeting.status);
  const time = meeting.nextMeetingTime ?? (withDay ? null : t('noTime'));
  return (
    <li>
      <Link
        href={`/${locale}/leads/${meeting.leadId}`}
        className={cn(
          'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-1 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/50',
          TAP_TARGET
        )}
      >
        <span className="w-36 shrink-0 text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-50">
          {withDay && (
            <time dateTime={meeting.nextMeetingDate}>{meetingDay(meeting.nextMeetingDate)}</time>
          )}
          {withDay && time && ' '}
          {time}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-gray-900 underline underline-offset-4 dark:text-gray-50">
            {meeting.company || t('noCompany')}
          </span>
          {meeting.name && (
            <span className="block truncate text-sm text-gray-600 dark:text-gray-300">
              {meeting.name}
            </span>
          )}
        </span>
        <span className="flex shrink-0 flex-wrap items-center gap-2">
          {meeting.firstMeeting && (
            <Badge color="blue" className="text-sm">
              {t('firstMeeting')}
            </Badge>
          )}
          {meeting.dealRating && (
            <DealRatingBadge rating={meeting.dealRating} className="text-sm" />
          )}
          {closed && (
            <Badge color="gray" className="text-sm">
              {tStatus(meeting.status)}
            </Badge>
          )}
          {meeting.unassigned && (
            <span className="text-sm text-gray-700 dark:text-gray-300">{t('unassigned')}</span>
          )}
        </span>
      </Link>
    </li>
  );
}

function MeetingGroup({
  title,
  items,
  emptyText,
  withDay,
}: {
  title: string;
  items: Meeting[];
  emptyText: string;
  withDay: boolean;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-1">
      <h3 id={headingId} className="text-sm font-bold text-gray-900 dark:text-gray-50">
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="py-2 text-sm text-gray-600 dark:text-gray-300">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {items.map((meeting) => (
            <MeetingItem key={meeting.leadId} meeting={meeting} withDay={withDay} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The user's meetings (今日, #556): those of today, then the rest of the week (tomorrow to
 * Sunday), from the latest hearing's next meeting date or the confirmed first meeting, with its
 * time when one was confirmed. The link opens the lead list of the user's meetings this week.
 */
export function TodayMeetings({ query }: { query: TodayQuery<MyMeetings> }) {
  const t = useTranslations('today.meetings');
  const locale = useLocale();
  const data = query.data;
  const groups = data ? splitMeetings(data.items, data.today) : { today: [], later: [] };
  const rest = data ? data.total - data.items.length : 0;
  const listHref = leadListHref(
    { assignee: 'me', nextMeeting: 'thisWeek' },
    { by: 'nextMeetingDate', order: 'asc' },
    `/${locale}/leads`
  );

  return (
    <TodaySection
      title={t('title')}
      description={t('description')}
      count={data?.total}
      link={{ href: listHref, label: t('viewAll') }}
      state={sectionState(query, data?.items.length === 0)}
      emptyText={t('empty')}
    >
      <div className="space-y-4">
        <MeetingGroup
          title={t('todayHeading')}
          items={groups.today}
          emptyText={t('emptyToday')}
          withDay={false}
        />
        {/* On Sunday the week has no rest */}
        {data && data.today < data.weekEnd && (
          <MeetingGroup
            title={t('laterHeading')}
            items={groups.later}
            emptyText={t('emptyLater')}
            withDay
          />
        )}
        {rest > 0 && data && (
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {t('more', { count: rest, shown: data.items.length })}
          </p>
        )}
      </div>
    </TodaySection>
  );
}
