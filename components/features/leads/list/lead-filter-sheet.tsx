'use client';

/**
 * Lead list filters on small screens (#131): a "Filters" button that opens a Sheet with the
 * controls stacked at full width. Changes apply right away (the list behind updates); the
 * footer has "Clear all" and "Show N leads" to close.
 */
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import type { LeadListFilters } from '@/lib/features/leads/list-query';
import { cn } from '@/lib/utils';
import { SlidersHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { LeadFilterControls } from './lead-filter-controls';

export interface LeadFilterSheetProps {
  filters: LeadListFilters;
  onChange: (patch: Partial<LeadListFilters>) => void;
  onClearAll: () => void;
  /** Number of active conditions, shown on the button */
  activeCount: number;
  /** Matching leads (undefined while loading) */
  total?: number;
  className?: string;
}

export function LeadFilterSheet({
  filters,
  onChange,
  onClearAll,
  activeCount,
  total,
  className,
}: LeadFilterSheetProps) {
  const t = useTranslations('leadList');
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" variant="outline" className={cn('h-11 gap-2', className)}>
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          {t('filters')}
          {activeCount > 0 && (
            <span className="rounded-full bg-brand-500 px-1.5 text-xs font-semibold leading-5 text-white">
              {activeCount}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-sm">
        <SheetHeader>
          <SheetTitle>{t('filters')}</SheetTitle>
          <SheetDescription>{t('filtersDescription')}</SheetDescription>
        </SheetHeader>
        <LeadFilterControls
          filters={filters}
          onChange={onChange}
          layout="stacked"
          className="flex-1 py-4"
        />
        <SheetFooter className="flex-row justify-between gap-2 sm:justify-between">
          <Button type="button" variant="ghost" className="h-11" onClick={onClearAll}>
            {t('chips.clearAll')}
          </Button>
          <Button type="button" className="h-11" onClick={() => setOpen(false)}>
            {total === undefined ? t('filters') : t('showResults', { count: total })}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
