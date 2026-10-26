'use client';

import { trpc } from '@/lib/trpc/client';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

/**
 * Deal changes (Refs #436) with the queries they refresh: the deals, and the lead, whose status
 * and deal phase are computed from its deals (#444), and its activity. Creating and changing a
 * deal succeed once the shown queries are read again (#720), so what follows (closing a dialog,
 * settling a move shown ahead) does not show the old values for a moment; a deletion does not
 * wait, as the deal's page leaves at once. A form or a question that says a failure itself
 * passes `toastErrors: false`.
 */
export function useDealMutations({ toastErrors = true }: { toastErrors?: boolean } = {}) {
  const utils = trpc.useUtils();
  const t = useTranslations('deals.toasts');
  const refresh = () =>
    Promise.all([
      utils.deals.invalidate(),
      utils.leads.invalidate(),
      utils.leadActivity.invalidate(),
    ]);
  const onError = () => {
    if (toastErrors) toast.error(t('error'));
  };

  const create = trpc.deals.create.useMutation({
    onSuccess: () => {
      toast.success(t('created'));
      return refresh();
    },
    onError,
  });
  const update = trpc.deals.update.useMutation({ onSuccess: () => refresh(), onError });
  const remove = trpc.deals.delete.useMutation({
    onSuccess: () => {
      void refresh();
      toast.success(t('deleted'));
    },
    onError: () => {
      toast.error(t('deleteError'));
    },
  });
  return { create, update, remove, refresh };
}
