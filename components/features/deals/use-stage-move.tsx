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

/** How long a toast with an undo stays: time to reach its button from the keyboard (#720) */
const UNDO_TOAST_MS = 10_000;

/** A deal to move, with its lead's company or name (empty when it has neither) */
export type MovingDeal = Pick<
  DealView,
  'id' | 'name' | 'stage' | 'amount' | 'probability' | 'lostReason' | 'lostNote' | 'competitor'
> & { leadLabel: string };

export interface MoveOptions {
  /**
   * Puts the focus back where the move was chosen, once its question closes (Refs #720); false
   * when that place is gone, and the question then puts the focus back as it does on its own
   */
  returnFocus?: () => boolean;
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
 * reason, winning for the day and the amount, and reopening a won or lost deal for a confirmation;
 * the won and lost questions say a failed save in place (#720). A move between open stages is
 * made at once (#720): the board shows it before the server answers (`pending`), the toast gives
 * the new probability and an undo, which puts the stage and the probability back, and a failure
 * puts the card back and says where it is. A move that handed the lead off offers no undo: the
 * handoff sheet went out, which a move back does not take back. A move overtaken by a newer move
 * of the same deal says nothing, as the newer one tells where the deal is. The screen renders
 * `dialogs`.
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
  const { update, refresh } = useDealMutations({ toastErrors: false });
  const [asking, setAsking] = useState<{ deal: MovingDeal; stage: DealStage } | null>(null);
  // The won or lost question could not be saved: it says so and stays open
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState<ReadonlyMap<string, PendingMove & { seq: number }>>(
    () => new Map()
  );
  const lastSeq = useRef(0);
  // Each deal's latest move: an older one that answers later says nothing
  const latestMove = useRef(new Map<string, number>());
  // What each move between open stages was sent for, by the input object it was sent with
  const quickMoves = useRef(new WeakMap<object, QuickMove>());
  // The moves of each deal on their way, and the stage the server holds meanwhile: where a
  // failed move leaves the deal (an older move of it may have failed, or not answered yet)
  const onTheWay = useRef(new Map<string, { moves: number; stage: OpenDealStage }>());
  // The toast of each deal's last move: a newer move of the deal replaces it and its undo
  const undoToasts = useRef(new Map<string, string | number>());
  const returnFocus = useRef<(() => boolean) | undefined>(undefined);

  const stageName = (stage: DealStage) => t(`stages.${stage}`);

  /** What a move says: the new probability between open stages, and a handoff it made */
  const movedMessage = (
    name: string,
    stage: DealStage,
    probability: number,
    handedOff: boolean
  ) => {
    if (!isOpenStage(stage)) {
      return t(handedOff ? 'toasts.movedHandedOff' : 'toasts.moved', {
        name,
        stage: stageName(stage),
      });
    }
    return t(handedOff ? 'toasts.movedToHandedOff' : 'toasts.movedTo', {
      name,
      stage: stageName(stage),
      probability,
    });
  };

  /** A new move of the deal: the undo of its last one no longer applies */
  const startMove = (dealId: string) => {
    const id = undoToasts.current.get(dealId);
    if (id !== undefined) toast.dismiss(id);
    undoToasts.current.delete(dealId);
    const seq = ++lastSeq.current;
    latestMove.current.set(dealId, seq);
    return seq;
  };
  const isLatest = (dealId: string, seq: number) => latestMove.current.get(dealId) === seq;

  /** Stop showing a move ahead, unless a newer move of the deal is shown */
  const settle = (dealId: string, seq: number) =>
    setPending((current) => {
      if (current.get(dealId)?.seq !== seq) return current;
      const next = new Map(current);
      next.delete(dealId);
      return next;
    });

  /** A move of the deal answered: the stage the server holds now (`made` when it was made) */
  const answered = (dealId: string, made?: OpenDealStage): OpenDealStage | undefined => {
    const way = onTheWay.current.get(dealId);
    if (!way) return made;
    const stage = made ?? way.stage;
    if (way.moves > 1) onTheWay.current.set(dealId, { moves: way.moves - 1, stage });
    else onTheWay.current.delete(dealId);
    return stage;
  };

  const quick = trpc.deals.update.useMutation({
    onSuccess: async (saved, input) => {
      const sent = quickMoves.current.get(input);
      if (sent) answered(sent.deal.id, sent.to);
      await refresh();
      if (!sent) return;
      settle(sent.deal.id, sent.seq);
      const latest = isLatest(sent.deal.id, sent.seq);
      // A newer move of the deal tells where it is; a handoff is told all the same
      if (!latest && !saved.handedOff) return;
      const message =
        sent.undo && !saved.handedOff
          ? t('toasts.moveUndone', { name: sent.deal.name, stage: stageName(sent.to) })
          : movedMessage(sent.deal.name, sent.to, saved.probability, saved.handedOff);
      // The handoff sheet that went out is not taken back by a move back: no undo then
      if (!latest || sent.undo || saved.handedOff) {
        toast.success(message);
        return;
      }
      const moved = { ...sent.deal, stage: sent.to, probability: saved.probability };
      const before = { stage: sent.deal.stage, probability: sent.deal.probability };
      const id = toast.success(message, {
        action: { label: t('toasts.undo'), onClick: () => sendQuick(moved, before, true) },
        duration: UNDO_TOAST_MS,
      });
      undoToasts.current.set(sent.deal.id, id);
    },
    onError: (_error, input) => {
      const sent = quickMoves.current.get(input);
      if (!sent) {
        toast.error(t('toasts.error'));
        return;
      }
      const now = stageName(answered(sent.deal.id) ?? sent.deal.stage);
      settle(sent.deal.id, sent.seq);
      // A newer move of the deal tells where it is
      if (!isLatest(sent.deal.id, sent.seq)) return;
      toast.error(
        sent.undo
          ? t('toasts.undoFailed', { name: sent.deal.name, stage: now })
          : t('toasts.moveFailed', {
              name: sent.deal.name,
              stage: stageName(sent.to),
              from: now,
            })
      );
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
    const way = onTheWay.current.get(deal.id);
    onTheWay.current.set(deal.id, {
      moves: (way?.moves ?? 0) + 1,
      stage: way?.stage ?? deal.stage,
    });
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
    setFailed(false);
    update.mutate(
      { organizationId, dealId: deal.id, stage, ...values },
      {
        onSuccess: (saved) => {
          setAsking(null);
          // Reopening sets the stage's probability, as its question says
          toast.success(movedMessage(deal.name, stage, STAGE_PROBABILITY[stage], saved.handedOff));
        },
        onError: () => {
          // The won and lost questions stay open and say it; a reopening's question has closed
          if (!isOpenStage(stage)) {
            setFailed(true);
            return;
          }
          toast.error(
            t('toasts.moveFailed', {
              name: deal.name,
              stage: stageName(stage),
              from: stageName(deal.stage),
            })
          );
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
    setFailed(false);
    setAsking({ deal, stage });
  };

  const close = (open: boolean) => {
    if (!open) setAsking(null);
  };
  // The questions have no trigger to give the focus back to: the screen says where it goes, and
  // when that place is gone the question puts the focus back as it does on its own
  const restoreFocus = (event: Event) => {
    const back = returnFocus.current;
    returnFocus.current = undefined;
    if (back?.()) event.preventDefault();
  };
  const deal = asking?.deal;
  const saveError = failed ? t('form.saveError') : null;

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
        error={saveError}
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
        error={saveError}
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
