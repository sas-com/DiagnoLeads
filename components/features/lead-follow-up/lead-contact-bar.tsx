'use client';

import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { PhoneCall } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { ContactQuickActions } from './contact-quick-actions';

const TIME_ZONE = 'Asia/Tokyo';

interface LeadContactBarProps {
  organizationId: string;
  leadId: string;
  leadLabel: string;
}

/**
 * Under the lead page header (Refs #136): when the lead was first contacted (or that nobody
 * has yet), the latest contact (with its duration and outcome, #554), and the one-tap buttons
 * and "record an activity" for staff who can edit leads.
 */
export function LeadContactBar({ organizationId, leadId, leadLabel }: LeadContactBarProps) {
  const t = useTranslations('leadFollowUp.contact');
  const tFollowUp = useTranslations('leadFollowUp');
  const format = useFormatter();
  const query = trpc.leadFollowUp.contacts.useQuery(
    { organizationId, leadId },
    { enabled: !!organizationId }
  );
  const data = query.data;
  const when = (value: Date | string) =>
    format.dateTime(new Date(value), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: TIME_ZONE,
    });
  const latest = data?.recent[0];

  return (
    <section
      aria-label={t('label')}
      className="flex flex-col gap-3 rounded-lg border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 items-start gap-2 text-sm">
        <PhoneCall className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        {query.isError ? (
          <p className="text-red-600 dark:text-red-400">{t('loadError')}</p>
        ) : !data ? (
          <p className="text-muted-foreground">{t('loading')}</p>
        ) : (
          <div className="min-w-0 space-y-0.5">
            <p
              className={cn(
                'font-medium',
                data.firstContactAt ? 'text-foreground' : 'text-amber-700 dark:text-amber-400'
              )}
              data-testid="first-contact"
            >
              {data.firstContactAt
                ? t('firstContact', { date: when(data.firstContactAt) })
                : t('notContacted')}
              {data.noAnswerCount > 0 && (
                <span className="ml-2 whitespace-nowrap rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                  {t('noAnswerCount', { count: data.noAnswerCount })}
                </span>
              )}
            </p>
            {latest && (
              <p className="truncate text-xs text-muted-foreground">
                {t('latest', {
                  kind: t(`kinds.${latest.kind}`),
                  date: when(latest.contactedAt),
                  count: data.total,
                })}
                {latest.durationMinutes !== null &&
                  ` · ${tFollowUp('durationMinutes', { minutes: latest.durationMinutes })}`}
                {latest.outcome && ` · ${tFollowUp(`outcomes.${latest.outcome}`)}`}
                {latest.createdBy && ` · ${latest.createdBy.name}`}
                {latest.note && ` · ${latest.note}`}
              </p>
            )}
          </div>
        )}
      </div>
      {data?.canEdit && (
        <ContactQuickActions
          organizationId={organizationId}
          leadId={leadId}
          leadLabel={leadLabel}
          className="shrink-0"
        />
      )}
    </section>
  );
}
