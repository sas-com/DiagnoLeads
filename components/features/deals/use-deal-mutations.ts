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
 * (the deal form, the delete question of the deal's page) passes `toastErrors: false`.
 *
 * `failOffline`: a change fails at once while the browser is offline instead of waiting for the
 * connection (#1251). For a screen that closes its ways out while a change is being saved (the
 * rooms of the office): a change left waiting would keep them closed.
 */
export function useDealMutations({
  toastErrors = true,
  failOffline = false,
}: { toastErrors?: boolean; failOffline?: boolean } = {}) {
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
  const update = trpc.deals.update.useMutation({
    onSuccess: () => refresh(),
    onError,
    ...(failOffline ? { networkMode: 'always' as const } : {}),
  });
  const remove = trpc.deals.delete.useMutation({
    onSuccess: () => {
      void refresh();
      toast.success(t('deleted'));
    },
    onError: () => {
      if (toastErrors) toast.error(t('deleteError'));
    },
  });
  return { create, update, remove, refresh };
}
