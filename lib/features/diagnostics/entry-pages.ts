/**
 * Pages a diagnosis can be started from, kept with the submission (tracking.entry) so that the
 * inflow of each landing page can be told apart (#296). No zod here: the diagnosis page imports it.
 */
export const AX_ENTRY_PAGES = ['ax-lp', 'ax-access-lp', 'ax-diagnosis'] as const;
export type AxEntryPage = (typeof AX_ENTRY_PAGES)[number];
