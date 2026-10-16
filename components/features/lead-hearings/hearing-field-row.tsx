'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  HEARING_ITEM_STATUSES,
  type HearingFieldDefinition,
  type HearingItemStatus,
} from '@/lib/features/lead-hearings/catalog';
import { normalizeHearingValue } from '@/lib/features/lead-hearings/form';
import type {
  HearingFieldEntry,
  HearingFieldValue,
} from '@/lib/features/lead-hearings/types/schemas';
import { cn } from '@/lib/utils';
import { CheckCircle2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { memo } from 'react';
import { HearingFieldInput, type HearingFieldVariant, usesChipInput } from './hearing-field-inputs';

const SOURCE_COLORS = { prefilled: 'blue', confirmed: 'emerald', corrected: 'violet' } as const;

interface HearingFieldRowProps {
  field: HearingFieldDefinition;
  entry: HearingFieldEntry;
  required: boolean;
  /** "AS/400 / ..." when the Web diagnosis said something about this field */
  hint: string | null;
  readOnly: boolean;
  variant?: HearingFieldVariant;
  /** Callbacks take the field so the editor can pass the same function to every row */
  onValueChange: (field: HearingFieldDefinition, value: HearingFieldValue | undefined) => void;
  onStatusChange: (field: HearingFieldDefinition, status: HearingItemStatus) => void;
  onConfirm: (field: HearingFieldDefinition) => void;
}

/** One field: name, status, the diagnosis hint and the input (re-renders only when it changes) */
export const HearingFieldRow = memo(function HearingFieldRow({
  field,
  entry,
  required,
  hint,
  readOnly,
  variant = 'default',
  onValueChange,
  onStatusChange,
  onConfirm,
}: HearingFieldRowProps) {
  const t = useTranslations('leadHearings');
  const tRoot = useTranslations();
  const label = tRoot(field.labelKey);
  const id = `hearing-${field.key}`;
  const canConfirm =
    !readOnly &&
    entry.source === 'prefilled' &&
    normalizeHearingValue(field, entry.value) !== undefined;

  return (
    <div
      id={`hearing-row-${field.key}`}
      className="scroll-mt-24 space-y-2 border-b py-4 last:border-b-0"
      data-testid={`hearing-field-${field.key}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {/* Multi-part inputs label their parts themselves; the others are labelled by the name */}
        {field.type !== 'multiple' && !usesChipInput(field, variant) ? (
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
            onValueChange={(next) => onStatusChange(field, next as HearingItemStatus)}
          >
            <SelectTrigger
              aria-label={t('editor.statusOf', { field: label })}
              className={cn(
                'w-24 text-xs',
                variant === 'chip' ? 'h-11' : 'h-8',
                entry.status === 'done' && 'border-emerald-400'
              )}
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
              onClick={() => onConfirm(field)}
            >
              <CheckCircle2 className="h-4 w-4" />
              {t('editor.confirm')}
            </Button>
          )}
        </div>
      )}

      <div data-hearing-input>
        <HearingFieldInput
          field={field}
          value={entry.value}
          id={id}
          label={label}
          readOnly={readOnly}
          variant={variant}
          onChange={(value) => onValueChange(field, value)}
        />
      </div>
    </div>
  );
});
