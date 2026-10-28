'use client';

import {
  DueLabel,
  TaskKindBadge,
  useTaskTitle,
} from '@/components/features/lead-follow-up/task-parts';
import type { DealNextTask } from '@/lib/features/deals/service';
import { cn } from '@/lib/utils';
import { ListTodo } from 'lucide-react';

/**
 * A deal's next action on its board card and list row (#853): the lead's open task due first,
 * with its due date (coloured when it is due today or passed), a takeaway's mark and its title.
 * The screens show it for open deals only. It comes from the value that also marks a deal
 * without a next action (DealCard.hasOpenTask), so the two are never shown together. Where no
 * column header names it (the board's cards), the icon of the next actions' card heads it, with
 * its name for screen readers. No text under 14px (decision 2026-10-24-admin-dads).
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
  /** Its name where no column header names it (the board's cards): an icon, and words read out */
  label?: string;
  className?: string;
}) {
  const titleOf = useTaskTitle();
  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex flex-wrap items-center gap-1">
        {/* In the row, so that they add no space above it */}
        {label && (
          <>
            <ListTodo className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">{label}</span>
          </>
        )}
        <DueLabel task={{ ...task, done: false }} today={today} className="text-sm" />
        <TaskKindBadge task={task} className="text-sm" />
      </div>
      <p className="line-clamp-2 break-words text-gray-700 dark:text-gray-300">{titleOf(task)}</p>
    </div>
  );
}
