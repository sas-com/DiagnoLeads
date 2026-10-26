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
import { useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useId, useState } from 'react';

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
  /** The deal is won now: its lead stays 成約 */
  fromWon?: boolean;
  pending?: boolean;
  /** Why the loss could not be saved, said in the dialog (Refs #720) */
  error?: string | null;
  onConfirm: (values: LostValues) => void;
  /** Where the focus goes when the dialog closes (it has no trigger to go back to) */
  onCloseAutoFocus?: (event: Event) => void;
}

/** Losing a deal asks for the reason (required), the details and the competitor (Refs #436) */
export function LostReasonDialog({
  open,
  onOpenChange,
  dealName,
  initial,
  fromWon = false,
  pending = false,
  error,
  onConfirm,
  onCloseAutoFocus,
}: LostReasonDialogProps) {
  const t = useTranslations('deals.lostDialog');
  const tReason = useTranslations('pipeline.lostReason');
  const tCommon = useTranslations('common');
  const id = useId();
  const [reason, setReason] = useState<DealLostReason | ''>('');
  const [note, setNote] = useState('');
  const [competitor, setCompetitor] = useState('');
  const [showError, setShowError] = useState(false);

  useEffect(() => {
    if (!open) return;
    const initialReason = dealLostReasonEnum.safeParse(initial?.lostReason);
    setReason(initialReason.success ? initialReason.data : '');
    setNote(initial?.lostNote ?? '');
    setCompetitor(initial?.competitor ?? '');
    setShowError(false);
  }, [open, initial?.lostReason, initial?.lostNote, initial?.competitor]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!reason) {
      setShowError(true);
      return;
    }
    onConfirm({
      lostReason: reason,
      lostNote: note.trim() || null,
      competitor: competitor.trim() || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t('title', { name: dealName })}</DialogTitle>
            <DialogDescription>
              {t('description')}
              {fromWon && ` ${t('fromWon')}`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor={`${id}-reason`}>{t('reason')}</Label>
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
              onClick={() => onOpenChange(false)}
            >
              {tCommon('cancel')}
            </Button>
            <Button type="submit" className={TAP_TARGET} disabled={pending}>
              {t('confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
