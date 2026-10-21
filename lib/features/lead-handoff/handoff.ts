/**
 * Handoff sheet of the first meeting (Refs #86): when a deal moves on from the initial hearing,
 * what sales heard goes to the technical team on one sheet, so they do not ask again.
 *
 * The sheet itself is read live from the latest hearing summary (#97) and the open takeaways
 * (#85), so it never goes stale; what is stored is only when the deal moved on (the first date
 * of a later deal phase, already kept in leads.deal_phase_reached_at).
 */
import { DEAL_PHASES, type DealPhase } from '@/lib/features/leads/types/pipeline';

/** At most this many members receive the handoff sheets (one email each per handoff) */
export const MAX_HANDOFF_RECIPIENTS = 10;

/** Deal phases after the initial hearing: reaching one hands the deal over */
export const HANDOFF_PHASES = DEAL_PHASES.filter(
  (phase): phase is Exclude<DealPhase, 'initial_hearing'> => phase !== 'initial_hearing'
);

const isDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** The day the deal moved on from the initial hearing (YYYY-MM-DD), or null */
export function handedOffOn(reachedAt: unknown): string | null {
  if (!reachedAt || typeof reachedAt !== 'object') return null;
  const dates = HANDOFF_PHASES.map((phase) => (reachedAt as Record<string, unknown>)[phase])
    .filter(isDate)
    .sort();
  return dates[0] ?? null;
}

/** Whether an update moved the deal on from the initial hearing for the first time */
export function isFirstHandoff(before: unknown, after: unknown): boolean {
  return handedOffOn(before) === null && handedOffOn(after) !== null;
}

export interface HandoffNoticeInput {
  leadId: string;
  leadName: string | null;
  company: string | null;
  /** Who moved the deal on */
  movedByName: string | null;
}

/**
 * Title, message and link of the notice. Only who and where: the sheet's contents (what the
 * customer said) never go into a notification or an email, only the link to it.
 */
export function buildHandoffNotice(
  n: HandoffNoticeInput,
  appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
) {
  const who = [n.company, n.leadName ? `${n.leadName} 様` : null].filter(Boolean).join(' ');
  const target = who || 'リード';
  const title = `【引き継ぎ】${target} の引き継ぎ書ができました`;
  const by = n.movedByName ? `${n.movedByName} さんが` : '';
  const message = `${by}${target} の商談を初回ヒアリングから次の段階へ進めました。引き継ぎ書を開いて、聞いた内容を確認してください。`;
  const url = `${appUrl}/ja/leads/${n.leadId}/handoff`;
  return { title, message, url };
}
