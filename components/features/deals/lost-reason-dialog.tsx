'use client';

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
import { DEAL_LIMITS } from '@/lib/features/deals/types/schemas';
import { LOST_REASONS, type LostReason } from '@/lib/features/leads/types/pipeline';
import { useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useId, useState } from 'react';

export interface LostValues {
  lostReason: LostReason;
  lostNote: string | null;
  competitor: string | null;
}

interface LostReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealName: string;
  /** Values already on the deal */
  initial?: Partial<LostValues>;
  pending?: boolean;
  onConfirm: (values: LostValues) => void;
}

/** Losing a deal asks for the reason (required), the details and the competitor (Refs #436) */
export function LostReasonDialog({
  open,
  onOpenChange,
  dealName,
  initial,
  pending = false,
  onConfirm,
}: LostReasonDialogProps) {
  const t = useTranslations('deals.lostDialog');
  const tReason = useTranslations('pipeline.lostReason');
  const tCommon = useTranslations('common');
  const id = useId();
  const [reason, setReason] = useState<LostReason | ''>('');
  const [note, setNote] = useState('');
  const [competitor, setCompetitor] = useState('');
  const [showError, setShowError] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReason(initial?.lostReason ?? '');
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
      <DialogContent>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t('title', { name: dealName })}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor={`${id}-reason`}>{t('reason')}</Label>
            <Select
              value={reason}
              onValueChange={(value) => {
                setReason(value as LostReason);
                setShowError(false);
              }}
            >
              <SelectTrigger
                id={`${id}-reason`}
                aria-invalid={showError}
                aria-describedby={showError ? `${id}-reason-error` : undefined}
              >
                <SelectValue placeholder={t('reasonPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {LOST_REASONS.map((value) => (
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
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {t('confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
