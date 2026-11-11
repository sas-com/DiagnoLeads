/**
 * How deals set their lead's status and deal phase (Refs #435, #444, Epic #430)
 *
 * Reports, the agency funnel, webhooks and the REST API read the lead's status, deal phase and
 * phase dates, so a change of a deal is reflected on its lead in the same transaction. A lead
 * with deals takes its status and deal phase from them, computed again on every change of a
 * deal, deleting one included; leads.update and the REST API refuse to change them by hand
 * (#444). The rules live only here:
 * - Any deal makes the lead "has negotiated" (商談済み); it stays so.
 * - The deal phase is the furthest phase the lead's deals stand for. It goes back too (a won
 *   deal reopened or deleted). When no deal stands for a phase (all lost, or only maintenance
 *   won), the lead keeps its phase. The first day of each phase is kept as before.
 * - The status is 成約 while a deal is won (a later deal does not undo it), else 商談中 while a
 *   deal is open, else 失注 (every deal lost). A lead with deals is never nurtured: a stalled deal
 *   is lost for timing, and the act timing follows the lead lost for timing (#151).
 * - A lead that becomes 失注 without its own lost reason, or with 保留 (not a loss, #445), takes
 *   the one of its latest lost deal; without one, its 保留 is dropped, as leads.update does (#459).
 *   The lost reason stays when the lead is negotiated again (the objection card reads it).
 * - When the last deal is deleted, the lead keeps what it has and can be changed by hand again.
 * - When the first meeting of a lead is set, it gets a deal in 見極め unless it has an open deal,
 *   is won, or has no deal and a phase set by hand past the initial hearing
 *   (qualificationDealSkip, #854).
 * - A deal created in the deal form starts where the lead stands (newDealStart, #951).
 */
import {
  DEAL_PHASES,
  type DealPhase,
  type LeadStatus,
  type LostReason,
} from '@/lib/features/leads/types/pipeline';
import {
  type DealKind,
  type DealStage,
  OPEN_DEAL_STAGES,
  dealLostReasonEnum,
  isOpenStage,
  nextDealKind,
} from './types/pipeline';

export interface SyncDeal {
  kind: string;
  stage: string;
  lostReason: string | null;
  /** Day the deal was closed (YYYY-MM-DD), for the latest lost reason */
  closedOn: string | null;
  updatedAt: Date;
}

export interface SyncLead {
  status: string;
  dealPhase: string | null;
  lostReason: string | null;
  hasNegotiated: boolean;
}

export interface LeadSyncChanges {
  status?: LeadStatus;
  dealPhase?: DealPhase;
  /** null drops the lead's 保留 */
  lostReason?: LostReason | null;
  hasNegotiated?: true;
}

/** The lead's deal phase a deal stands for; null when it says nothing about the phase */
export function leadPhaseOfDeal(deal: Pick<SyncDeal, 'kind' | 'stage'>): DealPhase | null {
  switch (deal.stage) {
    case 'qualification':
      return 'initial_hearing';
    case 'discovery':
      return 'simple_diagnosis';
    case 'proposal':
    case 'negotiation':
      return 'proposal';
    case 'won':
      if (deal.kind === 'survey') return 'survey_won';
      if (deal.kind === 'migration') return 'migration_won';
      if (deal.kind === 'ax') return 'ax';
      return null;
    default:
      return null;
  }
}

const phaseIndex = (phase: string | null): number =>
  phase ? (DEAL_PHASES as readonly string[]).indexOf(phase) : -1;

/** The furthest phase the deals stand for; null when none stands for a phase */
export function phaseFromDeals(deals: SyncDeal[]): DealPhase | null {
  let furthest: DealPhase | null = null;
  for (const deal of deals) {
    const phase = leadPhaseOfDeal(deal);
    if (phase && phaseIndex(phase) > phaseIndex(furthest)) furthest = phase;
  }
  return furthest;
}

/** The status the deals give the lead; null without deals (the lead keeps its own) */
export function statusFromDeals(deals: SyncDeal[]): LeadStatus | null {
  if (deals.length === 0) return null;
  if (deals.some((deal) => deal.stage === 'won')) return 'won';
  if (deals.some((deal) => deal.stage !== 'lost')) return 'negotiating';
  return 'lost';
}

/** Deal phases of a won deal (現行調査受注 / 移行受注 / AX化) */
const WON_PHASES: readonly string[] = ['survey_won', 'migration_won', 'ax'];

/**
 * A lead won by hand before it had deals (成約, or a won phase), with no deal yet. Its status would
 * be computed back to 商談中 by an open deal, so the win is recorded first as a won deal
 * (createDeal refuses an open or lost one until then, #444). A lead with deals is computed from
 * them: a won phase left by a won deal since lost, or deleted while other deals stay, is not a win
 * by hand, and the lead takes an open deal again (#977). With its last deal deleted, the lead has
 * no deal and keeps its values, so a win left on it is recorded first again.
 */
export function wonWithoutWonDeal(
  lead: Pick<SyncLead, 'status' | 'dealPhase'>,
  deals: Pick<SyncDeal, 'stage'>[]
): boolean {
  if (deals.length > 0) return false;
  return lead.status === 'won' || WON_PHASES.includes(lead.dealPhase ?? '');
}

/** Where a new deal of a lead starts in the deal form (#951) */
export interface NewDealStart {
  stage: DealStage;
  /**
   * The kind of the win the lead's phase stands for, or the kind that comes after the deal the
   * new one follows (#978); null to keep the form's own
   */
  kind: DealKind | null;
  /** Only a won deal can be created (wonWithoutWonDeal): createDeal refuses any other stage */
  wonFirst: boolean;
  /** The won deal the new one follows (#978): the one no other goes on from yet, if one */
  previousDealId: string | null;
}

/** A deal of the lead, as newDealStart reads it */
export interface NewDealStartDeal {
  id: string;
  kind: string;
  stage: string;
  previousDealId: string | null;
}

/** Kinds whose won deal stands for a phase of the lead (現行調査受注 / 移行受注 / AX化) */
const WON_PHASE_KINDS = ['survey', 'migration', 'ax'] as const satisfies readonly DealKind[];

/**
 * Where a new deal of a lead starts in the deal form (#951), so that saving it as it opens is
 * accepted and takes nothing back from the lead: leadPhaseOfDeal read the other way.
 * - A lead won by hand without a won deal (wonWithoutWonDeal) starts with its win, 受注 of the
 *   kind its phase stands for: createDeal takes no other stage until the win is a deal.
 * - A lead without deals starts at its deal phase (提案, 課題の確認): a deal in 見極め would take
 *   the phase back to the initial hearing.
 * - Otherwise 見極め. With deals, the phase is the furthest of them; when all are lost, the new deal
 *   is the lead's time come again and starts over, as for its first meeting
 *   (qualificationDealSkip).
 * - After a win, the new deal follows the won survey or migration no deal of the chain (a survey,
 *   a migration, AX) goes on from yet, when there is just one, and is of the kind that comes after
 *   it: the migration after the survey, AX after the migration (#978). A deal lost since does not
 *   count, so a migration tried again follows the survey too; nor does maintenance or another kind
 *   in between, so AX still follows the migration. Other wins (AX, maintenance) are followed only
 *   when chosen in the form.
 */
export function newDealStart(
  lead: Pick<SyncLead, 'status' | 'dealPhase'>,
  deals: NewDealStartDeal[]
): NewDealStart {
  if (wonWithoutWonDeal(lead, deals)) {
    const kind = WON_PHASE_KINDS.find(
      (each) => leadPhaseOfDeal({ kind: each, stage: 'won' }) === lead.dealPhase
    );
    return { stage: 'won', kind: kind ?? null, wonFirst: true, previousDealId: null };
  }
  const stage =
    deals.length === 0
      ? OPEN_DEAL_STAGES.find(
          (each) => leadPhaseOfDeal({ kind: 'other', stage: each }) === lead.dealPhase
        )
      : undefined;
  const notGoneOn = deals.filter(
    (deal) =>
      deal.stage === 'won' &&
      nextDealKind(deal.kind) !== undefined &&
      !deals.some(
        (other) =>
          other.previousDealId === deal.id &&
          other.stage !== 'lost' &&
          (WON_PHASE_KINDS as readonly string[]).includes(other.kind)
      )
  );
  const previous = notGoneOn.length === 1 ? notGoneOn[0] : undefined;
  return {
    stage: stage ?? 'qualification',
    kind: previous ? (nextDealKind(previous.kind) ?? null) : null,
    wonFirst: false,
    previousDealId: previous?.id ?? null,
  };
}

/** Why a lead whose first meeting was set gets no deal in 見極め (#854) */
export type QualificationDealSkip = 'open_deal' | 'won' | 'phase_ahead';

/**
 * Whether the first meeting of a lead creates its deal in 見極め (#854, decision
 * `2026-10-28-auto-qualification-deal`); null to create one. Not created for a lead with an open
 * deal (one deal whatever the entry point), nor for a won lead (a won deal, or won by hand without
 * deals, see wonWithoutWonDeal): its next deal (the migration, AX) is created by sales, who choose
 * its kind and the deal it follows. Nor for a lead without deals whose deal phase was set by hand
 * past the initial hearing: the deal would take it back to the initial hearing. A lead whose deals
 * are all lost gets one (its time has come again, decision `2026-10-25-deals-set-lead-stage`), even
 * with a phase past the initial hearing or a won phase left by a won deal lost or deleted since
 * (#977).
 */
export function qualificationDealSkip(
  lead: Pick<SyncLead, 'status' | 'dealPhase'>,
  deals: Pick<SyncDeal, 'stage'>[]
): QualificationDealSkip | null {
  if (deals.some((deal) => isOpenStage(deal.stage))) return 'open_deal';
  if (deals.some((deal) => deal.stage === 'won') || wonWithoutWonDeal(lead, deals)) return 'won';
  if (deals.length === 0 && phaseIndex(lead.dealPhase) > phaseIndex('initial_hearing')) {
    return 'phase_ahead';
  }
  return null;
}

/** Lost reason of the deal lost last (by close day, then by update) */
export function latestLostReason(deals: SyncDeal[]): LostReason | null {
  const lost = deals
    .filter(
      (deal) => deal.stage === 'lost' && dealLostReasonEnum.safeParse(deal.lostReason).success
    )
    .sort(
      (a, b) =>
        (b.closedOn ?? '').localeCompare(a.closedOn ?? '') ||
        b.updatedAt.getTime() - a.updatedAt.getTime()
    );
  return (lost[0]?.lostReason as LostReason | undefined) ?? null;
}

/** What to write on the lead for its deals; empty when the lead is already up to date */
export function leadChangesFromDeals(lead: SyncLead, deals: SyncDeal[]): LeadSyncChanges {
  if (deals.length === 0) return {};
  const changes: LeadSyncChanges = {};
  if (!lead.hasNegotiated) changes.hasNegotiated = true;

  const phase = phaseFromDeals(deals);
  if (phase && phase !== lead.dealPhase) changes.dealPhase = phase;

  const status = statusFromDeals(deals);
  if (status && status !== lead.status) changes.status = status;

  const ownReason = lead.lostReason === 'on_hold' ? null : lead.lostReason;
  if ((changes.status ?? lead.status) === 'lost' && !ownReason) {
    const reason = latestLostReason(deals);
    if (reason) changes.lostReason = reason;
    // Only data written around the API has a lost deal without a reason; never leave 失注 + 保留
    else if (lead.lostReason === 'on_hold') changes.lostReason = null;
  }
  return changes;
}
