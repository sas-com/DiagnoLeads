'use client';

import { TAP_TARGET } from '@/components/common/tap-target';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { type DealStage, STAGE_PROBABILITY } from '@/lib/features/deals/types/pipeline';
import type { LostReason } from '@/lib/features/leads/types/pipeline';
import { useTranslations } from 'next-intl';

interface ReopenDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The won or lost deal */
  deal: { name: string; stage: DealStage; lostReason: LostReason | null };
  /** The open stage it moves to */
  stage: DealStage;
  onConfirm: () => void;
  /** Where the focus goes when the question closes (it has no trigger to go back to) */
  onCloseAutoFocus?: (event: Event) => void;
}

/**
 * Reopening a won or lost deal asks first (Refs #436): it clears the lost reason and details,
 * which the audit log does not keep, resets the probability to the stage's default and drops the
 * forecast category override; the lead of a won deal goes back to 商談中 unless another of its
 * deals is won (its status is computed from its deals, #444).
 */
export function ReopenDialog({
  open,
  onOpenChange,
  deal,
  stage,
  onConfirm,
  onCloseAutoFocus,
}: ReopenDialogProps) {
  const t = useTranslations('deals');
  const tReason = useTranslations('pipeline.lostReason');
  const tCommon = useTranslations('common');
  const sentences: string[] = [];
  if (deal.stage === 'lost') {
    sentences.push(
      deal.lostReason
        ? t('reopenDialog.lost', { reason: tReason(deal.lostReason) })
        : t('reopenDialog.lostNoReason')
    );
  }
  sentences.push(
    t('reopenDialog.probability', {
      stage: t(`stages.${stage}`),
      probability: STAGE_PROBABILITY[stage],
    })
  );
  if (deal.stage === 'won') sentences.push(t('reopenDialog.won'));

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('reopenDialog.title', { name: deal.name })}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-1">
              {sentences.map((sentence) => (
                <p key={sentence}>{sentence}</p>
              ))}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className={TAP_TARGET}>{tCommon('cancel')}</AlertDialogCancel>
          <AlertDialogAction className={TAP_TARGET} onClick={onConfirm}>
            {t('reopenDialog.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
