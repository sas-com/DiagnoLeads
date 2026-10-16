'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { DiagnosticLocale } from '@/lib/features/diagnostics/types';
import {
  HEARING_ITEM_STATUSES,
  type HearingFieldDefinition,
  type HearingItemStatus,
  type HearingOption,
} from '@/lib/features/lead-hearings/catalog';
import { normalizeHearingValue } from '@/lib/features/lead-hearings/form';
import type {
  HearingFieldEntry,
  HearingFieldValue,
} from '@/lib/features/lead-hearings/types/schemas';
import { cn } from '@/lib/utils';
import { CheckCircle2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

/** Radix Select items cannot have an empty value */
const NONE = '__none__';

/** Text fields at most this long are a single line */
const SINGLE_LINE_MAX = 200;

const SOURCE_COLORS = { prefilled: 'blue', confirmed: 'emerald', corrected: 'violet' } as const;

const YEARS_BACK = 15;
const YEARS_AHEAD = 15;

interface HearingFieldRowProps {
  field: HearingFieldDefinition;
  entry: HearingFieldEntry;
  required: boolean;
  /** "AS/400 / ..." when the Web diagnosis said something about this field */
  hint: string | null;
  readOnly: boolean;
  onValueChange: (value: HearingFieldValue | undefined) => void;
  onStatusChange: (status: HearingItemStatus) => void;
  onConfirm: () => void;
}

export function HearingFieldRow({
  field,
  entry,
  required,
  hint,
  readOnly,
  onValueChange,
  onStatusChange,
  onConfirm,
}: HearingFieldRowProps) {
  const t = useTranslations('leadHearings');
  const tRoot = useTranslations();
  const locale = useLocale();
  const diagnosisLocale: DiagnosticLocale = locale === 'en' ? 'en' : 'ja';
  const label = tRoot(field.labelKey);
  const id = `hearing-${field.key}`;
  const optionLabel = (option: HearingOption) =>
    option.labelKey ? tRoot(option.labelKey) : (option.label?.[diagnosisLocale] ?? option.value);
  const canConfirm =
    !readOnly &&
    entry.source === 'prefilled' &&
    normalizeHearingValue(field, entry.value) !== undefined;

  const selectOf = (
    selectId: string,
    ariaLabel: string | undefined,
    value: string | undefined,
    options: { value: string; label: string }[],
    onChange: (value: string | undefined) => void,
    className?: string
  ) => (
    <Select
      value={value || NONE}
      disabled={readOnly}
      onValueChange={(next) => onChange(next === NONE ? undefined : next)}
    >
      <SelectTrigger id={selectId} aria-label={ariaLabel} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{t('editor.notSelected')}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const renderInput = () => {
    const value = entry.value;
    switch (field.type) {
      case 'single':
        return selectOf(
          id,
          undefined,
          typeof value === 'string' ? value : undefined,
          field.options.map((o) => ({ value: o.value, label: optionLabel(o) })),
          onValueChange
        );
      case 'multiple': {
        const chosen = Array.isArray(value) ? value : [];
        return (
          <div className="grid gap-2 sm:grid-cols-2">
            {field.options.map((option) => {
              const optionId = `${id}-${option.value}`;
              return (
                <div key={option.value} className="flex items-center gap-2">
                  <Checkbox
                    id={optionId}
                    checked={chosen.includes(option.value)}
                    disabled={readOnly}
                    onCheckedChange={(checked) => {
                      const next =
                        checked === true
                          ? field.options
                              .map((o) => o.value)
                              .filter((v) => v === option.value || chosen.includes(v))
                          : chosen.filter((v) => v !== option.value);
                      onValueChange(next.length > 0 ? next : undefined);
                    }}
                  />
                  <Label htmlFor={optionId} className="font-normal">
                    {optionLabel(option)}
                  </Label>
                </div>
              );
            })}
          </div>
        );
      }
      case 'text': {
        const text = typeof value === 'string' ? value : '';
        const onChange = (next: string) => onValueChange(next === '' ? undefined : next);
        return field.maxLength <= SINGLE_LINE_MAX ? (
          <Input
            id={id}
            value={text}
            maxLength={field.maxLength}
            readOnly={readOnly}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <Textarea
            id={id}
            rows={3}
            value={text}
            maxLength={field.maxLength}
            readOnly={readOnly}
            onChange={(e) => onChange(e.target.value)}
          />
        );
      }
      case 'number': {
        const options = [];
        for (let n = field.min; n <= field.max; n++) {
          options.push({ value: String(n), label: String(n) });
        }
        return selectOf(
          id,
          undefined,
          typeof value === 'number' ? String(value) : undefined,
          options,
          (next) => onValueChange(next === undefined ? undefined : Number(next)),
          'sm:w-40'
        );
      }
      case 'date':
        return (
          <Input
            id={id}
            type="date"
            className="sm:w-48"
            value={typeof value === 'string' ? value : ''}
            readOnly={readOnly}
            onChange={(e) => onValueChange(e.target.value === '' ? undefined : e.target.value)}
          />
        );
      case 'yearMonth': {
        const [year = '', month = ''] = typeof value === 'string' ? value.split('-') : [];
        const thisYear = new Date().getFullYear();
        const years = new Set<number>();
        for (let y = thisYear - YEARS_BACK; y <= thisYear + YEARS_AHEAD; y++) years.add(y);
        if (year) years.add(Number(year));
        const set = (nextYear: string | undefined, nextMonth: string | undefined) =>
          onValueChange(nextYear || nextMonth ? `${nextYear ?? ''}-${nextMonth ?? ''}` : undefined);
        return (
          <div className="space-y-1">
            <div className="flex gap-2">
              {selectOf(
                id,
                t('editor.yearOf', { field: label }),
                year,
                [...years]
                  .sort((a, b) => a - b)
                  .map((y) => ({ value: String(y), label: t('editor.yearOption', { year: y }) })),
                (next) => set(next, month),
                'w-32'
              )}
              {selectOf(
                `${id}-month`,
                t('editor.monthOf', { field: label }),
                month,
                Array.from({ length: 12 }, (_, i) => ({
                  value: String(i + 1).padStart(2, '0'),
                  label: t('editor.monthOption', { month: i + 1 }),
                })),
                (next) => set(year, next),
                'w-28'
              )}
            </div>
            {Boolean(year) !== Boolean(month) && (
              <p className="text-xs text-amber-700">{t('editor.yearMonthIncomplete')}</p>
            )}
          </div>
        );
      }
      case 'levels': {
        const levels =
          value && typeof value === 'object' && !Array.isArray(value)
            ? (value as Partial<Record<string, string>>)
            : {};
        return (
          <div className="grid gap-2 sm:grid-cols-2">
            {field.items.map((item) => {
              const itemLabel = optionLabel(item);
              return (
                <div key={item.value} className="space-y-1">
                  <span className="text-xs text-muted-foreground">{itemLabel}</span>
                  {selectOf(
                    `${id}-${item.value}`,
                    t('editor.levelOf', { item: itemLabel }),
                    levels[item.value],
                    field.levels.map((l) => ({ value: l.value, label: optionLabel(l) })),
                    (next) => {
                      const updated = { ...levels };
                      if (next) updated[item.value] = next;
                      else delete updated[item.value];
                      onValueChange(Object.keys(updated).length > 0 ? updated : undefined);
                    }
                  )}
                </div>
              );
            })}
          </div>
        );
      }
      case 'scale': {
        const scale =
          value && typeof value === 'object' && !Array.isArray(value)
            ? (value as { basis?: string; bucket?: string })
            : {};
        const basis = field.bases.find((b) => b.questionId === scale.basis);
        return (
          <div className="space-y-1">
            <div className="grid gap-2 sm:grid-cols-2">
              {selectOf(
                id,
                t('editor.scaleBasis', { field: label }),
                scale.basis,
                field.bases.map((b) => ({ value: b.questionId, label: b.label[diagnosisLocale] })),
                (next) => onValueChange(next ? { basis: next, bucket: '' } : undefined)
              )}
              {basis &&
                selectOf(
                  `${id}-bucket`,
                  t('editor.scaleBucket', { field: label }),
                  scale.bucket,
                  basis.buckets.map((b) => ({ value: b.value, label: optionLabel(b) })),
                  (next) => onValueChange({ basis: basis.questionId, bucket: next ?? '' })
                )}
            </div>
            {basis && !scale.bucket && (
              <p className="text-xs text-amber-700">{t('editor.scaleIncomplete')}</p>
            )}
          </div>
        );
      }
    }
  };

  // Multi-part inputs label their parts themselves; the others are labelled by the field name
  const labelledByName = field.type !== 'multiple';

  return (
    <div
      className="space-y-2 border-b py-4 last:border-b-0"
      data-testid={`hearing-field-${field.key}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {labelledByName ? (
          <Label htmlFor={id} className="font-medium">
            {label}
          </Label>
        ) : (
          <span className="text-sm font-medium">{label}</span>
        )}
        {required && (
          <span className="text-xs font-semibold text-red-600">{t('editor.required')}</span>
        )}
        {entry.source && (
          <Badge color={SOURCE_COLORS[entry.source]} size="sm">
            {t(`sources.${entry.source}`)}
          </Badge>
        )}
        <div className="ml-auto">
          <Select
            value={entry.status}
            disabled={readOnly}
            onValueChange={(next) => onStatusChange(next as HearingItemStatus)}
          >
            <SelectTrigger
              aria-label={t('editor.statusOf', { field: label })}
              className={cn('h-8 w-24 text-xs', entry.status === 'done' && 'border-emerald-400')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HEARING_ITEM_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {t(`statuses.${status}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {hint && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{t('editor.hint', { value: hint })}</span>
          {canConfirm && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7"
              aria-label={t('editor.confirmOf', { field: label })}
              onClick={onConfirm}
            >
              <CheckCircle2 className="h-4 w-4" />
              {t('editor.confirm')}
            </Button>
          )}
        </div>
      )}

      {field.type === 'multiple' ? (
        <fieldset aria-label={label}>{renderInput()}</fieldset>
      ) : (
        renderInput()
      )}
    </div>
  );
}
