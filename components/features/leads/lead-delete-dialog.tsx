'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { Lead } from '@/lib/db/schema';
import { useTranslations } from 'next-intl';

interface LeadDeleteDialogProps {
  lead: Pick<Lead, 'name' | 'email'> | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void | Promise<void>;
  isDeleting?: boolean;
}

/**
 * Confirmation before deleting a lead (used by the details and the list's row menu)
 */
export function LeadDeleteDialog({
  lead,
  open,
  onOpenChange,
  onConfirm,
  isDeleting,
}: LeadDeleteDialogProps) {
  const t = useTranslations('leads');
  const tCommon = useTranslations('common');

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('deleteConfirmTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('deleteConfirmMessage', { name: lead?.name || lead?.email || '' })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>{tCommon('cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isDeleting}
            className="bg-red-600 hover:bg-red-700"
          >
            {isDeleting ? t('deleting') : tCommon('delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
