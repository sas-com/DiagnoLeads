'use client';

/**
 * Sortable column header of the lead list (#131). The header button shows the current order
 * (arrow up / down, or a neutral icon), and clicking it asks for the next order: the same
 * column flips, another column starts in its natural order (see nextSort in list-query).
 *
 * Put `aria-sort={ariaSortFor(sort, column)}` on the <th> that contains it.
 */
import type { LeadListSort } from '@/lib/features/leads/list-query';
import type { LeadSortKey } from '@/lib/features/leads/types/schemas';
import { cn } from '@/lib/utils';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useTranslations } from 'next-intl';

export function ariaSortFor(
  sort: LeadListSort,
  column: LeadSortKey
): 'ascending' | 'descending' | 'none' {
  if (sort.by !== column) return 'none';
  return sort.order === 'asc' ? 'ascending' : 'descending';
}

export interface SortableHeaderProps {
  label: string;
  column: LeadSortKey;
  sort: LeadListSort;
  onSort: (column: LeadSortKey) => void;
  className?: string;
}

export function SortableHeader({ label, column, sort, onSort, className }: SortableHeaderProps) {
  const t = useTranslations('leadList');
  const state = ariaSortFor(sort, column);
  const Icon = state === 'ascending' ? ArrowUp : state === 'descending' ? ArrowDown : ArrowUpDown;
  const description =
    state === 'none'
      ? t('sort.sortBy', { column: label })
      : t('sort.current', {
          column: label,
          order: state === 'ascending' ? t('sort.ascending') : t('sort.descending'),
        });

  return (
    <button
      type="button"
      onClick={() => onSort(column)}
      title={description}
      className={cn(
        '-ml-2 inline-flex h-8 items-center gap-1 rounded-md px-2 font-medium hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:hover:bg-gray-700',
        state !== 'none' && 'text-gray-900 dark:text-gray-100',
        className
      )}
    >
      {label}
      <Icon
        className={cn('h-3.5 w-3.5', state === 'none' ? 'opacity-40' : 'opacity-100')}
        aria-hidden="true"
      />
      <span className="sr-only">{description}</span>
    </button>
  );
}
