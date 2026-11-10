'use client';

import type {
  ContactLogView,
  RecordContactInput,
} from '@/lib/features/lead-follow-up/types/schemas';
import { trpc } from '@/lib/trpc/client';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';

const TIME_ZONE = 'Asia/Tokyo';

/**
 * Records a contact of a lead and refreshes what shows it: the lead's contact bar, its activity,
 * the deal page, the dashboard and 今日 (#556). Each record is announced with an undo, for a
 * wrong tap, and with its time when one was given (Refs #136, #554). A failure is a toast unless
 * the caller shows it itself (toastOnError false: a dialog says it in place). The toasts name the
 * lead under their text when it is given, so records made one after another from a list's rows
 * tell apart (#863).
 */
export function useRecordContact({
  organizationId,
  leadId,
  leadLabel,
  toastOnError = true,
}: {
  organizationId: string;
  leadId: string;
  /** Whom the record is for, under each toast */
  leadLabel?: string;
  toastOnError?: boolean;
}) {
  const t = useTranslations('leadFollowUp.contact');
  const format = useFormatter();
  const utils = trpc.useUtils();

  const refresh = () => {
    void utils.leadFollowUp.contacts.invalidate({ organizationId, leadId });
    void utils.leadActivity.list.invalidate();
    void utils.leadActivity.forDeal.invalidate();
    void utils.leadActivity.myDay.invalidate({ organizationId });
    void utils.analytics.getDashboard.invalidate();
  };
  const remove = trpc.leadFollowUp.deleteContact.useMutation({
    onSuccess: () => {
      refresh();
      toast.success(t('undone'), { description: leadLabel });
    },
    onError: () => toast.error(t('error'), { description: leadLabel }),
  });
  const record = trpc.leadFollowUp.recordContact.useMutation({
    onSuccess: (saved: ContactLogView, input) => {
      refresh();
      const kind = t(`kinds.${saved.kind}`);
      const message = input.contactedAt
        ? t('recordedAt', {
            kind,
            date: format.dateTime(new Date(saved.contactedAt), {
              dateStyle: 'medium',
              timeStyle: 'short',
              timeZone: TIME_ZONE,
            }),
          })
        : t('recorded', { kind });
      toast.success(message, {
        description: leadLabel,
        action: {
          label: t('undo'),
          onClick: () => remove.mutate({ organizationId, id: saved.id }),
        },
      });
    },
    onError: () => {
      if (toastOnError) toast.error(t('error'), { description: leadLabel });
    },
  });

  return {
    /** Resolves with the record, or rejects (with toastOnError, the error toast is shown) */
    record: (input: Omit<RecordContactInput, 'organizationId' | 'leadId'>) =>
      record.mutateAsync({ organizationId, leadId, ...input }),
    pending: record.isPending,
  };
}
