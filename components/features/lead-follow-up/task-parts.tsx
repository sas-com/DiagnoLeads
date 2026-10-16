'use client';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { type TaskDue, taskDue } from '@/lib/features/lead-follow-up/due';
import type { LeadTaskView } from '@/lib/features/lead-follow-up/types/schemas';
import { fromIsoDate, toIsoDate } from '@/lib/features/lead-hearings/form';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { format as formatDate } from 'date-fns';
import { enUS, ja } from 'date-fns/locale';
import { AlertCircle, CalendarDays } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

type TaskLike = Pick<LeadTaskView, 'title' | 'source' | 'dueOn' | 'done'>;

/** The task's title; a task from a hearing that kept the default title is named here */
export function useTaskTitle() {
  const t = useTranslations('leadFollowUp.tasks');
  return (task: Pick<TaskLike, 'title'>) => task.title ?? t('nextMeetingTitle');
}

const DUE_CLASSES: Record<TaskDue, string> = {
  overdue: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  today: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  upcoming: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  done: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
};

/** Due date of a task, coloured by how it stands today (overdue / today / later / done) */
export function DueLabel({ task, today }: { task: TaskLike; today: string }) {
  const t = useTranslations('leadFollowUp.tasks');
  const format = useFormatter();
  const due = taskDue(task, today);
  const date = format.dateTime(new Date(`${task.dueOn}T00:00:00Z`), {
    month: 'numeric',
    day: 'numeric',
    timeZone: 'UTC',
  });
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium',
        DUE_CLASSES[due]
      )}
      data-due={due}
    >
      {due === 'overdue' && <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />}
      {t(`due.${due}`, { date })}
    </span>
  );
}

/** Due label that opens a calendar to move the date (staff who can edit leads) */
export function DueDatePicker({
  task,
  today,
  label,
  onChange,
  disabled,
}: {
  task: TaskLike;
  today: string;
  /** Screen reader name, e.g. "Change the due date of …" */
  label: string;
  onChange: (dueOn: string) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('leadFollowUp.tasks');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const selected = fromIsoDate(task.dueOn);
  const pick = (next: string) => {
    setOpen(false);
    if (next !== task.dueOn) onChange(next);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          className="inline-flex items-center gap-1 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-60"
        >
          <DueLabel task={task} today={today} />
          <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={(date) => date && pick(toIsoDate(date))}
          locale={locale === 'ja' ? ja : enUS}
          formatters={{
            formatCaption: (month) =>
              formatDate(month, locale === 'ja' ? 'yyyy年M月' : 'MMMM yyyy', {
                locale: locale === 'ja' ? ja : enUS,
              }),
          }}
          initialFocus
        />
        <div className="flex gap-2 border-t p-2">
          <Button type="button" variant="outline" size="sm" onClick={() => pick(today)}>
            {t('today')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Change a task and refresh the lead's list and the dashboard */
export function useUpdateTask(organizationId: string) {
  const t = useTranslations('leadFollowUp.tasks');
  const utils = trpc.useUtils();
  return trpc.leadFollowUp.updateTask.useMutation({
    onSuccess: () => {
      void utils.leadFollowUp.tasks.invalidate();
      void utils.leadFollowUp.dueTasks.invalidate({ organizationId });
    },
    onError: () => toast.error(t('saveError')),
  });
}
