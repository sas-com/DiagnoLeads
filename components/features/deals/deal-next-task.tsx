'use client';

import { TAP_TARGET } from '@/components/common/tap-target';
import {
  DueLabel,
  TaskKindBadge,
  useTaskTitle,
} from '@/components/features/lead-follow-up/task-parts';
import { Button } from '@/components/ui/button';
import type { DealNextTask } from '@/lib/features/deals/service';
import { cn } from '@/lib/utils';
import { ListTodo, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';

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

/**
 * "Add a next action" on a board card and a list row (#853), and a row of 今日's deals that need
 * attention (#970), for an open deal marked for its lead
 * having none, to those who may change deals: it opens the screen's dialog. Outlined (the
 * screen's filled button is "create a deal"), 44px tall on phones, and named with the deal so
 * that a list of them can be told apart (its words are in its name, WCAG 2.5.3).
 */
export function AddNextActionButton({
  dealName,
  onAdd,
  className,
}: {
  dealName: string;
  /** With the button, which the focus goes back to when the dialog closes without adding */
  onAdd: (opener: HTMLElement) => void;
  className?: string;
}) {
  const t = useTranslations('deals.card');
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      // 44px on phones; from md, as compact as the card's move button
      className={cn(TAP_TARGET, 'md:h-8 md:px-2.5', className)}
      aria-label={t('addNextActionFor', { name: dealName })}
      onClick={(event) => onAdd(event.currentTarget)}
    >
      <Plus className="h-4 w-4" aria-hidden="true" />
      {t('addNextAction')}
    </Button>
  );
}
