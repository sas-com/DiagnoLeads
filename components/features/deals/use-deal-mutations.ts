'use client';

import { trpc } from '@/lib/trpc/client';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

/**
 * Deal changes (Refs #436) with the queries they refresh: the deals, and the lead, whose status
 * and deal phase a deal moves forward (and its activity).
 */
export function useDealMutations() {
  const utils = trpc.useUtils();
  const t = useTranslations('deals.toasts');
  const refresh = () => {
    void utils.deals.invalidate();
    void utils.leads.invalidate();
    void utils.leadActivity.invalidate();
  };
  const onError = () => {
    toast.error(t('error'));
  };

  const create = trpc.deals.create.useMutation({
    onSuccess: () => {
      refresh();
      toast.success(t('created'));
    },
    onError,
  });
  const update = trpc.deals.update.useMutation({ onSuccess: refresh, onError });
  const remove = trpc.deals.delete.useMutation({
    onSuccess: () => {
      refresh();
      toast.success(t('deleted'));
    },
    onError: () => {
      toast.error(t('deleteError'));
    },
  });
  return { create, update, remove };
}
