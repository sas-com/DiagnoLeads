'use client';

import { TAP_TARGET } from '@/components/common/tap-target';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ContactRecordMenu } from './contact-record-menu';
import type { OpenRowActivity } from './row-activity-dialog';
import { CheckWithText, DueLabel, TaskKindBadge, useTaskTitle, useUpdateTask } from './task-parts';
import type { DueTasks } from './use-due-tasks';

/** The lead of a row: an underlined link */
const LEAD_LINK_CLASS =
  'text-sm text-brand-700 underline underline-offset-4 hover:text-brand-800 dark:text-brand-300';

/**
 * The due next actions and takeaways (Refs #85), each with its due date and lead; ticking one
 * completes it. Shared by the dashboard's card and the 今日 screen (#556), which show their own
 * loading, failure and empty states around it. Sized for DADS (decision 2026-10-24-admin-dads):
 * no text under 14px, the box is 20px to see and 44px to tap, the lead an underlined link.
 * A row ticked shows ticked and disabled until it leaves once done (it can be ticked again when
 * the save fails), and the focus goes on at once to the next row's box, else the previous one's,
 * else to the heading, rather than to the page (#776). Only the rows being completed are
 * disabled, as a disabled box loses the focus. A row's "Record an activity" opens the screen's
 * one dialog, which it keeps outside this list (#998).
 */
export function DueTasksList({
  due,
  organizationId,
  showMineBadge,
  onRecordActivity,
  headingId,
}: {
  due: DueTasks;
  organizationId: string;
  /** Mark the user's own ones (when everyone's are listed) */
  showMineBadge: boolean;
  /**
   * Given to those who may edit leads: each row gets the menu to record a contact with its lead
   * (今日, #863), whose "Record an activity" opens the screen's dialog for the lead (#998, see
   * RowActivityDialog). Without it the rows are as the dashboard's card shows them
   */
  onRecordActivity?: OpenRowActivity;
  /** The section's heading (focusable by script), where the focus goes when the list empties */
  headingId?: string;
}) {
  const t = useTranslations('leadFollowUp.today');
  const tTasks = useTranslations('leadFollowUp.tasks');
  const locale = useLocale();
  const titleOf = useTaskTitle();
  const update = useUpdateTask(organizationId);
  // The rows being completed, and each row's box to send the focus to
  const [completing, setCompleting] = useState<ReadonlySet<string>>(new Set());
  const boxes = useRef(new Map<string, HTMLButtonElement>());
  const shownIds = due.items.map((task) => task.id).join(' ');
  // A row completed has left once the list is read again: forget it (it may come back reopened)
  useEffect(() => {
    const shown = new Set(shownIds.split(' '));
    setCompleting((current) => {
      const kept = [...current].filter((id) => shown.has(id));
      return kept.length === current.size ? current : new Set(kept);
    });
  }, [shownIds]);
  const data = due.data;
  if (!data) return null;

  const complete = (index: number) => {
    const task = due.items[index];
    const open = (item: { id: string }) => item.id !== task.id && !completing.has(item.id);
    const next =
      due.items.slice(index + 1).find(open) ?? due.items.slice(0, index).reverse().find(open);
    const target = next
      ? boxes.current.get(next.id)
      : headingId
        ? document.getElementById(headingId)
        : null;
    target?.focus();
    setCompleting((current) => new Set(current).add(task.id));
    // The call's own promise: the callbacks given to mutate() run for the latest call only, so a
    // row ticked before another would stay disabled if its save failed. The hook toasts the
    // failure; the row can then be ticked again
    update.mutateAsync({ organizationId, id: task.id, done: true }).catch(() =>
      setCompleting((current) => {
        const rest = new Set(current);
        rest.delete(task.id);
        return rest;
      })
    );
  };

  return (
    <>
      <ul id={due.listId} className="divide-y divide-gray-100 dark:divide-gray-800">
        {due.items.map((task, index) => {
          const title = titleOf(task);
          const company = task.lead.company?.trim();
          const name = task.lead.name?.trim();
          const leadName = company || name || t('noLeadName');
          const leadHref = `/${locale}/leads/${task.leadId}`;
          const leadText = (
            <>
              {leadName}
              {company && name && (
                <span className="ml-1 text-gray-600 dark:text-gray-300">{name}</span>
              )}
            </>
          );
          return (
            <li key={task.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
              <Checkbox
                ref={(box) => {
                  if (box) boxes.current.set(task.id, box);
                  else boxes.current.delete(task.id);
                }}
                // 20px to see and 44px to tap: the ::after reaches 13px around the 18px inside
                // the 1px border
                className="relative h-5 w-5 after:absolute after:-inset-[13px] after:content-['']"
                checked={completing.has(task.id)}
                disabled={!data.canEdit || completing.has(task.id)}
                aria-label={tTasks('markDone', { title })}
                onCheckedChange={() => complete(index)}
              />
              <DueLabel task={task} today={data.today} className="text-sm" />
              <TaskKindBadge task={task} className="text-sm" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900 dark:text-gray-50">
                {title}
              </span>
              {showMineBadge && task.mine && (
                <span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-sm font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                  {t('mineBadge')}
                </span>
              )}
              {/* On its own line on phones, indented past the box's tap area like the line below;
                  the menu to record a contact goes with it, at the end of the line. From sm the
                  two take at most 45% of the row, the lead's name cut first, so the title keeps
                  its room and the menu stays at the end */}
              {onRecordActivity ? (
                <div className="flex min-w-0 basis-full items-center gap-2 pl-8 sm:max-w-[45%] sm:basis-auto sm:pl-0">
                  {/* 44px to tap on phones, like the menu beside it */}
                  <Link
                    href={leadHref}
                    className={cn('flex min-w-0 items-center', LEAD_LINK_CLASS, TAP_TARGET)}
                  >
                    <span className="block truncate">{leadText}</span>
                  </Link>
                  <ContactRecordMenu
                    organizationId={organizationId}
                    leadId={task.leadId}
                    leadLabel={leadName}
                    onRecordActivity={onRecordActivity}
                    className="ml-auto shrink-0"
                  />
                </div>
              ) : (
                <Link
                  href={leadHref}
                  className={cn('basis-full truncate pl-8 sm:basis-auto sm:pl-0', LEAD_LINK_CLASS)}
                >
                  {leadText}
                </Link>
              )}
              <CheckWithText task={task} className="basis-full pl-8 text-sm" />
            </li>
          );
        })}
      </ul>
      {due.loadingRest && <Skeleton className="mt-2 h-10 w-full" />}
    </>
  );
}

/**
 * "N more" under the list, and once opened a way back, also when the rest failed to load (so
 * the screens show it under their failure too). Nothing when all are listed
 */
export function DueTasksMore({ due }: { due: DueTasks }) {
  const t = useTranslations('leadFollowUp.today');
  if (!due.showToggle) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center justify-end gap-x-3 text-sm text-gray-600 dark:text-gray-300">
      {/* Past DUE_TASKS_MAX the rest stays a count */}
      {due.expanded && due.listShown && !due.loadingRest && due.rest > 0 && (
        <span>{t('more', { count: due.rest })}</span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn('h-auto px-1 py-0.5 text-sm text-gray-600 dark:text-gray-300', TAP_TARGET)}
        aria-expanded={due.expanded}
        aria-controls={due.listShown ? due.listId : undefined}
        onClick={() => due.setExpanded((value) => !value)}
      >
        {due.expanded ? t('showLess') : t('more', { count: due.rest })}
        {due.expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
      </Button>
    </div>
  );
}
