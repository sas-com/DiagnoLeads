'use client';

/**
 * Date and month pickers of the hearing editor (Refs #130)
 *
 * - HearingDateInput: a text box (type the date, e.g. 2026/10/20) with a calendar button that
 *   opens a shadcn Calendar in a Popover, plus "Today" and "Clear". Stores 'YYYY-MM-DD'.
 * - HearingMonthInput: a button that opens a year switcher and a 12-month grid, plus
 *   "This month" and "Clear". Stores 'YYYY-MM'.
 */

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  formatTypedDate,
  fromIsoDate,
  parseTypedDate,
  splitYearMonth,
  toIsoDate,
} from '@/lib/features/lead-hearings/form';
import { YEAR_MONTH_PATTERN } from '@/lib/features/lead-hearings/types/schemas';
import { cn } from '@/lib/utils';
import { format as formatDate } from 'date-fns';
import { enUS, ja } from 'date-fns/locale';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useRef, useState } from 'react';

/** Years the month picker can reach (stored values are 4-digit years) */
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

interface PickerProps {
  /** id of the control the field name label points at */
  id: string;
  /** The field name, for the labels of the buttons */
  label: string;
  readOnly: boolean;
  /** Larger controls (meeting mode) */
  large?: boolean;
}

export interface HearingDateInputProps extends PickerProps {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  /** false for a date that must stay set (the meeting date): no clear button */
  clearable?: boolean;
}

export function HearingDateInput({
  id,
  label,
  value,
  onChange,
  readOnly,
  large = false,
  clearable = true,
}: HearingDateInputProps) {
  const t = useTranslations('leadHearings');
  const locale = useLocale();
  const errorId = useId();
  // What is being typed; null shows the stored value
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const shown = draft ?? (value ? formatTypedDate(value, locale) : '');
  const invalid = draft !== null && parseTypedDate(draft) === null;
  const selected = fromIsoDate(value);

  const type = (text: string) => {
    setDraft(text);
    // A complete date is taken right away, so autosave sees it without leaving the box
    const parsed = parseTypedDate(text);
    if (typeof parsed === 'string' && parsed !== value) onChange(parsed);
  };
  const commit = () => {
    if (draft === null) return;
    const parsed = parseTypedDate(draft);
    if (parsed === null) return; // keep the text and the error until it is fixed
    if (parsed === undefined) {
      if (clearable && value !== undefined) onChange(undefined);
    } else if (parsed !== value) {
      onChange(parsed);
    }
    setDraft(null);
  };
  const pick = (next: string | undefined) => {
    setDraft(null);
    if (next !== value) onChange(next);
    setOpen(false);
  };

  const size = large ? 'h-11' : 'h-11 sm:h-10';
  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <Input
          id={id}
          value={shown}
          placeholder={t('editor.datePlaceholder')}
          autoComplete="off"
          readOnly={readOnly}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          className={cn('w-full sm:w-40', size, invalid && 'border-red-500')}
          onChange={(e) => type(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape' && draft !== null) {
              setDraft(null);
            }
          }}
        />
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={readOnly}
              aria-label={t('editor.openCalendar', { field: label })}
              className={cn('shrink-0', large ? 'h-11 w-11' : 'h-11 w-11 sm:h-10 sm:w-10')}
            >
              <CalendarDays className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={selected}
              defaultMonth={selected}
              onSelect={(date) => pick(date ? toIsoDate(date) : undefined)}
              locale={locale === 'ja' ? ja : enUS}
              formatters={{
                formatCaption: (month) =>
                  formatDate(month, locale === 'ja' ? 'yyyy年M月' : 'MMMM yyyy', {
                    locale: locale === 'ja' ? ja : enUS,
                  }),
              }}
              initialFocus
            />
            <div className="flex justify-between gap-2 border-t p-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-11 sm:h-9"
                onClick={() => pick(toIsoDate(new Date()))}
              >
                {t('editor.today')}
              </Button>
              {clearable && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-11 sm:h-9"
                  onClick={() => pick(undefined)}
                >
                  {t('editor.clear')}
                </Button>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
      {invalid && (
        <p id={errorId} className="text-xs text-red-600">
          {t('editor.dateInvalid')}
        </p>
      )}
    </div>
  );
}

export interface HearingMonthInputProps extends PickerProps {
  /** 'YYYY-MM' (an older half-entered 'YYYY-' / '-MM' is shown as not chosen) */
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export function HearingMonthInput({
  id,
  label,
  value,
  onChange,
  readOnly,
  large = false,
}: HearingMonthInputProps) {
  const t = useTranslations('leadHearings');
  const locale = useLocale();
  const monthName = new Intl.DateTimeFormat(locale, { month: 'short' });
  const { year, month } = splitYearMonth(value);
  const complete = typeof value === 'string' && YEAR_MONTH_PATTERN.test(value);
  const now = new Date();
  const [open, setOpen] = useState(false);
  const [shownYear, setShownYear] = useState(() => (year ? Number(year) : now.getFullYear()));
  const gridRef = useRef<HTMLDivElement>(null);

  const yearMonthText = (y: number | string, m: number) =>
    t('summary.yearMonth', { year: y, month: m, mm: pad2(m) });
  const text = complete ? yearMonthText(year, Number(month)) : t('editor.pickMonth');

  const changeOpen = (next: boolean) => {
    if (next) setShownYear(complete ? Number(year) : now.getFullYear());
    setOpen(next);
  };
  const pick = (next: string | undefined) => {
    if (next !== value) onChange(next);
    setOpen(false);
  };

  return (
    <div className="space-y-1">
      <Popover open={open} onOpenChange={changeOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={readOnly}
            aria-label={t('summary.pair', { name: label, value: text })}
            className={cn(
              'w-full justify-start gap-2 font-normal sm:w-48',
              large ? 'h-11' : 'h-11 sm:h-10',
              !complete && 'text-gray-500 dark:text-gray-400'
            )}
          >
            <CalendarDays className="h-4 w-4" />
            {text}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-72 p-3"
          align="start"
          onOpenAutoFocus={(e) => {
            // Start on the chosen month (or this month) instead of the year buttons
            const target = gridRef.current?.querySelector<HTMLElement>('[data-initial-focus]');
            if (target) {
              e.preventDefault();
              target.focus();
            }
          }}
        >
          <div className="mb-2 flex items-center justify-between">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9"
              aria-label={t('editor.prevYear')}
              disabled={shownYear <= MIN_YEAR}
              onClick={() => setShownYear((y) => Math.max(MIN_YEAR, y - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium" aria-live="polite">
              {t('editor.yearOption', { year: shownYear })}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9"
              aria-label={t('editor.nextYear')}
              disabled={shownYear >= MAX_YEAR}
              onClick={() => setShownYear((y) => Math.min(MAX_YEAR, y + 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div ref={gridRef} className="grid grid-cols-4 gap-2">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
              const isSelected = complete && Number(year) === shownYear && Number(month) === m;
              const isCurrent = shownYear === now.getFullYear() && m === now.getMonth() + 1;
              const initial = complete ? isSelected : isCurrent;
              return (
                <Button
                  key={m}
                  type="button"
                  variant={isSelected ? 'default' : 'ghost'}
                  aria-pressed={isSelected}
                  aria-label={yearMonthText(shownYear, m)}
                  data-initial-focus={initial ? '' : undefined}
                  className={cn('h-11 px-0', isCurrent && !isSelected && 'border border-brand-500')}
                  onClick={() => pick(`${shownYear}-${pad2(m)}`)}
                >
                  {monthName.format(new Date(2000, m - 1, 1))}
                </Button>
              );
            })}
          </div>
          <div className="mt-2 flex justify-between gap-2 border-t pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-11 sm:h-9"
              onClick={() => pick(`${now.getFullYear()}-${pad2(now.getMonth() + 1)}`)}
            >
              {t('editor.thisMonth')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-11 sm:h-9"
              onClick={() => pick(undefined)}
            >
              {t('editor.clear')}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
