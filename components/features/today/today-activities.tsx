'use client';

import { TAP_TARGET } from '@/components/common/tap-target';
import { ContactDetails } from '@/components/features/lead-activity/contact-details';
import { EventTitle } from '@/components/features/lead-activity/lead-activity-card';
import { durationParts } from '@/components/features/lead-follow-up/contact-format';
import { CONTACT_KIND_ICONS } from '@/components/features/lead-follow-up/contact-kinds';
import { Button } from '@/components/ui/button';
import type { RouterOutputs } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useId, useState } from 'react';
import { contactCounts, leadLabel } from './today-format';
import { type TodayQuery, TodaySection, sectionState } from './today-section';

type MyDay = RouterOutputs['leadActivity']['myDay'];

const TIME_ZONE = 'Asia/Tokyo';
/** Records listed before "show all": the counts above say how the day went */
export const TODAY_CONTACTS_SHOWN = 5;

/**
 * What the user recorded today (今日, #556): how many contacts of each kind ("no answer"
 * included, every kind shown) and the minutes they took, then the newest records with their
 * time, what it was, the lead (a link to its activity), the details and the note; "show all"
 * opens the rest. Counted by the time of the contact in Japan, so a record entered later for
 * today counts today.
 */
export function TodayActivities({ query }: { query: TodayQuery<MyDay> }) {
  const t = useTranslations('today.activities');
  const tToday = useTranslations('today');
  const tFollowUp = useTranslations('leadFollowUp');
  const locale = useLocale();
  const format = useFormatter();
  const listId = useId();
  const [expanded, setExpanded] = useState(false);
  const data = query.data;
  const items = data ? (expanded ? data.items : data.items.slice(0, TODAY_CONTACTS_SHOWN)) : [];
  const folds = !!data && data.items.length > TODAY_CONTACTS_SHOWN;

  return (
    <TodaySection
      title={t('title')}
      description={t('description')}
      count={data?.total}
      state={sectionState(query, data?.total === 0)}
      emptyText={t('empty')}
    >
      {data && (
        <div className="space-y-4">
          <dl className="flex flex-wrap gap-x-6 gap-y-2 rounded-lg border border-gray-200 px-4 py-3 dark:border-gray-800">
            {contactCounts(data.byKind).map(({ kind, count }) => {
              const Icon = CONTACT_KIND_ICONS[kind];
              return (
                <div key={kind} className="flex items-center gap-1.5 text-sm">
                  <dt className="flex items-center gap-1.5 text-gray-700 dark:text-gray-300">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    {t(`kinds.${kind}`)}
                  </dt>
                  <dd className="font-semibold tabular-nums text-gray-900 dark:text-gray-50">
                    {t('kindCount', { count })}
                  </dd>
                </div>
              );
            })}
            {/* No time recorded today: nothing to add up */}
            {data.durationMinutes > 0 && (
              <div className="flex items-center gap-1.5 text-sm">
                <dt className="text-gray-700 dark:text-gray-300">{t('durationLabel')}</dt>
                <dd className="font-semibold tabular-nums text-gray-900 dark:text-gray-50">
                  {tFollowUp('duration', durationParts(data.durationMinutes))}
                </dd>
              </div>
            )}
          </dl>
          <ol id={listId} className="divide-y divide-gray-100 dark:divide-gray-800">
            {items.map(({ lead, event }) => {
              const Icon = CONTACT_KIND_ICONS[event.contactKind];
              const at = new Date(event.at);
              const name = leadLabel(lead);
              return (
                <li key={event.id} className="flex gap-3 py-3">
                  <Icon
                    className="mt-0.5 h-5 w-5 shrink-0 text-gray-600 dark:text-gray-300"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                      <time
                        dateTime={at.toISOString()}
                        className="font-semibold tabular-nums text-gray-900 dark:text-gray-50"
                      >
                        {format.dateTime(at, {
                          hour: '2-digit',
                          minute: '2-digit',
                          timeZone: TIME_ZONE,
                        })}
                      </time>
                      <span className="font-medium text-gray-900 dark:text-gray-50">
                        <EventTitle event={event} />
                      </span>
                    </p>
                    <Link
                      href={`/${locale}/leads/${lead.id}?tab=activity`}
                      className={cn(
                        'inline-flex max-w-full items-center text-sm text-brand-700 underline underline-offset-4 hover:text-brand-800 dark:text-brand-300',
                        TAP_TARGET
                      )}
                    >
                      <span className="truncate">
                        {name.primary ?? tToday('noLeadName')}
                        {name.secondary && (
                          <span className="ml-1 text-gray-600 dark:text-gray-300">
                            {name.secondary}
                          </span>
                        )}
                      </span>
                    </Link>
                    <ContactDetails event={event} />
                    {event.note && (
                      <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm text-gray-700 dark:text-gray-300">
                        {event.note}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          {expanded && data.total > data.items.length && (
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {t('more', { shown: data.items.length, total: data.total })}
            </p>
          )}
          {folds && (
            <div className="flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  'h-auto px-1 py-0.5 text-sm text-gray-600 dark:text-gray-300',
                  TAP_TARGET
                )}
                aria-expanded={expanded}
                aria-controls={listId}
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded ? t('showLess') : t('showAll', { count: data.items.length })}
                {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
              </Button>
            </div>
          )}
        </div>
      )}
    </TodaySection>
  );
}
