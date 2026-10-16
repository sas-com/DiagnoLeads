/**
 * Pure helpers of the follow-up: due status of a next action and the next meeting date of a
 * hearing (Refs #85)
 */

import { ISO_DATE_PATTERN } from '@/lib/features/lead-hearings/types/schemas';

export type TaskDue = 'done' | 'overdue' | 'today' | 'upcoming';

/** How a next action stands on a Japan calendar day (both 'YYYY-MM-DD') */
export function taskDue(task: { dueOn: string; done: boolean }, today: string): TaskDue {
  if (task.done) return 'done';
  if (task.dueOn < today) return 'overdue';
  if (task.dueOn === today) return 'today';
  return 'upcoming';
}

/** Open first by due date, then done ones (latest done first) */
export function sortTasks<T extends { dueOn: string; done: boolean; completedAt: Date | null }>(
  tasks: T[]
): T[] {
  return [...tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (!a.done) return a.dueOn.localeCompare(b.dueOn);
    return (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0);
  });
}

/** The next meeting date a hearing records ('YYYY-MM-DD'), or null when it has none */
export function nextMeetingDateOf(fields: unknown): string | null {
  if (typeof fields !== 'object' || fields === null) return null;
  const entry = (fields as Record<string, unknown>).nextMeetingDate;
  if (typeof entry !== 'object' || entry === null) return null;
  const value = (entry as Record<string, unknown>).value;
  return typeof value === 'string' && ISO_DATE_PATTERN.test(value) ? value : null;
}
