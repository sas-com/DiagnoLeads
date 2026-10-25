'use client';

import type {
  ContactLogView,
  RecordContactInput,
} from '@/lib/features/lead-follow-up/types/schemas';
import { trpc } from '@/lib/trpc/client';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

/**
 * Records a contact of a lead and refreshes what shows it: the lead's contact bar, its activity,
 * the deal page and the dashboard. Each record is announced with an undo, for a wrong tap
 * (Refs #136, #554).
 */
export function useRecordContact({
  organizationId,
  leadId,
}: {
  organizationId: string;
  leadId: string;
}) {
  const t = useTranslations('leadFollowUp.contact');
  const utils = trpc.useUtils();

  const refresh = () => {
    void utils.leadFollowUp.contacts.invalidate({ organizationId, leadId });
    void utils.leadActivity.list.invalidate();
    void utils.leadActivity.forDeal.invalidate();
    void utils.analytics.getDashboard.invalidate();
  };
  const remove = trpc.leadFollowUp.deleteContact.useMutation({
    onSuccess: () => {
      refresh();
      toast.success(t('undone'));
    },
    onError: () => toast.error(t('error')),
  });
  const record = trpc.leadFollowUp.recordContact.useMutation({
    onSuccess: (saved: ContactLogView) => {
      refresh();
      toast.success(t('recorded', { kind: t(`kinds.${saved.kind}`) }), {
        action: {
          label: t('undo'),
          onClick: () => remove.mutate({ organizationId, id: saved.id }),
        },
      });
    },
    onError: () => toast.error(t('error')),
  });

  return {
    /** Resolves with the record, or rejects (the error toast is already shown) */
    record: (input: Omit<RecordContactInput, 'organizationId' | 'leadId'>) =>
      record.mutateAsync({ organizationId, leadId, ...input }),
    pending: record.isPending,
  };
}
