'use client';

import { cn } from '@/lib/utils';
import { AlertTriangle, ListX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { DealMarkFlags } from './deal-format';

/**
 * What a deal is marked for (Refs #436, #720): a passed close date and a lead without a next
 * action, each with an icon and its words, never a colour alone (WCAG 1.4.1). The board's cards
 * and the list's rows show the same marks.
 */
export function DealMarks({ flags, className }: { flags: DealMarkFlags; className?: string }) {
  const t = useTranslations('deals.card');
  if (!flags.overdue && !flags.noNextAction) return null;
  return (
    <ul className={cn('space-y-0.5 text-sm', className)}>
      {flags.overdue && (
        <li className="flex items-center gap-1 text-red-700 dark:text-red-400">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {t('overdue')}
        </li>
      )}
      {flags.noNextAction && (
        <li className="flex items-center gap-1 text-amber-800 dark:text-amber-400">
          <ListX className="h-4 w-4 shrink-0" aria-hidden="true" />
          {t('noNextAction')}
        </li>
      )}
    </ul>
  );
}
