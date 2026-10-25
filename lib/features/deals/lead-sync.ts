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
 */
import {
  DEAL_PHASES,
  type DealPhase,
  type LeadStatus,
  type LostReason,
} from '@/lib/features/leads/types/pipeline';
import { dealLostReasonEnum } from './types/pipeline';

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
 * A lead won by hand before it had deals (成約, or a won phase) whose deals hold no win. Its
 * status would be computed back to 商談中 by an open deal, so the win is recorded first as a won
 * deal (createDeal refuses an open or lost one until then, #444).
 */
export function wonWithoutWonDeal(
  lead: Pick<SyncLead, 'status' | 'dealPhase'>,
  deals: Pick<SyncDeal, 'stage'>[]
): boolean {
  const won = lead.status === 'won' || WON_PHASES.includes(lead.dealPhase ?? '');
  return won && !deals.some((deal) => deal.stage === 'won');
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
