'use client';

import type { DealView } from '@/lib/features/deals/service';
import {
  type DealStage,
  type OpenDealStage,
  STAGE_PROBABILITY,
  isOpenStage,
} from '@/lib/features/deals/types/pipeline';
import { trpc } from '@/lib/trpc/client';
import { useTranslations } from 'next-intl';
import { type ReactNode, useRef, useState } from 'react';
import { toast } from 'sonner';
import { LostReasonDialog, type LostValues } from './lost-reason-dialog';
import type { PendingMove } from './pending-moves';
import { ReopenDialog } from './reopen-dialog';
import { useDealMutations } from './use-deal-mutations';
import { WonDialog, type WonValues } from './won-dialog';

/** A deal to move, with its lead's company or name (empty when it has neither) */
export type MovingDeal = Pick<
  DealView,
  'id' | 'name' | 'stage' | 'amount' | 'probability' | 'lostReason' | 'lostNote' | 'competitor'
> & { leadLabel: string };

export interface MoveOptions {
  /** Puts the focus back where the move was chosen, once its question closes (Refs #720) */
  returnFocus?: () => void;
}

type OpenDeal = MovingDeal & { stage: OpenDealStage };

/** A move between open stages on its way: the deal as it was, and whether it undoes a move */
interface QuickMove {
  deal: OpenDeal;
  to: OpenDealStage;
  seq: number;
  undo: boolean;
}

/**
 * Moving a deal to another stage from the board or the deal page (Refs #436). Losing asks for the
 * reason, winning for the day and the amount (the lead becomes 成約 for good), and reopening a
 * won or lost deal for a confirmation. A move between open stages is made at once (#720): the
 * board shows it before the server answers (`pending`), the toast gives the new probability and
 * an undo, which puts the stage and the probability back, and a failure puts the card back. The
 * screen renders `dialogs`.
 *
 * The moves between open stages run as a mutation of their own, whose callbacks get every result:
 * the callbacks given to `mutate` only hear of the latest call, and moves can overlap.
 */
export function useStageMove(organizationId: string): {
  move: (deal: MovingDeal, stage: DealStage, options?: MoveOptions) => void;
  pending: ReadonlyMap<string, PendingMove>;
  dialogs: ReactNode;
} {
  const t = useTranslations('deals');
  const { update, refresh } = useDealMutations();
  const [asking, setAsking] = useState<{ deal: MovingDeal; stage: DealStage } | null>(null);
  const [pending, setPending] = useState<ReadonlyMap<string, PendingMove & { seq: number }>>(
    () => new Map()
  );
  const lastSeq = useRef(0);
  // Each deal's latest move: an older one that succeeds later offers no undo
  const latestMove = useRef(new Map<string, number>());
  // What each move between open stages was sent for, by the input object it was sent with
  const quickMoves = useRef(new WeakMap<object, QuickMove>());
  // The toast of each deal's last move: a newer move of the deal replaces it and its undo
  const undoToasts = useRef(new Map<string, string | number>());
  const returnFocus = useRef<(() => void) | undefined>(undefined);

  const movedMessage = (name: string, stage: DealStage, probability: number) =>
    isOpenStage(stage)
      ? t('toasts.movedTo', { name, stage: t(`stages.${stage}`), probability })
      : t('toasts.moved', { name, stage: t(`stages.${stage}`) });

  /** A new move of the deal: the undo of its last one no longer applies */
  const startMove = (dealId: string) => {
    const id = undoToasts.current.get(dealId);
    if (id !== undefined) toast.dismiss(id);
    undoToasts.current.delete(dealId);
    const seq = ++lastSeq.current;
    latestMove.current.set(dealId, seq);
    return seq;
  };

  /** Stop showing a move ahead, unless a newer move of the deal is shown */
  const settle = (dealId: string, seq: number) =>
    setPending((current) => {
      if (current.get(dealId)?.seq !== seq) return current;
      const next = new Map(current);
      next.delete(dealId);
      return next;
    });

  const quick = trpc.deals.update.useMutation({
    onSuccess: async (saved, input) => {
      await refresh();
      const sent = quickMoves.current.get(input);
      if (!sent) return;
      settle(sent.deal.id, sent.seq);
      if (sent.undo) {
        toast.success(
          t('toasts.moveUndone', { name: sent.deal.name, stage: t(`stages.${sent.to}`) })
        );
        return;
      }
      const message = movedMessage(sent.deal.name, sent.to, saved.probability);
      if (latestMove.current.get(sent.deal.id) !== sent.seq) {
        toast.success(message);
        return;
      }
      const moved = { ...sent.deal, stage: sent.to, probability: saved.probability };
      const before = { stage: sent.deal.stage, probability: sent.deal.probability };
      const id = toast.success(message, {
        action: { label: t('toasts.undo'), onClick: () => sendQuick(moved, before, true) },
      });
      undoToasts.current.set(sent.deal.id, id);
    },
    onError: (_error, input) => {
      toast.error(t('toasts.error'));
      const sent = quickMoves.current.get(input);
      if (sent) settle(sent.deal.id, sent.seq);
    },
  });

  /** Show the move at once and send it; an undo also puts back the probability the move reset */
  const sendQuick = (
    deal: OpenDeal,
    to: { stage: OpenDealStage; probability?: number },
    undo: boolean
  ) => {
    const seq = startMove(deal.id);
    const probability = to.probability ?? STAGE_PROBABILITY[to.stage];
    setPending((current) =>
      new Map(current).set(deal.id, { stage: to.stage, probability, at: new Date(), seq })
    );
    const input = {
      organizationId,
      dealId: deal.id,
      stage: to.stage,
      ...(to.probability === undefined ? {} : { probability: to.probability }),
    };
    quickMoves.current.set(input, { deal, to: to.stage, seq, undo });
    quick.mutate(input);
  };

  const send = (deal: MovingDeal, stage: DealStage, values?: LostValues | WonValues) => {
    startMove(deal.id);
    update.mutate(
      { organizationId, dealId: deal.id, stage, ...values },
      {
        onSuccess: () => {
          setAsking(null);
          // Reopening sets the stage's probability, as its question says
          toast.success(movedMessage(deal.name, stage, STAGE_PROBABILITY[stage]));
        },
      }
    );
  };

  const move = (deal: MovingDeal, stage: DealStage, options?: MoveOptions) => {
    if (stage === deal.stage) return;
    const from = deal.stage;
    if (isOpenStage(stage) && isOpenStage(from)) {
      sendQuick({ ...deal, stage: from }, { stage }, false);
      return;
    }
    returnFocus.current = options?.returnFocus;
    setAsking({ deal, stage });
  };

  const close = (open: boolean) => {
    if (!open) setAsking(null);
  };
  // The questions have no trigger to give the focus back to: the screen says where it goes
  const restoreFocus = (event: Event) => {
    const back = returnFocus.current;
    if (!back) return;
    event.preventDefault();
    returnFocus.current = undefined;
    back();
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
        onCloseAutoFocus={restoreFocus}
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
        onCloseAutoFocus={restoreFocus}
      />
      {asking && isOpenStage(asking.stage) && (
        <ReopenDialog
          open
          onOpenChange={close}
          deal={asking.deal}
          stage={asking.stage}
          onConfirm={() => send(asking.deal, asking.stage)}
          onCloseAutoFocus={restoreFocus}
        />
      )}
    </>
  );

  return { move, pending, dialogs };
}
