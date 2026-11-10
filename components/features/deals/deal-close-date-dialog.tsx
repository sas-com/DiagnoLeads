'use client';

import { TAP_TARGET } from '@/components/common/tap-target';
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
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { CalendarClock, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useId, useState } from 'react';
import { toast } from 'sonner';
import { formatDealDate, isDealDate } from './deal-format';
import { useDealMutations } from './use-deal-mutations';

/**
 * "Change close date" on a row of 今日's deals that need attention (#999), for an open deal past
 * its expected close date, to those who may change deals: it opens the screen's dialog. Outlined
 * and 44px tall on phones like "Add a next action" beside it, and named with the deal so that a
 * list of them can be told apart (its words are in its name, WCAG 2.5.3).
 */
export function DealCloseDateButton({
  dealName,
  onChange,
  className,
}: {
  dealName: string;
  /** With the button, which the focus goes back to when the dialog closes without a change */
  onChange: (opener: HTMLElement) => void;
  className?: string;
}) {
  const t = useTranslations('deals.closeDate');
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      // 44px on phones; from md, as compact as "Add a next action"
      className={cn(TAP_TARGET, 'md:h-8 md:px-2.5', className)}
      aria-label={t('fixFor', { name: dealName })}
      onClick={(event) => onChange(event.currentTarget)}
    >
      <CalendarClock className="h-4 w-4" aria-hidden="true" />
      {t('fix')}
    </Button>
  );
}

export interface DealCloseDateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  /** The deal whose expected close date is changed */
  deal: { id: string; name: string; expectedCloseOn: string | null };
  /** The lead's company or name, empty when it has neither */
  leadLabel: string;
  /** Japan calendar day the board was read on: the earliest date it takes */
  today: string;
  /** Once the date is saved, before it closes */
  onChanged?: () => void;
  /** Where the focus goes when it closes: it was not opened by a dialog trigger */
  onCloseAutoFocus?: (event: Event) => void;
}

/**
 * Changes the expected close date of a deal past it, from 今日's deals that need attention (#999),
 * without opening the deal: one date, from today on (an earlier one would leave the deal marked),
 * saved alone (deals.update with only the date). It says the date that passed; once saved it
 * closes, a toast names the deal and the new date, and the deals are read again (the deal
 * mutations do), so the mark goes. While it saves it does not close, so a failure is said in
 * place with the date kept; a tap outside does not close it then, nor once a date was entered.
 */
export function DealCloseDateDialog({
  open,
  onOpenChange,
  organizationId,
  deal,
  leadLabel,
  today,
  onChanged,
  onCloseAutoFocus,
}: DealCloseDateDialogProps) {
  const t = useTranslations('deals.closeDate');
  // The failure is said in the dialog, not in a toast
  const { update } = useDealMutations({ toastErrors: false });
  const [dirty, setDirty] = useState(false);
  const passed = deal.expectedCloseOn ? formatDealDate(deal.expectedCloseOn) : '';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && update.isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-md"
        onInteractOutside={(event) => {
          if (dirty || update.isPending) event.preventDefault();
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          {/* A long deal name wraps clear of the close button */}
          <DialogTitle className="pr-6 leading-normal">
            {t('title', { deal: deal.name })}
          </DialogTitle>
          <DialogDescription>
            {leadLabel
              ? t('description', { lead: leadLabel, date: passed })
              : t('descriptionNoName', { date: passed })}
          </DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so each opening starts empty */}
        <CloseDateForm
          today={today}
          saving={update.isPending}
          onDirtyChange={setDirty}
          onCancel={() => onOpenChange(false)}
          onSave={async (date) => {
            await update.mutateAsync({ organizationId, dealId: deal.id, expectedCloseOn: date });
            toast.success(
              t('saved', { name: deal.name, date: formatDealDate(date) }),
              leadLabel ? { description: leadLabel } : undefined
            );
            onChanged?.();
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function CloseDateForm({
  today,
  saving,
  onDirtyChange,
  onCancel,
  onSave,
}: {
  today: string;
  saving: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onCancel: () => void;
  /** Rejects when the date could not be saved */
  onSave: (date: string) => Promise<void>;
}) {
  const t = useTranslations('deals.closeDate');
  const tForm = useTranslations('deals.form');
  const tToasts = useTranslations('deals.toasts');
  const tCommon = useTranslations('common');
  const id = useId();
  const [date, setDate] = useState<string | undefined>(undefined);
  const [unreadable, setUnreadable] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [failed, setFailed] = useState(false);
  const shownToday = formatDealDate(today);
  // What is wrong with the date once a save was tried; the box says it when it is not a date
  const problem = !date
    ? t('required')
    : !isDealDate(date)
      ? tForm('closeDateInvalid')
      : date < today
        ? t('notBeforeToday', { today: shownToday })
        : undefined;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSubmitted(true);
    if (unreadable || problem || !date) {
      document.getElementById(`${id}-date`)?.focus();
      return;
    }
    setFailed(false);
    try {
      await onSave(date);
    } catch {
      setFailed(true);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-date`}>{t('field')}</Label>
        <HearingDateInput
          id={`${id}-date`}
          label={t('field')}
          value={date}
          onChange={(value) => {
            setDate(value);
            onDirtyChange(!!value);
          }}
          readOnly={false}
          onInvalidChange={setUnreadable}
          error={submitted && !unreadable ? problem : undefined}
        />
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {t('hint', { today: shownToday })}
        </p>
      </div>
      {failed && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {tToasts('error')}
        </p>
      )}
      <DialogFooter className="gap-2 sm:gap-0">
        <Button
          type="button"
          variant="outline"
          className={TAP_TARGET}
          disabled={saving}
          onClick={onCancel}
        >
          {tCommon('cancel')}
        </Button>
        <Button type="submit" className={cn(TAP_TARGET, 'min-w-24')} disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          {t('save')}
        </Button>
      </DialogFooter>
    </form>
  );
}
