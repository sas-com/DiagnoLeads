/**
 * Objection card of a lead (Refs #157): pick the playbook's objections and NG phrases that fit
 * why the lead's past attempt stopped. Pure functions.
 *
 * Signals of a reason, strongest first:
 * - hearing: the latest hearing's 進まなかった理由 (pastBlockers), the same values as the tags
 * - lostReason: why the lead was lost or put on hold (budget → budget, timing / on hold →
 *   priority, internal structure → staffing, competitor → vendor)
 * - diagnosis: the challenges chosen in the AX diagnosis (cost → budget, people → staffing,
 *   nobody knows how it works → risk)
 * Objections are shown only when one of their tags has a signal; NG phrases without tags are
 * general and always shown.
 */
import { OBJECTION_REASONS, type ObjectionReason } from '@/lib/features/ax-playbook/types/schemas';

export const SIGNAL_SOURCES = ['hearing', 'lostReason', 'diagnosis'] as const;
export type SignalSource = (typeof SIGNAL_SOURCES)[number];

export const LOST_REASON_TO_OBJECTION: Partial<Record<string, ObjectionReason>> = {
  budget: 'budget',
  timing: 'priority',
  on_hold: 'priority',
  internal_structure: 'staffing',
  competitor: 'vendor',
};

export const CHALLENGE_TO_OBJECTION: Partial<Record<string, ObjectionReason>> = {
  cost: 'budget',
  people: 'staffing',
  blackbox: 'risk',
};

export interface ObjectionSignal {
  reason: ObjectionReason;
  sources: SignalSource[];
}

const isReason = (value: unknown): value is ObjectionReason =>
  typeof value === 'string' && (OBJECTION_REASONS as readonly string[]).includes(value);

/** The reasons the lead shows, in the tags' order, each with where it came from */
export function collectSignals(input: {
  pastBlockers: readonly unknown[];
  lostReason: string | null;
  challenges: readonly string[];
}): ObjectionSignal[] {
  const sources = new Map<ObjectionReason, Set<SignalSource>>();
  const add = (reason: ObjectionReason | undefined, source: SignalSource) => {
    if (!reason) return;
    const set = sources.get(reason) ?? new Set<SignalSource>();
    set.add(source);
    sources.set(reason, set);
  };
  for (const blocker of input.pastBlockers) if (isReason(blocker)) add(blocker, 'hearing');
  if (input.lostReason) add(LOST_REASON_TO_OBJECTION[input.lostReason], 'lostReason');
  for (const challenge of input.challenges) add(CHALLENGE_TO_OBJECTION[challenge], 'diagnosis');
  return OBJECTION_REASONS.flatMap((reason) => {
    const set = sources.get(reason);
    return set ? [{ reason, sources: SIGNAL_SOURCES.filter((s) => set.has(s)) }] : [];
  });
}

const strength = (signal: ObjectionSignal) => SIGNAL_SOURCES.indexOf(signal.sources[0]);

/**
 * Rows whose tags have a signal, with the tags that matched; the ones backed by the strongest
 * source first, otherwise in the playbook's order
 */
export function pickObjections<T extends { reasons: readonly ObjectionReason[] }>(
  rows: readonly T[],
  signals: readonly ObjectionSignal[]
): (T & { matched: ObjectionReason[] })[] {
  const bySignal = new Map(signals.map((signal) => [signal.reason, signal]));
  return rows
    .map((row, index) => {
      const matched = row.reasons.filter((reason) => bySignal.has(reason));
      const best = Math.min(
        ...matched.map((reason) => strength(bySignal.get(reason) as ObjectionSignal))
      );
      return { row: { ...row, matched }, index, best };
    })
    .filter((entry) => entry.row.matched.length > 0)
    .sort((a, b) => a.best - b.best || a.index - b.index)
    .map((entry) => entry.row);
}

/** NG phrases: the general ones (no tags) and the ones whose tags have a signal */
export function pickNgPhrases<T extends { reasons: readonly ObjectionReason[] }>(
  rows: readonly T[],
  signals: readonly ObjectionSignal[]
): T[] {
  const reasons = new Set(signals.map((signal) => signal.reason));
  return rows.filter((row) => row.reasons.length === 0 || row.reasons.some((r) => reasons.has(r)));
}

/** The message for an open schedule: {date} replaced (every occurrence) */
export function scheduleFollowUpMessage(template: string, dateLabel: string): string {
  return template.split('{date}').join(dateLabel);
}
