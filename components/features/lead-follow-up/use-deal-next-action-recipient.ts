'use client';

import { useSession } from '@/lib/auth/client';
import { isOpenStage } from '@/lib/features/deals/types/pipeline';
import { trpc } from '@/lib/trpc/client';
import { useTranslations } from 'next-intl';

/** A deal a next action is added for (#853): which one, where it stands and its owner */
export interface NextActionDeal {
  id: string;
  stage: string;
  ownerUserId: string | null;
  ownerName: string | null;
}

/**
 * Who gets the due notices of a next action added for the deal, and sees it in their 今日, as
 * the server decides (createTask in lib/features/lead-follow-up/service.ts, #853): the owner of
 * an open deal, as the lead's assignee or, when the lead's assignee is someone else, as the one it
 * is given to ("you" when that is the user). For a won or lost deal, one without an owner, or an
 * owner who may no longer hold leads (not among the members leads can be assigned to): the lead's
 * assignee, else the user who adds it. Said in one sentence, above the add button of a deal's
 * page and of the deals board's dialog.
 */
export function useDealNextActionRecipient(organizationId: string, deal: NextActionDeal): string {
  const t = useTranslations('leadFollowUp.tasks');
  const session = useSession();
  const open = isOpenStage(deal.stage);
  // The same query as the assignee controls (#135) and the deals' owner filter
  const members = trpc.leads.assignees.useQuery(
    { organizationId },
    { enabled: !!organizationId && open && !!deal.ownerUserId, staleTime: 5 * 60 * 1000 }
  );
  const { ownerUserId, ownerName } = deal;
  // Until the members are read, the owner: a deal's owner could hold leads when it was set
  const ownerHolds =
    open &&
    !!ownerUserId &&
    (!members.data || members.data.some((member) => member.userId === ownerUserId));
  if (ownerHolds && ownerUserId === session.data?.user?.id) return t('recipient.you');
  if (ownerHolds && ownerName) return t('recipient.dealOwner', { name: ownerName });
  return t('recipient.leadAssignee');
}
