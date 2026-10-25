'use client';

import type { DealView } from '@/lib/features/deals/service';
import { type DealStage, isOpenStage } from '@/lib/features/deals/types/pipeline';
import { useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import { LostReasonDialog, type LostValues } from './lost-reason-dialog';
import { ReopenDialog } from './reopen-dialog';
import { useDealMutations } from './use-deal-mutations';
import { WonDialog, type WonValues } from './won-dialog';

/** A deal to move, with its lead's company or name (empty when it has neither) */
export type MovingDeal = Pick<
  DealView,
  'id' | 'name' | 'stage' | 'amount' | 'lostReason' | 'lostNote' | 'competitor'
> & { leadLabel: string };

/**
 * Moving a deal to another stage from the board or the deal page (Refs #436). Losing asks for the
 * reason, winning for the day and the amount (the lead becomes 成約 for good), and reopening a
 * won or lost deal for a confirmation; other moves are made at once. The screen renders `dialogs`.
 */
export function useStageMove(organizationId: string): {
  move: (deal: MovingDeal, stage: DealStage) => void;
  dialogs: ReactNode;
} {
  const t = useTranslations('deals');
  const { update } = useDealMutations();
  const [asking, setAsking] = useState<{ deal: MovingDeal; stage: DealStage } | null>(null);

  const send = (deal: MovingDeal, stage: DealStage, values?: LostValues | WonValues) =>
    update.mutate(
      { organizationId, dealId: deal.id, stage, ...values },
      {
        onSuccess: () => {
          setAsking(null);
          toast.success(t('toasts.moved', { name: deal.name, stage: t(`stages.${stage}`) }));
        },
      }
    );

  const move = (deal: MovingDeal, stage: DealStage) => {
    if (stage === 'lost' || stage === 'won' || !isOpenStage(deal.stage)) {
      setAsking({ deal, stage });
    } else {
      send(deal, stage);
    }
  };

  const close = (open: boolean) => {
    if (!open) setAsking(null);
  };
  const deal = asking?.deal;

  const dialogs = (
    <>
      <LostReasonDialog
        open={asking?.stage === 'lost'}
        onOpenChange={close}
        dealName={deal?.name ?? ''}
        initial={{
          lostReason: deal?.lostReason ?? undefined,
          lostNote: deal?.lostNote,
          competitor: deal?.competitor,
        }}
        fromWon={deal?.stage === 'won'}
        pending={update.isPending}
        onConfirm={(values) => deal && send(deal, 'lost', values)}
      />
      <WonDialog
        open={asking?.stage === 'won'}
        onOpenChange={close}
        dealName={deal?.name ?? ''}
        leadLabel={deal?.leadLabel ?? ''}
        amount={deal?.amount ?? null}
        fromLost={deal?.stage === 'lost'}
        pending={update.isPending}
        onConfirm={(values) => deal && send(deal, 'won', values)}
      />
      {asking && isOpenStage(asking.stage) && (
        <ReopenDialog
          open
          onOpenChange={close}
          deal={asking.deal}
          stage={asking.stage}
          onConfirm={() => send(asking.deal, asking.stage)}
        />
      )}
    </>
  );

  return { move, dialogs };
}
