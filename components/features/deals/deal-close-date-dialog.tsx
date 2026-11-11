'use client';

import { TAP_TARGET } from '@/components/common/tap-target';
import { HearingDateInput } from '@/components/features/lead-hearings/hearing-date-inputs';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { CalendarDays, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
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
      <CalendarDays className="h-4 w-4" aria-hidden="true" />
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
 * without opening the deal: one date, from today on (an earlier one would leave the deal marked)
 * to 2100, which the calendar offers alone, saved alone (deals.update with only the date) by the
 * button or Enter in the box. It starts empty, as today would put the date off by one day only.
 * It says the date that passed; once saved it
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

/** The latest expected close date the deals take (dealDate, 2000 to 2100) */
const LAST_CLOSE_DATE = '2100-12-31';

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
  const form = useRef<HTMLFormElement>(null);
  const [date, setDate] = useState<string | undefined>(undefined);
  const [unreadable, setUnreadable] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [failed, setFailed] = useState(false);
  // Read when Enter saves, as the box may have just taken the date
  const latest = useRef<{ date?: string; unreadable: boolean }>({ unreadable: false });
  const shownToday = formatDealDate(today);
  // Each opening starts clean (the form is mounted only while the dialog is open)
  useEffect(
    () => onDirtyChange(date !== undefined || unreadable),
    [date, unreadable, onDirtyChange]
  );

  /** What is wrong with a date: none, before today (it would stay marked), or past what deals take */
  const problemOf = (value: string | undefined) =>
    !value
      ? t('required')
      : value < today
        ? t('notBeforeToday', { today: shownToday })
        : !isDealDate(value)
          ? tForm('closeDateInvalid')
          : undefined;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSubmitted(true);
    const { date: value, unreadable: notADate } = latest.current;
    if (notADate || problemOf(value) || !value) {
      document.getElementById(`${id}-date`)?.focus();
      return;
    }
    setFailed(false);
    try {
      await onSave(value);
    } catch {
      setFailed(true);
    }
  };

  return (
    <form ref={form} onSubmit={submit} noValidate className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-date`}>{t('field')}</Label>
        <HearingDateInput
          id={`${id}-date`}
          label={t('field')}
          value={date}
          onChange={(value) => {
            latest.current.date = value;
            setDate(value);
          }}
          readOnly={false}
          clearable={false}
          min={today}
          max={LAST_CLOSE_DATE}
          describedBy={`${id}-hint`}
          onEnter={() => form.current?.requestSubmit()}
          onInvalidChange={(invalid) => {
            latest.current.unreadable = invalid;
            setUnreadable(invalid);
          }}
          // The box says itself that it holds no date
          error={submitted && !unreadable ? problemOf(date) : undefined}
        />
        <p id={`${id}-hint`} className="text-sm text-gray-600 dark:text-gray-300">
          {t('hint', { today: shownToday })}
        </p>
      </div>
      {failed && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {tToasts('error')}
        </p>
      )}
      {/* The button's new name alone may not be read out (as the delete question's, #1074) */}
      <output className="sr-only">{saving ? tForm('saving') : ''}</output>
      {/* As the dialog that adds a next action beside it: side by side at the end */}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          className={TAP_TARGET}
          disabled={saving}
          onClick={onCancel}
        >
          {tCommon('cancel')}
        </Button>
        <Button
          type="submit"
          className={cn(TAP_TARGET, 'min-w-24')}
          // aria-disabled, not disabled: the focus stays on the button while the date is saved;
          // pressing it again sends nothing, as the send returns meanwhile (#1074)
          aria-disabled={saving}
        >
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          {saving ? tForm('saving') : tForm('submitEdit')}
        </Button>
      </div>
    </form>
  );
}
