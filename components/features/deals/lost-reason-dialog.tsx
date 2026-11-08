'use client';

import { TAP_TARGET } from '@/components/common/tap-target';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  DEAL_LOST_REASONS,
  type DealLostReason,
  dealLostReasonEnum,
} from '@/lib/features/deals/types/pipeline';
import { DEAL_LIMITS } from '@/lib/features/deals/types/schemas';
import type { LostReason } from '@/lib/features/leads/types/pipeline';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { RequiredMark } from './required-mark';

export interface LostValues {
  lostReason: DealLostReason;
  lostNote: string | null;
  competitor: string | null;
}

interface LostReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealName: string;
  /** Values already on the deal; a reason a deal can no longer take is not preselected */
  initial?: Partial<Omit<LostValues, 'lostReason'>> & { lostReason?: LostReason };
  /** The deal is won now: its lead stays won only while another of its deals is (#444) */
  fromWon?: boolean;
  /** The lead's SQL decision is recorded as 不適格 with the loss (#801) */
  notQualified?: boolean;
  /** The loss is being saved: the dialog stays open until it is, so a failure is told in it */
  pending?: boolean;
  /** Why the loss could not be saved, said in the dialog (Refs #720) */
  error?: string | null;
  onConfirm: (values: LostValues) => void;
  /** Where the focus goes when the dialog closes (it has no trigger to go back to) */
  onCloseAutoFocus?: (event: Event) => void;
}

/**
 * Losing a deal asks for the reason (required), the details and the competitor (Refs #436). A
 * send without a reason takes the focus to it, and the dialog does not close while the loss is
 * saved, so a failure is told in it (#720).
 */
export function LostReasonDialog({
  open,
  onOpenChange,
  dealName,
  initial,
  fromWon = false,
  notQualified = false,
  pending = false,
  error,
  onConfirm,
  onCloseAutoFocus,
}: LostReasonDialogProps) {
  const t = useTranslations('deals.lostDialog');
  const tForm = useTranslations('deals.form');
  const tReason = useTranslations('pipeline.lostReason');
  const tCommon = useTranslations('common');
  const id = useId();
  const reasonRef = useRef<HTMLButtonElement>(null);
  const [reason, setReason] = useState<DealLostReason | ''>('');
  const [note, setNote] = useState('');
  const [competitor, setCompetitor] = useState('');
  const [showError, setShowError] = useState(false);
  // A send without a reason: the focus goes to it once its error is on the page
  const [focusRequest, setFocusRequest] = useState(0);

  useEffect(() => {
    if (!open) return;
    const initialReason = dealLostReasonEnum.safeParse(initial?.lostReason);
    setReason(initialReason.success ? initialReason.data : '');
    setNote(initial?.lostNote ?? '');
    setCompetitor(initial?.competitor ?? '');
    setShowError(false);
  }, [open, initial?.lostReason, initial?.lostNote, initial?.competitor]);

  useEffect(() => {
    if (focusRequest > 0) reasonRef.current?.focus();
  }, [focusRequest]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    if (!reason) {
      setShowError(true);
      setFocusRequest((count) => count + 1);
      return;
    }
    onConfirm({
      lostReason: reason,
      lostNote: note.trim() || null,
      competitor: competitor.trim() || null,
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Not closed while the loss is saved, so a failure can still be told
        if (!next && pending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        onCloseAutoFocus={onCloseAutoFocus}
        onInteractOutside={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t('title', { name: dealName })}</DialogTitle>
            <DialogDescription>
              {t('description')}
              {fromWon && ` ${t('fromWon')}`}
              {notQualified && ` ${t('notQualified')}`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor={`${id}-reason`}>
              {t('reason')} <RequiredMark />
            </Label>
            <Select
              value={reason}
              onValueChange={(value) => {
                // A form's reset or autofill clears Radix's hidden select: keep the choice
                if (!value) return;
                setReason(value as DealLostReason);
                setShowError(false);
              }}
            >
              <SelectTrigger
                ref={reasonRef}
                id={`${id}-reason`}
                className={TAP_TARGET}
                aria-invalid={showError}
                aria-describedby={showError ? `${id}-reason-error` : undefined}
              >
                <SelectValue placeholder={t('reasonPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {DEAL_LOST_REASONS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {tReason(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {showError && (
              <p id={`${id}-reason-error`} className="text-sm text-red-600 dark:text-red-400">
                {t('reasonRequired')}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${id}-note`}>{t('note')}</Label>
            <Textarea
              id={`${id}-note`}
              value={note}
              maxLength={DEAL_LIMITS.lostNote}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${id}-competitor`}>{t('competitor')}</Label>
            <Input
              id={`${id}-competitor`}
              value={competitor}
              maxLength={DEAL_LIMITS.competitor}
              onChange={(event) => setCompetitor(event.target.value)}
              className={TAP_TARGET}
            />
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-500/10 dark:text-red-300"
            >
              {error}
            </p>
          )}

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              className={TAP_TARGET}
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              {tCommon('cancel')}
            </Button>
            <Button type="submit" className={TAP_TARGET} disabled={pending}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {pending ? tForm('saving') : t('confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
