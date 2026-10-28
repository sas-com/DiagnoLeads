'use client';

import { TAP_TARGET } from '@/components/common/tap-target';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { DUE_TASK_SCOPES, type DueTaskScope } from '@/lib/features/lead-follow-up/types/schemas';
import { RotateCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { DueTasksList, DueTasksMore } from './due-tasks-list';
import { useDueTasks } from './use-due-tasks';

/**
 * Dashboard card "today" (Refs #85): open next actions and takeaways due today or earlier,
 * oldest due first, each with its lead. Shows the user's own first ("mine only", the default);
 * "everyone" lists all with the user's own on top. Ticking one completes it.
 * The first DUE_TASKS_SHOWN are listed; "N more" opens the rest, fetched then (#431).
 * The list itself is shared with the 今日 screen (#556, ./due-tasks-list.tsx).
 */
export function DueTasksSection({ organizationId }: { organizationId: string }) {
  const t = useTranslations('leadFollowUp.today');
  const [scope, setScope] = useState<DueTaskScope>('mine');
  const due = useDueTasks(organizationId, scope);
  const { query, data } = due;
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
              <>
                {/* Read "今日やること 3件", not "今日やること3" (the space and ml-1 make the gap) */}{' '}
                <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-sm font-bold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                  {t('count', { count: data.total })}
                </span>
              </>
            )}
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-300">{t('descriptionAll')}</p>
        </div>
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={scope}
          onValueChange={(value) => {
            if (!value) return;
            setScope(value as DueTaskScope);
            due.setExpanded(false);
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
          <Button
            variant="outline"
            size="sm"
            className={TAP_TARGET}
            onClick={() => void query.refetch()}
          >
            <RotateCw aria-hidden="true" />
            {t('retry')}
          </Button>
        </div>
      ) : !data ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : due.items.length === 0 ? (
        <p className="rounded-lg bg-gray-50 px-4 py-6 text-center text-sm text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
          {data.scope === 'mine' ? t('emptyMine') : t('empty')}
        </p>
      ) : (
        <DueTasksList
          due={due}
          organizationId={organizationId}
          showMineBadge={data.scope === 'all'}
        />
      )}
      <DueTasksMore due={due} />
    </Card>
  );
}
