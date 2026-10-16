'use client';

/**
 * Active filters of the lead list as chips (#131): each one can be removed on its own, and
 * "Clear all" removes every filter (the sort is kept).
 */
import { Button } from '@/components/ui/button';
import { type LeadFilterChip, chipKey } from '@/lib/features/leads/list-query';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { useAssigneeChipLabel } from './assignee-filter';

/** 'YYYY-MM-DD' -> 'YYYY/MM/DD' */
export const formatDay = (day: string) => day.replaceAll('-', '/');

/** Text of a chip, e.g. "Status: New", "Score 40-80" */
export function useFilterChipLabel(): (chip: LeadFilterChip) => string {
  const t = useTranslations('leadList');
  const tStatus = useTranslations('status');
  const tPipeline = useTranslations('pipeline');
  const assigneeLabel = useAssigneeChipLabel();

  return useCallback(
    (chip: LeadFilterChip) => {
      switch (chip.kind) {
        case 'search':
          return t('chips.search', { text: chip.value });
        case 'status':
          return t('chips.value', { field: t('status'), value: tStatus(chip.value) });
        case 'dealPhase':
          return t('chips.value', {
            field: t('dealPhase'),
            value: tPipeline(`dealPhase.${chip.value}`),
          });
        case 'inflowSource':
          return t('chips.value', {
            field: t('inflowSource'),
            value: tPipeline(`inflowSource.${chip.value}`),
          });
        case 'targetSystem':
          return t('chips.value', {
            field: t('targetSystem'),
            value: tPipeline(`targetSystem.${chip.value}`),
          });
        case 'score':
          if (chip.min !== undefined && chip.max !== undefined) {
            return t('chips.scoreBetween', { min: chip.min, max: chip.max });
          }
          return chip.min !== undefined
            ? t('chips.scoreAtLeast', { min: chip.min })
            : t('chips.scoreAtMost', { max: chip.max ?? 100 });
        case 'created':
          if (chip.from && chip.to) {
            return t('chips.createdBetween', {
              from: formatDay(chip.from),
              to: formatDay(chip.to),
            });
          }
          return chip.from
            ? t('chips.createdFrom', { from: formatDay(chip.from) })
            : t('chips.createdTo', { to: formatDay(chip.to ?? '') });
        case 'consultation':
          return chip.value ? t('consultation') : t('chips.noConsultation');
        case 'mql':
          return chip.value ? t('mql') : t('chips.notMql');
        case 'sql':
          if (chip.value === 'qualified') return t('sqlQualified');
          return chip.value === 'not_qualified'
            ? t('chips.sqlNotQualified')
            : t('chips.sqlUndecided');
        case 'assignee':
          return assigneeLabel(chip);
        case 'nextMeeting':
          return t(`nextMeetingOptions.${chip.value}`);
        case 'dealRating':
          return t('chips.value', {
            field: t('dealRating'),
            value: chip.value.toUpperCase(),
          });
      }
    },
    [t, tStatus, tPipeline, assigneeLabel]
  );
}

export interface LeadFilterChipsProps {
  chips: LeadFilterChip[];
  onRemove: (chip: LeadFilterChip) => void;
  onClearAll: () => void;
  className?: string;
}

export function LeadFilterChips({ chips, onRemove, onClearAll, className }: LeadFilterChipsProps) {
  const t = useTranslations('leadList');
  const labelOf = useFilterChipLabel();
  if (chips.length === 0) return null;

  return (
    <fieldset
      aria-label={t('chips.label')}
      className={cn('m-0 flex min-w-0 flex-wrap items-center gap-2 border-0 p-0', className)}
    >
      {chips.map((chip) => {
        const label = labelOf(chip);
        return (
          <span
            key={chipKey(chip)}
            className="inline-flex max-w-full items-center gap-1 rounded-full border border-brand-200 bg-brand-50 py-0.5 pl-3 pr-1 text-sm text-brand-800 dark:border-brand-800 dark:bg-brand-900/30 dark:text-brand-200"
          >
            <span className="truncate">{label}</span>
            <button
              type="button"
              onClick={() => onRemove(chip)}
              aria-label={t('chips.remove', { label })}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full hover:bg-brand-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:hover:bg-brand-800/50"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </span>
        );
      })}
      <Button type="button" variant="ghost" size="sm" className="h-8" onClick={onClearAll}>
        {t('chips.clearAll')}
      </Button>
    </fieldset>
  );
}
