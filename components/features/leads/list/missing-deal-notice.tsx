'use client';

/**
 * 商談の記録がないリード (#854) above the lead list: leads in a deal by hand (商談中 or 成約, or
 * 新規 with a deal phase) that have no deal, so the forecast and the board miss them. One link to
 * the list filtered to them (missingDeal). Nothing while there are none, and nothing for those
 * who may not read deals, for whom leads.statusCounts gives null.
 */
import { cn } from '@/lib/utils';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

export interface MissingDealNoticeProps {
  /** missingDeal of leads.statusCounts: null when deals may not be read, undefined while loading */
  count: number | null | undefined;
  /** The list filtered to these leads */
  href: string;
  className?: string;
}

export function MissingDealNotice({ count, href, className }: MissingDealNoticeProps) {
  const t = useTranslations('leads.missingDeal');
  if (!count) return null;

  return (
    <Link
      href={href}
      className={cn(
        'flex min-h-11 items-start gap-3 rounded-lg border border-gray-400 bg-white px-4 py-3 text-gray-900 transition-colors hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-50 dark:hover:bg-gray-800',
        className
      )}
    >
      <AlertTriangle
        className="mt-0.5 h-5 w-5 shrink-0 text-gray-700 dark:text-gray-200"
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">
        <span className="block font-bold tabular-nums">{t('title', { count })}</span>
        <span className="mt-1 block text-sm leading-normal text-gray-700 dark:text-gray-200">
          {t('description')}
        </span>
      </span>
      <ChevronRight
        className="mt-0.5 h-5 w-5 shrink-0 text-gray-700 dark:text-gray-200"
        aria-hidden="true"
      />
    </Link>
  );
}
