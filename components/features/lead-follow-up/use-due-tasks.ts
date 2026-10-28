'use client';

import {
  DUE_TASKS_MAX,
  DUE_TASKS_SHOWN,
  type DueTaskScope,
} from '@/lib/features/lead-follow-up/types/schemas';
import { trpc } from '@/lib/trpc/client';
import { useId, useState } from 'react';

/**
 * Open next actions and takeaways due today or earlier (Refs #85), for the dashboard's card and
 * the 今日 screen (#556): the first DUE_TASKS_SHOWN, and once opened the rest, fetched then
 * (#431). While the rest is on its way the first page stays; a longer list kept from before is
 * cut. The screens wrap the list in their own frame and states, and show DueTasksList and
 * DueTasksMore (./due-tasks-list.tsx) with what this returns.
 */
export function useDueTasks(
  organizationId: string,
  scope: DueTaskScope,
  /** 今日 reads them again sooner and when the window comes back (#556) */
  options: { staleTime?: number; refetchOnWindowFocus?: boolean } = {}
) {
  const listId = useId();
  const [expanded, setExpanded] = useState(false);
  const query = trpc.leadFollowUp.dueTasks.useQuery(
    expanded ? { organizationId, scope, limit: DUE_TASKS_MAX } : { organizationId, scope },
    {
      enabled: !!organizationId,
      staleTime: 60 * 1000,
      placeholderData: (previous) => previous,
      ...options,
    }
  );
  const data = query.data;
  const items = data ? (expanded ? data.items : data.items.slice(0, DUE_TASKS_SHOWN)) : [];
  const rest = data ? data.total - items.length : 0;
  const loadingRest = expanded && query.isPlaceholderData;
  const listShown = !query.isError && items.length > 0;
  return {
    query,
    data,
    items,
    rest,
    listId,
    expanded,
    setExpanded,
    loadingRest,
    listShown,
    // Under the list: "N more", and once opened a way back (also when the rest failed to load)
    showToggle: expanded ? listShown || query.isError : listShown && rest > 0,
  };
}

export type DueTasks = ReturnType<typeof useDueTasks>;
