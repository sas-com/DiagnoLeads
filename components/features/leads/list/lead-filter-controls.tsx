'use client';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
/**
 * Filter controls of the lead list (#131), shared by the desktop toolbar (a row of buttons)
 * and the mobile Sheet (stacked, full width):
 * - status / deal phase / inflow source / target system: multi-select (DropdownMenu checkboxes)
 * - created date range: Popover with the shadcn Calendar in range mode (Japan days)
 * - more conditions: consultation requested, MQL, SQL (qualified)
 * - next meeting (single choice) and deal rating (multi-select) of the latest hearing (#137)
 */
import { ACT_TIMING_FILTERS, type ActTimingFilter } from '@/lib/features/act-timing/types/schemas';
import type { LeadListFilters } from '@/lib/features/leads/list-query';
import {
  DEAL_PHASES,
  INFLOW_SOURCES,
  LEAD_STATUSES,
  TARGET_SYSTEMS,
} from '@/lib/features/leads/types/pipeline';
import {
  DEAL_RATINGS,
  NEXT_MEETING_FILTERS,
  type NextMeetingFilter,
} from '@/lib/features/leads/types/schemas';
import { cn } from '@/lib/utils';
import { format as formatDate } from 'date-fns';
import { enUS, ja } from 'date-fns/locale';
import { CalendarDays, ChevronDown } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { AssigneeFilterControl } from './assignee-filter';
import { formatDay } from './lead-filter-chips';

export type FilterLayout = 'inline' | 'stacked';

const triggerClass = (layout: FilterLayout, active: boolean) =>
  cn(
    'gap-1.5',
    layout === 'inline' ? 'h-9' : 'h-11 w-full justify-between',
    active && 'border-brand-400 bg-brand-50 dark:border-brand-600 dark:bg-brand-900/30'
  );

function CountBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="rounded-full bg-brand-500 px-1.5 text-xs font-semibold leading-5 text-white">
      {count}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Multi-select
// ---------------------------------------------------------------------------

export interface MultiSelectFilterProps<T extends string> {
  label: string;
  options: readonly T[];
  optionLabel: (value: T) => string;
  selected: readonly T[];
  onChange: (next: T[]) => void;
  layout?: FilterLayout;
}

export function MultiSelectFilter<T extends string>({
  label,
  options,
  optionLabel,
  selected,
  onChange,
  layout = 'inline',
}: MultiSelectFilterProps<T>) {
  const t = useTranslations('leadList');
  const toggle = (value: T, checked: boolean) => {
    const set = new Set(selected);
    if (checked) set.add(value);
    else set.delete(value);
    // Keep the definition order, so equal selections give equal URLs
    onChange(options.filter((option) => set.has(option)));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={triggerClass(layout, selected.length > 0)}
          aria-label={
            selected.length > 0
              ? `${label} (${t('selectedCount', { count: selected.length })})`
              : label
          }
        >
          <span>{label}</span>
          <span className="flex items-center gap-1">
            <CountBadge count={selected.length} />
            <ChevronDown className="h-4 w-4 opacity-60" aria-hidden="true" />
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-64 overflow-y-auto">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option}
            checked={selected.includes(option)}
            onCheckedChange={(checked) => toggle(option, checked === true)}
            // Keep the menu open to pick several values
            onSelect={(event) => event.preventDefault()}
          >
            {optionLabel(option)}
          </DropdownMenuCheckboxItem>
        ))}
        {selected.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange([])}>{t('clear')}</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------
// Created date range
// ---------------------------------------------------------------------------

/** 'YYYY-MM-DD' -> a local Date on that calendar day (what the Calendar shows) */
export function dayToDate(day: string | undefined): Date | undefined {
  if (!day) return undefined;
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Calendar day of a local Date -> 'YYYY-MM-DD' */
export function dateToDay(date: Date): string {
  return formatDate(date, 'yyyy-MM-dd');
}

export interface CreatedRangeFilterProps {
  from?: string;
  to?: string;
  onChange: (range: { createdFrom?: string; createdTo?: string }) => void;
  layout?: FilterLayout;
}

export function CreatedRangeFilter({
  from,
  to,
  onChange,
  layout = 'inline',
}: CreatedRangeFilterProps) {
  const t = useTranslations('leadList');
  const locale = useLocale();
  const dateLocale = locale === 'ja' ? ja : enUS;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>();
  const active = Boolean(from || to);

  const openChange = (next: boolean) => {
    if (next) setDraft(from || to ? { from: dayToDate(from), to: dayToDate(to) } : undefined);
    setOpen(next);
  };
  const apply = () => {
    const start = draft?.from ? dateToDay(draft.from) : undefined;
    // One day picked: that day only
    const end = draft?.to ? dateToDay(draft.to) : start;
    onChange({ createdFrom: start, createdTo: end });
    setOpen(false);
  };

  const summary =
    from && to
      ? `${formatDay(from)}–${formatDay(to)}`
      : from
        ? `${formatDay(from)}–`
        : to
          ? `–${formatDay(to)}`
          : '';

  return (
    <Popover open={open} onOpenChange={openChange}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className={triggerClass(layout, active)}>
          <span className="flex items-center gap-1.5">
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
            {t('createdAt')}
          </span>
          {active && <span className="text-xs text-gray-600 dark:text-gray-300">{summary}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="range"
          selected={draft}
          onSelect={setDraft}
          defaultMonth={draft?.from}
          locale={dateLocale}
          formatters={{
            formatCaption: (month) =>
              formatDate(month, locale === 'ja' ? 'yyyy年M月' : 'MMMM yyyy', {
                locale: dateLocale,
              }),
          }}
          initialFocus
        />
        <p className="px-3 text-xs text-gray-500 dark:text-gray-400">{t('createdHint')}</p>
        <div className="flex justify-between gap-2 p-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange({ createdFrom: undefined, createdTo: undefined });
              setOpen(false);
            }}
          >
            {t('clear')}
          </Button>
          <Button type="button" size="sm" onClick={apply} disabled={!draft?.from}>
            {t('apply')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// More conditions
// ---------------------------------------------------------------------------

export interface MoreConditionsFilterProps {
  filters: Pick<LeadListFilters, 'consultation' | 'mql' | 'sql'>;
  onChange: (patch: Pick<LeadListFilters, 'consultation' | 'mql' | 'sql'>) => void;
  layout?: FilterLayout;
}

export function MoreConditionsFilter({
  filters,
  onChange,
  layout = 'inline',
}: MoreConditionsFilterProps) {
  const t = useTranslations('leadList');
  const count =
    (filters.consultation !== undefined ? 1 : 0) +
    (filters.mql !== undefined ? 1 : 0) +
    (filters.sql !== undefined ? 1 : 0);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={triggerClass(layout, count > 0)}
        >
          <span>{t('more')}</span>
          <span className="flex items-center gap-1">
            <CountBadge count={count} />
            <ChevronDown className="h-4 w-4 opacity-60" aria-hidden="true" />
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuCheckboxItem
          checked={filters.consultation === true}
          onCheckedChange={(checked) =>
            onChange({ consultation: checked === true ? true : undefined })
          }
          onSelect={(event) => event.preventDefault()}
        >
          {t('consultation')}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={filters.mql === true}
          onCheckedChange={(checked) => onChange({ mql: checked === true ? true : undefined })}
          onSelect={(event) => event.preventDefault()}
        >
          {t('mql')}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={filters.sql === 'qualified'}
          onCheckedChange={(checked) =>
            onChange({ sql: checked === true ? 'qualified' : undefined })
          }
          onSelect={(event) => event.preventDefault()}
        >
          {t('sqlQualified')}
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------
// Next meeting (#137)
// ---------------------------------------------------------------------------

export interface NextMeetingFilterProps {
  value?: NextMeetingFilter;
  onChange: (value: NextMeetingFilter | undefined) => void;
  layout?: FilterLayout;
}

export function NextMeetingFilterControl({
  value,
  onChange,
  layout = 'inline',
}: NextMeetingFilterProps) {
  const t = useTranslations('leadList');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={triggerClass(layout, value !== undefined)}
        >
          <span>{t('nextMeeting')}</span>
          <span className="flex items-center gap-1">
            {value && (
              <span className="text-xs text-gray-600 dark:text-gray-300">
                {t(`nextMeetingOptions.${value}`)}
              </span>
            )}
            <ChevronDown className="h-4 w-4 opacity-60" aria-hidden="true" />
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>{t('nextMeeting')}</DropdownMenuLabel>
        <p className="px-2 pb-1 text-xs text-gray-500 dark:text-gray-400">{t('nextMeetingHint')}</p>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={value ?? ''}
          onValueChange={(next) =>
            onChange(
              (NEXT_MEETING_FILTERS as readonly string[]).includes(next)
                ? (next as NextMeetingFilter)
                : undefined
            )
          }
        >
          {NEXT_MEETING_FILTERS.map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              {t(`nextMeetingOptions.${option}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {value && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange(undefined)}>{t('clear')}</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------
// When to act (#151)
// ---------------------------------------------------------------------------

export interface ActTimingFilterProps {
  value?: ActTimingFilter;
  onChange: (value: ActTimingFilter | undefined) => void;
  layout?: FilterLayout;
}

export function ActTimingFilterControl({
  value,
  onChange,
  layout = 'inline',
}: ActTimingFilterProps) {
  const t = useTranslations('leadList');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={triggerClass(layout, value !== undefined)}
        >
          <span>{t('actTiming')}</span>
          <span className="flex items-center gap-1">
            {value && (
              <span className="text-xs text-gray-600 dark:text-gray-300">
                {t(`actTimingOptions.${value}`)}
              </span>
            )}
            <ChevronDown className="h-4 w-4 opacity-60" aria-hidden="true" />
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>{t('actTiming')}</DropdownMenuLabel>
        <p className="px-2 pb-1 text-xs text-gray-500 dark:text-gray-400">{t('actTimingHint')}</p>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={value ?? ''}
          onValueChange={(next) =>
            onChange(
              (ACT_TIMING_FILTERS as readonly string[]).includes(next)
                ? (next as ActTimingFilter)
                : undefined
            )
          }
        >
          {ACT_TIMING_FILTERS.map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              {t(`actTimingOptions.${option}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {value && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange(undefined)}>{t('clear')}</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------
// All controls
// ---------------------------------------------------------------------------

export interface LeadFilterControlsProps {
  filters: LeadListFilters;
  onChange: (patch: Partial<LeadListFilters>) => void;
  layout?: FilterLayout;
  className?: string;
}

export function LeadFilterControls({
  filters,
  onChange,
  layout = 'inline',
  className,
}: LeadFilterControlsProps) {
  const t = useTranslations('leadList');
  const tStatus = useTranslations('status');
  const tPipeline = useTranslations('pipeline');

  return (
    <div
      className={cn(
        layout === 'inline'
          ? 'flex flex-wrap items-center gap-2'
          : 'grid grid-cols-1 content-start gap-3',
        className
      )}
    >
      <MultiSelectFilter
        label={t('status')}
        options={LEAD_STATUSES}
        optionLabel={(v) => tStatus(v)}
        selected={filters.status}
        onChange={(status) => onChange({ status })}
        layout={layout}
      />
      <MultiSelectFilter
        label={t('dealPhase')}
        options={DEAL_PHASES}
        optionLabel={(v) => tPipeline(`dealPhase.${v}`)}
        selected={filters.dealPhase}
        onChange={(dealPhase) => onChange({ dealPhase })}
        layout={layout}
      />
      <MultiSelectFilter
        label={t('inflowSource')}
        options={INFLOW_SOURCES}
        optionLabel={(v) => tPipeline(`inflowSource.${v}`)}
        selected={filters.inflowSource}
        onChange={(inflowSource) => onChange({ inflowSource })}
        layout={layout}
      />
      <MultiSelectFilter
        label={t('targetSystem')}
        options={TARGET_SYSTEMS}
        optionLabel={(v) => tPipeline(`targetSystem.${v}`)}
        selected={filters.targetSystem}
        onChange={(targetSystem) => onChange({ targetSystem })}
        layout={layout}
      />
      <CreatedRangeFilter
        from={filters.createdFrom}
        to={filters.createdTo}
        onChange={onChange}
        layout={layout}
      />
      <AssigneeFilterControl
        value={filters.assignee}
        onChange={(assignee) => onChange({ assignee })}
        layout={layout}
      />
      <NextMeetingFilterControl
        value={filters.nextMeeting}
        onChange={(nextMeeting) => onChange({ nextMeeting })}
        layout={layout}
      />
      <ActTimingFilterControl
        value={filters.actTiming}
        onChange={(actTiming) => onChange({ actTiming })}
        layout={layout}
      />
      <MultiSelectFilter
        label={t('dealRating')}
        options={DEAL_RATINGS}
        optionLabel={(v) => t('ratingOption', { rating: v.toUpperCase() })}
        selected={filters.dealRating ?? []}
        onChange={(dealRating) => onChange({ dealRating })}
        layout={layout}
      />
      <MoreConditionsFilter filters={filters} onChange={onChange} layout={layout} />
    </div>
  );
}
