'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  DUE_TASKS_MAX,
  DUE_TASKS_SHOWN,
  DUE_TASK_SCOPES,
  type DueTaskScope,
} from '@/lib/features/lead-follow-up/types/schemas';
import { trpc } from '@/lib/trpc/client';
import { ChevronDown, ChevronUp, RotateCw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useId, useState } from 'react';
import { CheckWithText, DueLabel, TaskKindBadge, useTaskTitle, useUpdateTask } from './task-parts';

/**
 * Dashboard card "today" (Refs #85): open next actions and takeaways due today or earlier,
 * oldest due first, each with its lead. Shows the user's own first ("mine only", the default);
 * "everyone" lists all with the user's own on top. Ticking one completes it.
 * The first DUE_TASKS_SHOWN are listed; "N more" opens the rest, fetched then (#431).
 */
export function DueTasksSection({ organizationId }: { organizationId: string }) {
  const t = useTranslations('leadFollowUp.today');
  const tTasks = useTranslations('leadFollowUp.tasks');
  const locale = useLocale();
  const listId = useId();
  const titleOf = useTaskTitle();
  const update = useUpdateTask(organizationId);
  const [scope, setScope] = useState<DueTaskScope>('mine');
  const [expanded, setExpanded] = useState(false);
  const query = trpc.leadFollowUp.dueTasks.useQuery(
    expanded ? { organizationId, scope, limit: DUE_TASKS_MAX } : { organizationId, scope },
    { enabled: !!organizationId, staleTime: 60 * 1000, placeholderData: (previous) => previous }
  );
  const data = query.data;
  // While the rest is on its way the first page stays; a longer list kept from before is cut
  const items = data ? (expanded ? data.items : data.items.slice(0, DUE_TASKS_SHOWN)) : [];
  const rest = data ? data.total - items.length : 0;
  const loadingRest = expanded && query.isPlaceholderData;
  const listShown = !query.isError && items.length > 0;
  // Under the list: "N more", and once opened a way back (also when the rest failed to load)
  const showToggle = expanded ? listShown || query.isError : listShown && rest > 0;
  const scopeLabels: Record<DueTaskScope, string> = {
    mine: t('scopeMine'),
    all: t('scopeAll'),
  };

  return (
    <Card className="p-4 shadow-none sm:p-6 dark:border-gray-800">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2 sm:mb-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-gray-900 sm:text-lg dark:text-gray-50">
            {t('title')}
            {data && data.total > 0 && (
              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-sm font-bold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                {data.total}
              </span>
            )}
          </h2>
          <p className="text-xs text-gray-500 sm:text-sm dark:text-gray-400">
            {t('descriptionAll')}
          </p>
        </div>
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={scope}
          onValueChange={(value) => {
            if (!value) return;
            setScope(value as DueTaskScope);
            setExpanded(false);
          }}
          aria-label={t('scopeLabel')}
        >
          {DUE_TASK_SCOPES.map((value) => (
            <ToggleGroupItem key={value} value={value}>
              {data?.counts
                ? t('scopeCount', { label: scopeLabels[value], count: data.counts[value] })
                : scopeLabels[value]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      {query.isError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-center gap-3 rounded-lg bg-rose-50 px-4 py-4 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"
        >
          {t('loadError')}
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            <RotateCw aria-hidden="true" />
            {t('retry')}
          </Button>
        </div>
      ) : !data ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-lg bg-gray-50 px-4 py-6 text-center text-sm text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
          {data.scope === 'mine' ? t('emptyMine') : t('empty')}
        </p>
      ) : (
        <ul id={listId} className="divide-y divide-gray-100 dark:divide-gray-800">
          {items.map((task) => {
            const title = titleOf(task);
            return (
              <li key={task.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <Checkbox
                  className="h-5 w-5"
                  checked={false}
                  disabled={!data.canEdit || update.isPending}
                  aria-label={tTasks('markDone', { title })}
                  onCheckedChange={() => update.mutate({ organizationId, id: task.id, done: true })}
                />
                <DueLabel task={task} today={data.today} />
                <TaskKindBadge task={task} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900 dark:text-gray-50">
                  {title}
                </span>
                {data.scope === 'all' && task.mine && (
                  <span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                    {t('mineBadge')}
                  </span>
                )}
                <Link
                  href={`/${locale}/leads/${task.leadId}`}
                  className="basis-full truncate text-sm text-brand-600 hover:underline sm:basis-auto dark:text-brand-400"
                >
                  {task.lead.company ?? task.lead.name ?? t('noLeadName')}
                  {task.lead.company && task.lead.name && (
                    <span className="ml-1 text-gray-500 dark:text-gray-400">{task.lead.name}</span>
                  )}
                </Link>
                <CheckWithText task={task} className="basis-full pl-8" />
              </li>
            );
          })}
        </ul>
      )}
      {loadingRest && <Skeleton className="mt-2 h-10 w-full" />}
      {showToggle && (
        <div className="mt-2 flex flex-wrap items-center justify-end gap-x-3 text-sm text-gray-500">
          {/* Past DUE_TASKS_MAX the rest stays a count */}
          {expanded && listShown && !loadingRest && rest > 0 && (
            <span>{t('more', { count: rest })}</span>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto px-1 py-0.5 text-sm text-gray-500 dark:text-gray-400"
            aria-expanded={expanded}
            aria-controls={listShown ? listId : undefined}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? t('showLess') : t('more', { count: rest })}
            {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
          </Button>
        </div>
      )}
    </Card>
  );
}
