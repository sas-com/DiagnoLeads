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
import { buttonVariants } from '@/components/ui/button';
import type { DealStage } from '@/lib/features/deals/types/pipeline';
import type { SqlDecision } from '@/lib/features/leads/types/pipeline';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';

interface SqlDecisionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealName: string;
  /** The lead's company or name; empty when it has neither */
  leadLabel: string;
  /** The stage after 見極め the deal is moved to */
  stage: DealStage;
  onDecide: (decision: SqlDecision) => void;
  /** Where the focus goes when the question closes (it has no trigger to go back to) */
  onCloseAutoFocus?: (event: Event) => void;
}

/**
 * Moving a deal out of 見極め while its lead has no SQL decision asks for it first (#801): the
 * SQL decision is the exit of 見極め (decision `2026-10-25-lead-lifecycle`). 適格 records it on the
 * lead and goes on with the move; 不適格 goes to losing the deal with a reason; cancelling leaves
 * the deal where it is. The decision is sent with the move, so it is saved with it or not at all.
 */
export function SqlDecisionDialog({
  open,
  onOpenChange,
  dealName,
  leadLabel,
  stage,
  onDecide,
  onCloseAutoFocus,
}: SqlDecisionDialogProps) {
  const t = useTranslations('deals.sqlDialog');
  const tStages = useTranslations('deals.stages');
  const tCommon = useTranslations('common');

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('title', { name: dealName })}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-1">
              <p>
                {leadLabel
                  ? t('description', { lead: leadLabel, stage: tStages(stage) })
                  : t('descriptionUnnamed', { stage: tStages(stage) })}
              </p>
              <p>{t('qualifiedHint')}</p>
              <p>{t('notQualifiedHint')}</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {/* Long labels wrap; cancelling stands apart from 不適格, which loses the deal */}
        <AlertDialogFooter className="gap-2 sm:flex-wrap sm:space-x-0">
          <AlertDialogCancel className={cn(TAP_TARGET, 'sm:mr-auto')}>
            {tCommon('cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            className={cn(buttonVariants({ variant: 'outline' }), TAP_TARGET)}
            onClick={() => onDecide('not_qualified')}
          >
            {t('notQualified')}
          </AlertDialogAction>
          <AlertDialogAction className={TAP_TARGET} onClick={() => onDecide('qualified')}>
            {t('qualified', { stage: tStages(stage) })}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
