'use client';

/**
 * Assignee filter of the lead list (#135): everyone, me, unassigned (担当未定) or one member.
 */
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useCurrentLeadAssignees } from '@/hooks/use-lead-assignee';
import type { LeadFilterChip } from '@/lib/features/leads/list-query';
import type { AssigneeFilter } from '@/lib/features/leads/types/schemas';
import { cn } from '@/lib/utils';
import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

const ALL = '__all__';

/** Text of an assignee filter value ("自分", "担当未定" or the member's name) */
export function useAssigneeFilterLabel(): (value: AssigneeFilter) => string {
  const t = useTranslations('leadAssignee');
  const members = useCurrentLeadAssignees();
  return useCallback(
    (value: AssigneeFilter) => {
      if (value === 'me') return t('me');
      if (value === 'unassigned') return t('unassigned');
      return members.data?.find((m) => m.userId === value)?.displayName ?? t('someone');
    },
    [t, members.data]
  );
}

/** Chip text of the assignee filter */
export function useAssigneeChipLabel(): (
  chip: Extract<LeadFilterChip, { kind: 'assignee' }>
) => string {
  const t = useTranslations('leadAssignee');
  const valueLabel = useAssigneeFilterLabel();
  return useCallback(
    (chip) =>
      chip.value === 'unassigned' ? t('unassigned') : t('chip', { name: valueLabel(chip.value) }),
    [t, valueLabel]
  );
}

export interface AssigneeFilterControlProps {
  value?: AssigneeFilter;
  onChange: (value: AssigneeFilter | undefined) => void;
  layout?: 'inline' | 'stacked';
}

export function AssigneeFilterControl({
  value,
  onChange,
  layout = 'inline',
}: AssigneeFilterControlProps) {
  const t = useTranslations('leadAssignee');
  const members = useCurrentLeadAssignees();
  const valueLabel = useAssigneeFilterLabel();
  const active = value !== undefined;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            'gap-1.5',
            layout === 'inline' ? 'h-9' : 'h-11 w-full justify-between',
            active && 'border-brand-400 bg-brand-50 dark:border-brand-600 dark:bg-brand-900/30'
          )}
          aria-label={value !== undefined ? `${t('label')} (${valueLabel(value)})` : t('label')}
        >
          <span className="max-w-[10rem] truncate">
            {value !== undefined ? `${t('label')}: ${valueLabel(value)}` : t('label')}
          </span>
          <ChevronDown className="h-4 w-4 opacity-60" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-64 overflow-y-auto">
        <DropdownMenuLabel>{t('label')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={value ?? ALL}
          onValueChange={(next) => onChange(next === ALL ? undefined : (next as AssigneeFilter))}
        >
          <DropdownMenuRadioItem value={ALL}>{t('filterAll')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="me">{t('me')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="unassigned">{t('unassigned')}</DropdownMenuRadioItem>
          {(members.data ?? []).length > 0 && <DropdownMenuSeparator />}
          {(members.data ?? []).map((member) => (
            <DropdownMenuRadioItem key={member.userId} value={member.userId}>
              {member.displayName}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
