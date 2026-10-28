'use client';

import {
  DueLabel,
  TaskKindBadge,
  useTaskTitle,
} from '@/components/features/lead-follow-up/task-parts';
import type { DealNextTask } from '@/lib/features/deals/service';
import { cn } from '@/lib/utils';

/**
 * A deal's next action on its board card and list row (#853): the lead's open task due first,
 * with its due date (coloured when it is due today or passed), a takeaway's mark and its title.
 * The screens show it for open deals only. It comes from the value that also marks a deal
 * without a next action (DealCard.hasOpenTask), so the two are never shown together. No text
 * under 14px (decision 2026-10-24-admin-dads).
 */
export function DealNextTaskSummary({
  task,
  today,
  label,
  className,
}: {
  task: DealNextTask;
  /** Japan calendar day the board was read on */
  today: string;
  /** Said first to screen readers where no column header names it (the board's cards) */
  label?: string;
  className?: string;
}) {
  const titleOf = useTaskTitle();
  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex flex-wrap items-center gap-1">
        {/* In the row, so that it adds no space above it */}
        {label && <span className="sr-only">{label}</span>}
        <DueLabel task={{ ...task, done: false }} today={today} className="text-sm" />
        <TaskKindBadge task={task} className="text-sm" />
      </div>
      <p className="line-clamp-2 break-words text-gray-700 dark:text-gray-300">{titleOf(task)}</p>
    </div>
  );
}
