'use client';

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
import type { HearingFieldDefinition, HearingOption } from '@/lib/features/lead-hearings/catalog';
import {
  asChoices,
  asLevels,
  asScale,
  hearingYearOptions,
  joinYearMonth,
  setHearingLevel,
  splitYearMonth,
  toDiagnosticLocale,
  toggleHearingOption,
} from '@/lib/features/lead-hearings/form';
import type { HearingFieldValue } from '@/lib/features/lead-hearings/types/schemas';
import { cn } from '@/lib/utils';
import { useLocale, useTranslations } from 'next-intl';
import type { ComponentType, ReactNode } from 'react';

/** Radix Select items cannot have an empty value */
const NONE = '__none__';

/** Text fields at most this long are a single line */
const SINGLE_LINE_MAX = 200;

/**
 * How an input is drawn: 'default' (selects and checkboxes) or 'chip' (large tappable buttons
 * for the meeting mode, #96; only choice-like types have one, the others fall back to default)
 */
export type HearingFieldVariant = 'default' | 'chip';

type FieldOfType<T extends HearingFieldDefinition['type']> = HearingFieldDefinition & { type: T };

export interface HearingFieldInputProps<F extends HearingFieldDefinition = HearingFieldDefinition> {
  field: F;
  value: HearingFieldValue | undefined;
  /** id of the first control (the field name label points at it) */
  id: string;
  /** The field name, for the labels of multi-part inputs */
  label: string;
  readOnly: boolean;
  variant: HearingFieldVariant;
  onChange: (value: HearingFieldValue | undefined) => void;
}

/** Label of a catalog option: from locales, or the Web diagnosis label */
function useOptionLabel() {
  const t = useTranslations();
  const diagnosisLocale = toDiagnosticLocale(useLocale());
  return (option: HearingOption) =>
    option.labelKey ? t(option.labelKey) : (option.label?.[diagnosisLocale] ?? option.value);
}

interface OptionSelectProps {
  id: string;
  ariaLabel?: string;
  value: string | undefined;
  options: { value: string; label: string }[];
  readOnly: boolean;
  onChange: (value: string | undefined) => void;
  className?: string;
}

function OptionSelect({
  id,
  ariaLabel,
  value,
  options,
  readOnly,
  onChange,
  className,
}: OptionSelectProps) {
  const t = useTranslations('leadHearings');
  return (
    <Select
      value={value || NONE}
      disabled={readOnly}
      onValueChange={(next) => onChange(next === NONE ? undefined : next)}
    >
      <SelectTrigger id={id} aria-label={ariaLabel} className={className}>
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
}

function SingleInput({
  field,
  value,
  id,
  readOnly,
  onChange,
}: HearingFieldInputProps<FieldOfType<'single'>>) {
  const optionLabel = useOptionLabel();
  return (
    <OptionSelect
      id={id}
      value={typeof value === 'string' ? value : undefined}
      options={field.options.map((o) => ({ value: o.value, label: optionLabel(o) }))}
      readOnly={readOnly}
      onChange={onChange}
    />
  );
}

function MultipleInput({
  field,
  value,
  id,
  label,
  readOnly,
  onChange,
}: HearingFieldInputProps<FieldOfType<'multiple'>>) {
  const optionLabel = useOptionLabel();
  const chosen = asChoices(value);
  return (
    <fieldset aria-label={label}>
      <div className="grid gap-2 sm:grid-cols-2">
        {field.options.map((option) => {
          const optionId = `${id}-${option.value}`;
          return (
            <div key={option.value} className="flex items-center gap-2">
              <Checkbox
                id={optionId}
                checked={chosen.includes(option.value)}
                disabled={readOnly}
                onCheckedChange={(checked) =>
                  onChange(
                    toggleHearingOption(field.options, chosen, option.value, checked === true)
                  )
                }
              />
              <Label htmlFor={optionId} className="font-normal">
                {optionLabel(option)}
              </Label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

function TextInput({
  field,
  value,
  id,
  readOnly,
  onChange,
}: HearingFieldInputProps<FieldOfType<'text'>>) {
  const props = {
    id,
    value: typeof value === 'string' ? value : '',
    maxLength: field.maxLength,
    readOnly,
    onChange: (e: { target: { value: string } }) =>
      onChange(e.target.value === '' ? undefined : e.target.value),
  };
  return field.maxLength <= SINGLE_LINE_MAX ? (
    <Input {...props} />
  ) : (
    <Textarea rows={3} {...props} />
  );
}

function NumberInput({
  field,
  value,
  id,
  readOnly,
  onChange,
}: HearingFieldInputProps<FieldOfType<'number'>>) {
  const options = [];
  for (let n = field.min; n <= field.max; n++) options.push({ value: String(n), label: String(n) });
  return (
    <OptionSelect
      id={id}
      value={typeof value === 'number' ? String(value) : undefined}
      options={options}
      readOnly={readOnly}
      onChange={(next) => onChange(next === undefined ? undefined : Number(next))}
      className="sm:w-40"
    />
  );
}

function DateInput({ value, id, readOnly, onChange }: HearingFieldInputProps<FieldOfType<'date'>>) {
  return (
    <Input
      id={id}
      type="date"
      className="sm:w-48"
      value={typeof value === 'string' ? value : ''}
      readOnly={readOnly}
      onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
    />
  );
}

function YearMonthInput({
  value,
  id,
  label,
  readOnly,
  onChange,
}: HearingFieldInputProps<FieldOfType<'yearMonth'>>) {
  const t = useTranslations('leadHearings');
  const { year, month } = splitYearMonth(value);
  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <OptionSelect
          id={id}
          ariaLabel={t('editor.yearOf', { field: label })}
          value={year}
          options={hearingYearOptions(new Date().getFullYear(), year).map((y) => ({
            value: String(y),
            label: t('editor.yearOption', { year: y }),
          }))}
          readOnly={readOnly}
          onChange={(next) => onChange(joinYearMonth(next, month))}
          className="w-32"
        />
        <OptionSelect
          id={`${id}-month`}
          ariaLabel={t('editor.monthOf', { field: label })}
          value={month}
          options={Array.from({ length: 12 }, (_, i) => ({
            value: String(i + 1).padStart(2, '0'),
            label: t('editor.monthOption', { month: i + 1 }),
          }))}
          readOnly={readOnly}
          onChange={(next) => onChange(joinYearMonth(year, next))}
          className="w-28"
        />
      </div>
      {Boolean(year) !== Boolean(month) && (
        <p className="text-xs text-amber-700">{t('editor.yearMonthIncomplete')}</p>
      )}
    </div>
  );
}

function LevelsInput({
  field,
  value,
  id,
  readOnly,
  onChange,
}: HearingFieldInputProps<FieldOfType<'levels'>>) {
  const t = useTranslations('leadHearings');
  const optionLabel = useOptionLabel();
  const levels = asLevels(value);
  const levelOptions = field.levels.map((l) => ({ value: l.value, label: optionLabel(l) }));
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {field.items.map((item) => {
        const itemLabel = optionLabel(item);
        return (
          <div key={item.value} className="space-y-1">
            <span className="text-xs text-muted-foreground">{itemLabel}</span>
            <OptionSelect
              id={`${id}-${item.value}`}
              ariaLabel={t('editor.levelOf', { item: itemLabel })}
              value={levels[item.value]}
              options={levelOptions}
              readOnly={readOnly}
              onChange={(next) => onChange(setHearingLevel(levels, item.value, next))}
            />
          </div>
        );
      })}
    </div>
  );
}

function ScaleInput({
  field,
  value,
  id,
  label,
  readOnly,
  onChange,
}: HearingFieldInputProps<FieldOfType<'scale'>>) {
  const t = useTranslations('leadHearings');
  const optionLabel = useOptionLabel();
  const diagnosisLocale = toDiagnosticLocale(useLocale());
  const scale = asScale(value);
  const basis = field.bases.find((b) => b.questionId === scale.basis);
  return (
    <div className="space-y-1">
      <div className="grid gap-2 sm:grid-cols-2">
        <OptionSelect
          id={id}
          ariaLabel={t('editor.scaleBasis', { field: label })}
          value={scale.basis}
          options={field.bases.map((b) => ({
            value: b.questionId,
            label: b.label[diagnosisLocale],
          }))}
          readOnly={readOnly}
          onChange={(next) => onChange(next ? { basis: next, bucket: '' } : undefined)}
        />
        {basis && (
          <OptionSelect
            id={`${id}-bucket`}
            ariaLabel={t('editor.scaleBucket', { field: label })}
            value={scale.bucket}
            options={basis.buckets.map((b) => ({ value: b.value, label: optionLabel(b) }))}
            readOnly={readOnly}
            onChange={(next) => onChange({ basis: basis.questionId, bucket: next ?? '' })}
          />
        )}
      </div>
      {basis && !scale.bucket && (
        <p className="text-xs text-amber-700">{t('editor.scaleIncomplete')}</p>
      )}
    </div>
  );
}

// ── Chips (meeting mode) ────────────────────────────────────────────────────────

interface ChipProps {
  selected: boolean;
  readOnly: boolean;
  onClick: () => void;
  ariaLabel?: string;
  children: ReactNode;
}

/** A large toggle button: at least 44px both ways so it can be tapped with a thumb */
function Chip({ selected, readOnly, onClick, ariaLabel, children }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={ariaLabel}
      disabled={readOnly}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border px-4 py-2 text-sm transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-60',
        selected
          ? 'border-blue-600 bg-blue-600 font-medium text-white'
          : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800'
      )}
    >
      {children}
    </button>
  );
}

interface ChipGroupProps {
  id: string;
  label: string;
  options: { value: string; label: string }[];
  isSelected: (value: string) => boolean;
  readOnly: boolean;
  onPick: (value: string) => void;
}

function ChipGroup({ id, label, options, isSelected, readOnly, onPick }: ChipGroupProps) {
  return (
    <fieldset id={id} aria-label={label} className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0">
      {options.map((option) => (
        <Chip
          key={option.value}
          selected={isSelected(option.value)}
          readOnly={readOnly}
          onClick={() => onPick(option.value)}
        >
          {option.label}
        </Chip>
      ))}
    </fieldset>
  );
}

/** Tapping the chosen chip again clears the choice */
const pickSingle = (current: string | undefined, picked: string) =>
  current === picked ? undefined : picked;

function SingleChips({
  field,
  value,
  id,
  label,
  readOnly,
  onChange,
}: HearingFieldInputProps<FieldOfType<'single'>>) {
  const optionLabel = useOptionLabel();
  const current = typeof value === 'string' ? value : undefined;
  return (
    <ChipGroup
      id={id}
      label={label}
      options={field.options.map((o) => ({ value: o.value, label: optionLabel(o) }))}
      isSelected={(v) => v === current}
      readOnly={readOnly}
      onPick={(picked) => onChange(pickSingle(current, picked))}
    />
  );
}

function MultipleChips({
  field,
  value,
  id,
  label,
  readOnly,
  onChange,
}: HearingFieldInputProps<FieldOfType<'multiple'>>) {
  const optionLabel = useOptionLabel();
  const chosen = asChoices(value);
  return (
    <ChipGroup
      id={id}
      label={label}
      options={field.options.map((o) => ({ value: o.value, label: optionLabel(o) }))}
      isSelected={(v) => chosen.includes(v)}
      readOnly={readOnly}
      onPick={(picked) =>
        onChange(toggleHearingOption(field.options, chosen, picked, !chosen.includes(picked)))
      }
    />
  );
}

function NumberChips({
  field,
  value,
  id,
  label,
  readOnly,
  onChange,
}: HearingFieldInputProps<FieldOfType<'number'>>) {
  const current = typeof value === 'number' ? String(value) : undefined;
  const options = [];
  for (let n = field.min; n <= field.max; n++) options.push({ value: String(n), label: String(n) });
  return (
    <ChipGroup
      id={id}
      label={label}
      options={options}
      isSelected={(v) => v === current}
      readOnly={readOnly}
      onPick={(picked) => {
        const next = pickSingle(current, picked);
        onChange(next === undefined ? undefined : Number(next));
      }}
    />
  );
}

function LevelsChips({
  field,
  value,
  id,
  readOnly,
  onChange,
}: HearingFieldInputProps<FieldOfType<'levels'>>) {
  const t = useTranslations('leadHearings');
  const optionLabel = useOptionLabel();
  const levels = asLevels(value);
  const levelOptions = field.levels.map((l) => ({ value: l.value, label: optionLabel(l) }));
  return (
    <div className="space-y-3">
      {field.items.map((item, index) => {
        const itemLabel = optionLabel(item);
        return (
          <div key={item.value} className="space-y-1">
            <span className="text-xs text-muted-foreground">{itemLabel}</span>
            <ChipGroup
              id={index === 0 ? id : `${id}-${item.value}`}
              label={t('editor.levelOf', { item: itemLabel })}
              options={levelOptions}
              isSelected={(v) => levels[item.value] === v}
              readOnly={readOnly}
              onPick={(picked) =>
                onChange(
                  setHearingLevel(levels, item.value, pickSingle(levels[item.value], picked))
                )
              }
            />
          </div>
        );
      })}
    </div>
  );
}

function ScaleChips({
  field,
  value,
  id,
  label,
  readOnly,
  onChange,
}: HearingFieldInputProps<FieldOfType<'scale'>>) {
  const t = useTranslations('leadHearings');
  const optionLabel = useOptionLabel();
  const diagnosisLocale = toDiagnosticLocale(useLocale());
  const scale = asScale(value);
  const basis = field.bases.find((b) => b.questionId === scale.basis);
  return (
    <div className="space-y-2">
      <ChipGroup
        id={id}
        label={t('editor.scaleBasis', { field: label })}
        options={field.bases.map((b) => ({ value: b.questionId, label: b.label[diagnosisLocale] }))}
        isSelected={(v) => v === scale.basis}
        readOnly={readOnly}
        onPick={(picked) => {
          const next = pickSingle(scale.basis, picked);
          onChange(next ? { basis: next, bucket: '' } : undefined);
        }}
      />
      {basis && (
        <ChipGroup
          id={`${id}-bucket`}
          label={t('editor.scaleBucket', { field: label })}
          options={basis.buckets.map((b) => ({ value: b.value, label: optionLabel(b) }))}
          isSelected={(v) => v === scale.bucket}
          readOnly={readOnly}
          onPick={(picked) =>
            onChange({ basis: basis.questionId, bucket: pickSingle(scale.bucket, picked) ?? '' })
          }
        />
      )}
      {basis && !scale.bucket && (
        <p className="text-xs text-amber-700">{t('editor.scaleIncomplete')}</p>
      )}
    </div>
  );
}

const CHIP_INPUTS: {
  [T in HearingFieldDefinition['type']]?: ComponentType<HearingFieldInputProps<FieldOfType<T>>>;
} = {
  single: SingleChips,
  multiple: MultipleChips,
  number: NumberChips,
  levels: LevelsChips,
  scale: ScaleChips,
};

const FIELD_INPUTS: {
  [T in HearingFieldDefinition['type']]: ComponentType<HearingFieldInputProps<FieldOfType<T>>>;
} = {
  single: SingleInput,
  multiple: MultipleInput,
  text: TextInput,
  number: NumberInput,
  date: DateInput,
  yearMonth: YearMonthInput,
  levels: LevelsInput,
  scale: ScaleInput,
};

/**
 * The chips are a group named by the field (aria-label), so the row shows the field name as
 * plain text instead of a <label> pointing at a control.
 */
export const usesChipInput = (field: HearingFieldDefinition, variant: HearingFieldVariant) =>
  variant === 'chip' && CHIP_INPUTS[field.type] !== undefined;

/** The input of a field, chosen by its type and the variant */
export function HearingFieldInput(props: HearingFieldInputProps) {
  const chip = props.variant === 'chip' ? CHIP_INPUTS[props.field.type] : undefined;
  const FieldInput = (chip ??
    FIELD_INPUTS[props.field.type]) as ComponentType<HearingFieldInputProps>;
  return <FieldInput {...props} />;
}
