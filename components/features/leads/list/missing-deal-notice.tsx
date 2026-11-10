'use client';

/**
 * 商談が未作成のリード (#854) above the lead list: leads in a deal by hand (商談中 or 成約, or
 * 新規 with a deal phase) that have no deal, so Deals and the sales forecast leave them out. The
 * box links to the list filtered to them (missingDeal); while that filter is on (active) it stays
 * as the explanation, without the link. Nothing while there are none, and nothing for those who
 * may not read deals, for whom leads.statusCounts gives null.
 */
import { cn } from '@/lib/utils';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useId } from 'react';

export interface MissingDealNoticeProps {
  /** missingDeal of leads.statusCounts: null when deals may not be read, undefined while loading */
  count: number | null | undefined;
  /** The list filtered to these leads */
  href: string;
  /** The list is filtered to these leads already: no link, the text explains the list */
  active?: boolean;
  className?: string;
}

const BOX =
  'flex items-start gap-3 rounded-lg border border-gray-400 bg-white px-4 py-3 text-gray-900 dark:bg-gray-900 dark:text-gray-50';

export function MissingDealNotice({
  count,
  href,
  active = false,
  className,
}: MissingDealNoticeProps) {
  const t = useTranslations('leads.missingDeal');
  const titleId = useId();
  const descriptionId = useId();
  const actionId = useId();
  if (!count) return null;

  const body = (
    <>
      {/* Amber, like the app's other cautions (deal-marks.tsx, the forecast, the meeting card) */}
      <AlertTriangle
        className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300"
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">
        <span id={titleId} className="block font-bold tabular-nums">
          {t('title', { count })}
        </span>
        <span
          id={descriptionId}
          className="mt-1 block text-sm leading-normal text-gray-700 dark:text-gray-200"
        >
          {t('description')}
        </span>
        {!active && (
          <span
            id={actionId}
            className="mt-2 inline-flex items-center gap-1 text-sm text-brand-700 underline underline-offset-4 dark:text-brand-300"
          >
            {t('action')}
            <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
          </span>
        )}
      </span>
    </>
  );

  if (active) return <div className={cn(BOX, className)}>{body}</div>;
  return (
    <Link
      href={href}
      // Named by the count and where it goes; the long explanation is the description
      aria-labelledby={`${titleId} ${actionId}`}
      aria-describedby={descriptionId}
      className={cn(
        BOX,
        'min-h-11 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800',
        className
      )}
    >
      {body}
    </Link>
  );
}
