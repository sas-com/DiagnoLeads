'use client';

/**
 * Toolbar of the lead list (#131):
 *   row 1: search box | filter buttons (md and up) or the "Filters" Sheet button (below md) | actions slot
 *   row 2: quick filters (よく使う絞り込み) | result count
 *   row 3: active filter chips
 *
 * It only talks to the controller from useLeadListQuery, so every change goes to the URL.
 */
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { LeadListQueryController } from '@/hooks/use-lead-list-query';
import { LEAD_LIST_PRESETS } from '@/lib/features/leads/list-query';
import { cn } from '@/lib/utils';
import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId } from 'react';
import { LeadFilterChips } from './lead-filter-chips';
import { LeadFilterControls } from './lead-filter-controls';
import { LeadFilterSheet } from './lead-filter-sheet';

export interface LeadFilterToolbarProps {
  controller: LeadListQueryController;
  /** Matching leads from `leads.list` (undefined while loading) */
  total?: number;
  /** Extra buttons on the right of the first row (columns, export...) */
  actions?: ReactNode;
  className?: string;
}

export function LeadFilterToolbar({
  controller,
  total,
  actions,
  className,
}: LeadFilterToolbarProps) {
  const t = useTranslations('leadList');
  const searchId = useId();
  const { filters, chips } = controller;
  // The search has its own box, so it is not counted on the filter button
  const filterCount = chips.filter((chip) => chip.kind !== 'search').length;

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <label htmlFor={searchId} className="sr-only">
            {t('searchLabel')}
          </label>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
            aria-hidden="true"
          />
          <Input
            id={searchId}
            type="search"
            value={controller.searchText}
            placeholder={t('searchPlaceholder')}
            onChange={(event) => controller.setSearchText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                controller.flushSearch();
              }
            }}
            className="h-11 pl-9 sm:h-9"
            autoComplete="off"
          />
        </div>
        <LeadFilterControls
          filters={filters}
          onChange={controller.updateFilters}
          className="hidden md:flex"
        />
        <LeadFilterSheet
          filters={filters}
          onChange={controller.updateFilters}
          onClearAll={controller.clearFilters}
          activeCount={filterCount}
          total={total}
          className="md:hidden"
        />
        {/* Below md the actions (sort, export) get a row of their own (#110) */}
        {actions && (
          <div className="flex w-full items-center gap-2 md:ml-auto md:w-auto">{actions}</div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <fieldset
          aria-label={t('presetsLabel')}
          className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0"
        >
          {LEAD_LIST_PRESETS.map((preset) => {
            const active = controller.activePreset === preset;
            return (
              <Button
                key={preset}
                type="button"
                size="sm"
                variant={active ? 'default' : 'secondary'}
                aria-pressed={active}
                title={t(`presetHints.${preset}`)}
                className="h-9 rounded-full"
                onClick={() =>
                  active ? controller.clearFilters() : controller.applyPreset(preset)
                }
              >
                {t(`presets.${preset}`)}
              </Button>
            );
          })}
        </fieldset>
        <p className="text-sm text-gray-600 dark:text-gray-300" aria-live="polite">
          {total === undefined ? (
            <span className="sr-only">{t('resultCountLoading')}</span>
          ) : (
            t('resultCount', { count: total })
          )}
        </p>
      </div>

      <LeadFilterChips
        chips={chips}
        onRemove={controller.removeChip}
        onClearAll={controller.clearFilters}
      />
    </div>
  );
}
