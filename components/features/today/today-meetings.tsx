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
import { leadLabel, splitMeetings } from './today-format';
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

/** When a meeting is: its time today, or its day (and time) later in the week; Japan time */
function MeetingWhen({ meeting, withDay }: { meeting: Meeting; withDay: boolean }) {
  const t = useTranslations('today.meetings');
  const meetingDay = useMeetingDay();
  const { nextMeetingDate: date, nextMeetingTime: time } = meeting;
  const day = withDay ? `${meetingDay(date)}${time ? ' ' : ''}` : '';
  if (time) {
    return <time dateTime={`${date}T${time}+09:00`}>{`${day}${time}`}</time>;
  }
  return withDay ? (
    <time dateTime={date}>{day}</time>
  ) : (
    <span className="font-normal text-gray-600 dark:text-gray-300">{t('noTime')}</span>
  );
}

/** One meeting, all of it a link to the lead: when, the lead, and what to know before going */
function MeetingItem({ meeting, withDay }: { meeting: Meeting; withDay: boolean }) {
  const t = useTranslations('today.meetings');
  const tToday = useTranslations('today');
  const tStatus = useTranslations('status');
  const locale = useLocale();
  const closed = (NEXT_MEETING_CLOSED_STATUSES as readonly string[]).includes(meeting.status);
  const lead = leadLabel(meeting);
  return (
    <li>
      <Link
        href={`/${locale}/leads/${meeting.leadId}`}
        className={cn(
          'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-1 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/50',
          TAP_TARGET
        )}
      >
        <span
          className={cn(
            'shrink-0 text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-50',
            // A time is short; "no time recorded" keeps to one line
            withDay ? 'w-36' : 'min-w-14 whitespace-nowrap'
          )}
        >
          <MeetingWhen meeting={meeting} withDay={withDay} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-gray-900 underline underline-offset-4 dark:text-gray-50">
            {lead.primary ?? tToday('noLeadName')}
          </span>
          {lead.secondary && (
            <span className="block truncate text-sm text-gray-600 dark:text-gray-300">
              {lead.secondary}
            </span>
          )}
        </span>
        {/* A block, not a span: the badges are <div>s */}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
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
        </div>
      </Link>
    </li>
  );
}

/** Today's or the rest of the week's meetings, under a heading of the section (no landmark) */
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
    <div className="space-y-1">
      <h3 id={headingId} className="text-sm font-bold text-gray-900 dark:text-gray-50">
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="py-2 text-sm text-gray-600 dark:text-gray-300">{emptyText}</p>
      ) : (
        <ul aria-labelledby={headingId} className="divide-y divide-gray-100 dark:divide-gray-800">
          {items.map((meeting) => (
            <MeetingItem key={meeting.leadId} meeting={meeting} withDay={withDay} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The user's meetings (今日, #556): those of today, then the rest of the week (tomorrow to
 * Sunday), from the latest hearing's next meeting date or the confirmed first meeting, with its
 * time when one was confirmed. The link opens the lead list of the user's leads' meetings this
 * week, which its label says: the list has the week's passed days and not the unassigned leads.
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
