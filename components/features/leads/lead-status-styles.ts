import type { LeadStatus } from '@/lib/features/leads/types';

/** Tailwind badge classes per lead status */
export const LEAD_STATUS_BADGE_CLASSES: Record<LeadStatus, string> = {
  new: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300',
  nurturing: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-300',
  negotiating: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300',
  won: 'bg-purple-100 text-purple-800 dark:bg-purple-500/15 dark:text-purple-300',
  lost: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
};

/** Chart / badge color names per lead status */
export const LEAD_STATUS_COLORS: Record<
  LeadStatus,
  'blue' | 'yellow' | 'emerald' | 'violet' | 'gray'
> = {
  new: 'blue',
  nurturing: 'yellow',
  negotiating: 'emerald',
  won: 'violet',
  lost: 'gray',
};
