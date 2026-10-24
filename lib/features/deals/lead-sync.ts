/**
 * How deals move their lead forward (Refs #435, Epic #430)
 *
 * Reports, the agency funnel, webhooks and the REST API read the lead's status, deal phase and
 * phase dates, so a change of a deal is reflected on its lead in the same transaction. The rules
 * live only here and move the lead forward, never back:
 * - Any deal makes the lead "has negotiated" (商談済み).
 * - The deal phase becomes the furthest phase any of the lead's deals stands for, and only when
 *   it is further than the lead's own; the first day of a phase is kept as before.
 * - The status is 成約 when a deal is won, 商談中 while a deal is open, 失注 when every deal is
 *   lost. A lead already 成約 stays 成約 (a later deal does not undo the earlier win).
 * - A lead that becomes 失注 without its own lost reason takes the one of its latest lost deal.
 * Deleting a deal changes nothing on the lead (a deletion is a correction; staff fix the lead).
 */
import {
  DEAL_PHASES,
  type DealPhase,
  type LeadStatus,
  type LostReason,
  lostReasonEnum,
} from '@/lib/features/leads/types/pipeline';

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
  lostReason?: LostReason;
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

/** The furthest phase of the deals, when it is further than the lead's current phase */
export function furtherPhase(current: string | null, deals: SyncDeal[]): DealPhase | null {
  let furthest: DealPhase | null = null;
  for (const deal of deals) {
    const phase = leadPhaseOfDeal(deal);
    if (phase && phaseIndex(phase) > phaseIndex(furthest)) furthest = phase;
  }
  return furthest && phaseIndex(furthest) > phaseIndex(current) ? furthest : null;
}

/** The status the deals give the lead; null to keep it (no deals, or already 成約) */
export function statusFromDeals(current: string, deals: SyncDeal[]): LeadStatus | null {
  if (deals.length === 0) return null;
  if (deals.some((deal) => deal.stage === 'won')) return 'won';
  if (current === 'won') return null;
  if (deals.some((deal) => deal.stage !== 'lost')) return 'negotiating';
  return 'lost';
}

/** Lost reason of the deal lost last (by close day, then by update) */
export function latestLostReason(deals: SyncDeal[]): LostReason | null {
  const lost = deals
    .filter((deal) => deal.stage === 'lost' && lostReasonEnum.safeParse(deal.lostReason).success)
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

  const phase = furtherPhase(lead.dealPhase, deals);
  if (phase) changes.dealPhase = phase;

  const status = statusFromDeals(lead.status, deals);
  if (status && status !== lead.status) changes.status = status;

  if ((changes.status ?? lead.status) === 'lost' && !lead.lostReason) {
    const reason = latestLostReason(deals);
    if (reason) changes.lostReason = reason;
  }
  return changes;
}
