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

/** A Japan calendar day moved by some days ('YYYY-MM-DD' in and out) */
export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Overdue tasks older than this many days get no notice (no flood of old ones at first run) */
export const OVERDUE_NOTICE_LOOKBACK_DAYS = 7;

export type DueNotice = 'due_soon' | 'overdue';

/**
 * Due dates each notice covers on a Japan calendar day (inclusive):
 * - due_soon: today and tomorrow (the day before the due date; today catches a task added after
 *   the day's run)
 * - overdue: from OVERDUE_NOTICE_LOOKBACK_DAYS days ago to yesterday
 */
export function dueNoticeWindows(today: string): Record<DueNotice, { from: string; to: string }> {
  return {
    due_soon: { from: today, to: addDays(today, 1) },
    overdue: { from: addDays(today, -OVERDUE_NOTICE_LOOKBACK_DAYS), to: addDays(today, -1) },
  };
}

/**
 * Who gets a task's notices: its assignee, else the lead's assignee (#135), else whoever created
 * it. Mirrors responsibleUserSql in ./service.ts.
 */
export function responsibleUserOf(task: {
  assigneeId: string | null;
  leadAssigneeId: string | null;
  createdBy: string | null;
}): string | null {
  return task.assigneeId ?? task.leadAssigneeId ?? task.createdBy;
}
