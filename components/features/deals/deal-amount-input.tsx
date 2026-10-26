'use client';

import { TAP_TARGET } from '@/components/common/tap-target';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useLocale, useTranslations } from 'next-intl';
import { formatYen, parseAmount } from './deal-format';

interface DealAmountInputProps {
  /** The box's id, which its label points at */
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Whether to say that the text is not an amount (after the form was sent) */
  showError: boolean;
}

/**
 * A deal's amount box (Refs #720): yen typed with commas, spaces or full-width digits
 * (parseAmount), "円" after the box and the amount it reads under it ("＝ ￥12,000,000"), so a
 * digit too many shows before the amount is saved. The label is the caller's.
 */
export function DealAmountInput({ id, value, onChange, showError }: DealAmountInputProps) {
  const t = useTranslations('deals.form');
  const locale = useLocale();
  const amount = parseAmount(value);
  const invalid = showError && amount === 'invalid';
  const describedBy = [
    `${id}-help`,
    typeof amount === 'number' ? `${id}-preview` : null,
    invalid ? `${id}-error` : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <div className="relative">
        <Input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          value={value}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          className={cn('pr-12', TAP_TARGET)}
          onChange={(event) => onChange(event.target.value)}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-gray-700 dark:text-gray-300"
        >
          {t('amountUnit')}
        </span>
      </div>
      <p id={`${id}-help`} className="text-sm text-gray-600 dark:text-gray-300">
        {t('amountHelp')}
      </p>
      {typeof amount === 'number' && (
        <p
          id={`${id}-preview`}
          className="text-sm font-medium text-gray-900 tabular-nums dark:text-gray-50"
        >
          {t('amountPreview', { amount: formatYen(amount, locale) ?? '' })}
        </p>
      )}
      {invalid && (
        <p id={`${id}-error`} className="text-sm text-red-600 dark:text-red-400">
          {t('amountInvalid')}
        </p>
      )}
    </>
  );
}
