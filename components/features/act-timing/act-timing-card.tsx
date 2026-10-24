'use client';

import { InlineLoadError } from '@/components/common/inline-load-error';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { trpc } from '@/lib/trpc/client';
import { CalendarRange, Loader2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

interface ActTimingCardProps {
  organizationId: string;
  leadId: string;
}

/**
 * "When to act" of a lead (Refs #151): the month to start talking again, how it was worked out
 * (deadline, migration months, budget planning) and when the assignee is told. Shown only when
 * the dates to work it out are known.
 */
export function ActTimingCard({ organizationId, leadId }: ActTimingCardProps) {
  const t = useTranslations('actTiming');
  const format = useFormatter();
  const query = trpc.actTiming.get.useQuery(
    { organizationId, leadId },
    { enabled: !!organizationId, retry: false }
  );
  // A failed request shows an error in the card (#431); only "not allowed" hides it
  if (query.error?.data?.code === 'FORBIDDEN') return null;
  const data = query.data;
  if (data && !data.timing) return null;

  const month = (value: string) =>
    format.dateTime(new Date(`${value}-01T00:00:00Z`), {
      year: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    });
  const day = (value: string) =>
    format.dateTime(new Date(`${value}T00:00:00Z`), { dateStyle: 'medium', timeZone: 'UTC' });

  return (
    <Card className="p-5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <CalendarRange className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
        {data?.timing && !data.followed && <Badge color="gray">{t('notFollowed')}</Badge>}
      </div>
      {!data && query.isError ? (
        <InlineLoadError onRetry={() => void query.refetch()} />
      ) : !data?.timing ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
      ) : (
        <div className="space-y-2 text-sm">
          <p className="text-lg font-semibold text-foreground">{month(data.timing.actBy)}</p>
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            <li>
              {t(`deadline.${data.timing.deadline.source}`, {
                month: month(data.timing.deadline.month),
              })}
            </li>
            <li>
              {t('start', {
                months: data.settings.migrationMonths,
                month: month(data.timing.start),
              })}
            </li>
            {data.timing.budgetPlanning && (
              <li>{t('budget', { month: month(data.timing.budgetPlanning) })}</li>
            )}
          </ul>
          {data.followed && (
            <p className="text-xs text-foreground">
              {data.task
                ? data.task.done
                  ? t('taskDone')
                  : t('taskDue', { date: day(data.task.dueOn) })
                : t('notice', { date: day(data.timing.noticeOn) })}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
