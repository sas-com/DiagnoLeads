'use client';

import { DueTasksList, DueTasksMore } from '@/components/features/lead-follow-up/due-tasks-list';
import type { DueTasks } from '@/components/features/lead-follow-up/use-due-tasks';
import { useTranslations } from 'next-intl';
import { TodaySection, sectionState } from './today-section';

/**
 * Next actions listed before "N more" (the dashboard lists 20): as many as today's contacts, so
 * the meetings below stay in sight on a phone
 */
export const TODAY_NEXT_ACTIONS_SHOWN = 5;

/**
 * The user's next actions and takeaways due today or earlier (今日, #556): only their own (the
 * one responsible, see responsibleUserSql), in the same frame and states as the other sections.
 * Ticking one completes it; "N more" opens the rest, and stays to go back when they fail to load.
 * The screen reads them (useDueTasks with TODAY_NEXT_ACTIONS_SHOWN): its heading needs their day
 */
export function TodayNextActions({
  due,
  organizationId,
}: {
  due: DueTasks;
  organizationId: string;
}) {
  const t = useTranslations('today.nextActions');
  const tDue = useTranslations('leadFollowUp.today');

  return (
    <TodaySection
      title={t('title')}
      description={tDue('descriptionAll')}
      count={due.data?.total}
      state={sectionState(due.query, due.items.length === 0)}
      emptyText={tDue('emptyMine')}
      footer={<DueTasksMore due={due} />}
    >
      <DueTasksList due={due} organizationId={organizationId} showMineBadge={false} />
    </TodaySection>
  );
}
