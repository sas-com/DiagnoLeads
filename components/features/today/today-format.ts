/**
 * What the 今日 screen (#556) makes of the data it reads: the week's meetings split into today and
 * the rest of the week, the counts of the day's contacts by kind, and the deals that need
 * attention. Days are Japan calendar days ('YYYY-MM-DD'), compared as text.
 */

import { type DealMarkFlags, dealMarks } from '@/components/features/deals/deal-format';
import { CONTACT_KINDS, type ContactKind } from '@/lib/features/lead-follow-up/types/schemas';

/**
 * Meetings of today and of the rest of the week (tomorrow to Sunday), each in the order given.
 * A passed day is in neither: the server leaves those out already
 */
export function splitMeetings<T extends { nextMeetingDate: string }>(
  items: readonly T[],
  today: string
): { today: T[]; later: T[] } {
  return {
    today: items.filter((item) => item.nextMeetingDate === today),
    later: items.filter((item) => item.nextMeetingDate > today),
  };
}

/**
 * How a lead is named in a row, the same in every section: its company, else its person (null
 * when it has neither: the screen says it has no name), with the person under a company
 */
export function leadLabel(lead: { company: string | null; name: string | null }): {
  primary: string | null;
  secondary: string | null;
} {
  const company = lead.company?.trim() || null;
  const name = lead.name?.trim() || null;
  return { primary: company ?? name, secondary: company && name ? name : null };
}

/** How many contacts of each kind, every kind in the order the screens list them */
export function contactCounts(
  byKind: Partial<Record<ContactKind, number>>
): { kind: ContactKind; count: number }[] {
  return CONTACT_KINDS.map((kind) => ({ kind, count: byKind[kind] ?? 0 }));
}

/**
 * The deals with a mark (Refs #436), the earliest expected close date first and those without one
 * last (otherwise in the order given). A passed close date is before every other, so the deals
 * past it come first, then those whose lead has no open next action. Closed deals are never
 * marked, so they never show
 */
export function dealsNeedingAttention<
  T extends { stage: string; expectedCloseOn: string | null; hasOpenTask: boolean },
>(deals: readonly T[], today: string): { deal: T; flags: DealMarkFlags }[] {
  return deals
    .map((deal) => ({ deal, flags: dealMarks(deal, today) }))
    .filter(({ flags }) => flags.overdue || flags.noNextAction)
    .sort((a, b) => byCloseDate(a.deal.expectedCloseOn, b.deal.expectedCloseOn));
}

/** Earlier days first, no day last ('YYYY-MM-DD' compares as text) */
function byCloseDate(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}
