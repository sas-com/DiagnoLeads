'use client';

import { HearingDateInput } from '@/components/features/lead-hearings/hearing-date-inputs';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DEAL_LIMITS } from '@/lib/features/deals/types/schemas';
import { jstDate } from '@/lib/features/leads/types/pipeline';
import { useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { isDealDate, parseWhole } from './deal-format';

export interface WonValues {
  /** Day the deal was won (YYYY-MM-DD, Japan) */
  closedOn: string;
  amount: number | null;
}

interface WonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealName: string;
  /** The lead's company or name; empty when it has neither */
  leadLabel: string;
  /** The deal's amount, to confirm or correct */
  amount: number | null;
  /** The deal is lost now: winning it clears the lost reason and details */
  fromLost?: boolean;
  pending?: boolean;
  onConfirm: (values: WonValues) => void;
}

/**
 * Winning a deal asks for the day it was won (today by default) and the amount, and says what it
 * does to the lead: it becomes 成約 and stays so even if the deal is reopened (Refs #436)
 */
export function WonDialog({
  open,
  onOpenChange,
  dealName,
  leadLabel,
  amount,
  fromLost = false,
  pending = false,
  onConfirm,
}: WonDialogProps) {
  const t = useTranslations('deals');
  const tCommon = useTranslations('common');
  const id = useId();
  const [closedOn, setClosedOn] = useState<string | undefined>(undefined);
  const [amountText, setAmountText] = useState('');
  // The date box holds text that is not a date (it shows its own error)
  const [dateUnreadable, setDateUnreadable] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!open) return;
    setClosedOn(jstDate());
    setAmountText(amount === null ? '' : String(amount));
    setDateUnreadable(false);
    setSubmitted(false);
  }, [open, amount]);

  const parsedAmount = parseWhole(amountText, DEAL_LIMITS.amount);
  const dateError = !closedOn || !isDealDate(closedOn);
  const amountError = parsedAmount === 'invalid';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (dateUnreadable || dateError || amountError || !closedOn) return;
    onConfirm({ closedOn, amount: parsedAmount });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t('wonDialog.title', { name: dealName })}</DialogTitle>
            <DialogDescription>
              {leadLabel
                ? t('wonDialog.impact', { lead: leadLabel })
                : t('wonDialog.impactUnnamed')}
              {fromLost && ` ${t('wonDialog.fromLost')}`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor={`${id}-closed`}>{t('wonDialog.closedOn')}</Label>
            <HearingDateInput
              id={`${id}-closed`}
              label={t('wonDialog.closedOn')}
              value={closedOn}
              onChange={setClosedOn}
              readOnly={false}
              clearable={false}
              onInvalidChange={setDateUnreadable}
              error={submitted && dateError ? t('wonDialog.closedOnInvalid') : undefined}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${id}-amount`}>{t('fields.amount')}</Label>
            <Input
              id={`${id}-amount`}
              inputMode="numeric"
              value={amountText}
              aria-invalid={submitted && amountError}
              aria-describedby={`${id}-amount-help${submitted && amountError ? ` ${id}-amount-error` : ''}`}
              onChange={(event) => setAmountText(event.target.value)}
            />
            <p id={`${id}-amount-help`} className="text-xs text-gray-500 dark:text-gray-400">
              {t('form.amountHelp')}
            </p>
            {submitted && amountError && (
              <p id={`${id}-amount-error`} className="text-sm text-red-600 dark:text-red-400">
                {t('form.amountInvalid')}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {t('wonDialog.confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
