'use client';

/**
 * Next meeting date and deal rating of a lead's latest hearing (#137), shown in the lead list
 * and on the lead page. A passed date (no newer hearing) gets an "overdue" badge.
 */
import { Badge } from '@/components/ui/badge';
import { isNextMeetingOverdue } from '@/lib/features/leads/list-query';
import { cn } from '@/lib/utils';
import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';

/** 'YYYY-MM-DD' -> 'YYYY/MM/DD' */
const slashDay = (day: string) => day.replaceAll('-', '/');

const DEAL_RATING_COLORS = { a: 'emerald', b: 'blue', c: 'gray' } as const;

/** Red badge for a next meeting date that has passed */
export function NextMeetingOverdueBadge({
  date,
  label,
  className,
}: {
  date: string;
  /** Text of the badge (default: 日程超過) */
  label?: string;
  className?: string;
}) {
  const t = useTranslations('leadList');
  return (
    <Badge
      variant="outline"
      title={t('overdueTitle', { date: slashDay(date) })}
      data-testid="next-meeting-overdue"
      className={cn(
        'gap-1 whitespace-nowrap border-transparent bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300',
        className
      )}
    >
      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
      {label ?? t('overdue')}
    </Badge>
  );
}

/** List cell: the date, with the overdue badge when it has passed on an open lead */
export function NextMeetingCell({
  date,
  status,
  now,
  className,
}: {
  date: string | null | undefined;
  status?: string | null;
  now?: Date;
  className?: string;
}) {
  if (!date) return <span className="text-gray-400">-</span>;
  const overdue = isNextMeetingOverdue({ nextMeetingDate: date, status }, now);
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span
        className={cn(
          'text-sm tabular-nums',
          overdue
            ? 'font-semibold text-rose-700 dark:text-rose-300'
            : 'text-gray-700 dark:text-gray-200'
        )}
      >
        {slashDay(date)}
      </span>
      {overdue && <NextMeetingOverdueBadge date={date} />}
    </span>
  );
}

export function DealRatingBadge({
  rating,
  className,
}: {
  rating: string | null | undefined;
  /** e.g. text-sm where no text may be under 14px (今日, #556) */
  className?: string;
}) {
  const t = useTranslations('leadList');
  if (!rating) return <span className="text-gray-400">-</span>;
  const color = DEAL_RATING_COLORS[rating as keyof typeof DEAL_RATING_COLORS] ?? 'gray';
  return (
    <Badge color={color} className={className}>
      {t('ratingOption', { rating: rating.toUpperCase() })}
    </Badge>
  );
}
