'use client';

import { TAP_TARGET } from '@/components/common/tap-target';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { ContactRecordMenu } from './contact-record-menu';
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
 */
export function DueTasksList({
  due,
  organizationId,
  showMineBadge,
  canRecordContact = false,
}: {
  due: DueTasks;
  organizationId: string;
  /** Mark the user's own ones (when everyone's are listed) */
  showMineBadge: boolean;
  /**
   * With permission to edit leads, each row gets the menu to record a contact with its lead
   * (今日, #863); without it the rows are as the dashboard's card shows them
   */
  canRecordContact?: boolean;
}) {
  const t = useTranslations('leadFollowUp.today');
  const tTasks = useTranslations('leadFollowUp.tasks');
  const locale = useLocale();
  const titleOf = useTaskTitle();
  const update = useUpdateTask(organizationId);
  const data = due.data;
  if (!data) return null;

  return (
    <>
      <ul id={due.listId} className="divide-y divide-gray-100 dark:divide-gray-800">
        {due.items.map((task) => {
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
                // 20px to see and 44px to tap: the ::after reaches 13px around the 18px inside
                // the 1px border
                className="relative h-5 w-5 after:absolute after:-inset-[13px] after:content-['']"
                checked={false}
                disabled={!data.canEdit || update.isPending}
                aria-label={tTasks('markDone', { title })}
                onCheckedChange={() => update.mutate({ organizationId, id: task.id, done: true })}
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
              {canRecordContact ? (
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
