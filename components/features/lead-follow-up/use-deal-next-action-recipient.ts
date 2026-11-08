'use client';

import { trpc } from '@/lib/trpc/client';
import { useTranslations } from 'next-intl';

/** A deal a next action is added for (#853): which one, and its owner */
export interface NextActionDeal {
  id: string;
  ownerUserId: string | null;
  ownerName: string | null;
}

/**
 * Who gets the due notices of a next action added for the deal, and sees it in their 今日, as
 * the server decides (createTask in lib/features/lead-follow-up/service.ts, #853): the deal's
 * owner, as the lead's assignee or, when the lead's assignee is someone else, as the one it is
 * given to. With no owner, or an owner who may no longer hold leads (not among the members leads
 * can be assigned to), the lead's assignee, else whoever adds it. Said in one sentence, for the
 * places a next action is added for a deal: its page's card and the deals board's dialog.
 */
export function useDealNextActionRecipient(organizationId: string, deal: NextActionDeal): string {
  const t = useTranslations('leadFollowUp.tasks');
  // The same query as the assignee controls (#135) and the deals' owner filter
  const members = trpc.leads.assignees.useQuery(
    { organizationId },
    { enabled: !!organizationId && !!deal.ownerUserId, staleTime: 5 * 60 * 1000 }
  );
  const { ownerUserId, ownerName } = deal;
  // Until the members are read, the owner: a deal's owner could hold leads when it was set
  if (
    ownerUserId &&
    ownerName &&
    (!members.data || members.data.some((member) => member.userId === ownerUserId))
  ) {
    return t('recipient.dealOwner', { name: ownerName });
  }
  return t('recipient.leadAssignee');
}
