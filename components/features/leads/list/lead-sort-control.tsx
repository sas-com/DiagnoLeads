'use client';

/**
 * Sort of the lead list where there are no column headers (the cards on a phone, #110):
 * a select for the column and a button that flips the order. Both go through onSort, like
 * the headers: another column starts in its natural order, the same column flips.
 */
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { LeadListSort } from '@/lib/features/leads/list-query';
import type { LeadSortKey } from '@/lib/features/leads/types/schemas';
import { cn } from '@/lib/utils';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useTranslations } from 'next-intl';

/** Columns offered, in the order of the menu */
export const MOBILE_SORT_KEYS = [
  'createdAt',
  'lastActivityAt',
  'nextMeetingDate',
  'actBy',
  'score',
  'company',
  'name',
  'status',
  'dealPhase',
  'assignee',
  'mqlQualifiedAt',
  'dealRating',
] as const satisfies readonly LeadSortKey[];

export interface LeadSortControlProps {
  sort: LeadListSort;
  onSort: (column: LeadSortKey) => void;
  className?: string;
}

export function LeadSortControl({ sort, onSort, className }: LeadSortControlProps) {
  const t = useTranslations('leads');
  const tList = useTranslations('leadList');
  const tAssignee = useTranslations('leadAssignee');

  const labels: Record<LeadSortKey, string> = {
    createdAt: t('createdAt'),
    updatedAt: t('updatedAt'),
    name: t('name'),
    email: t('email'),
    company: t('company'),
    score: t('score'),
    status: t('status'),
    dealPhase: t('dealPhase'),
    lastActivityAt: tList('sort.lastActivityAt'),
    mqlQualifiedAt: t('mqlQualifiedAt'),
    assignee: tAssignee('label'),
    nextMeetingDate: tList('nextMeeting'),
    dealRating: tList('dealRating'),
    actBy: tList('actBy'),
  };
  // A sort from a link (email, updated) stays selectable
  const keys: readonly LeadSortKey[] = (MOBILE_SORT_KEYS as readonly LeadSortKey[]).includes(
    sort.by
  )
    ? MOBILE_SORT_KEYS
    : [...MOBILE_SORT_KEYS, sort.by];
  const order = sort.order === 'asc' ? tList('sort.ascending') : tList('sort.descending');
  const OrderIcon = sort.order === 'asc' ? ArrowUp : ArrowDown;

  return (
    <div className={cn('flex min-w-0 items-center gap-1', className)}>
      <Select
        value={sort.by}
        onValueChange={(value) => {
          if (value !== sort.by) onSort(value as LeadSortKey);
        }}
      >
        <SelectTrigger
          aria-label={tList('cards.sortBy', { column: labels[sort.by] })}
          className="h-11 min-w-0 flex-1 justify-start gap-1.5 [&>span]:truncate [&>svg:last-child]:ml-auto"
        >
          <ArrowUpDown className="h-4 w-4 shrink-0 text-gray-500" aria-hidden="true" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {keys.map((key) => (
            <SelectItem key={key} value={key}>
              {labels[key]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-11 w-11 shrink-0"
        onClick={() => onSort(sort.by)}
        aria-label={tList('cards.flipOrder', { order })}
        title={tList('cards.flipOrder', { order })}
      >
        <OrderIcon className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
