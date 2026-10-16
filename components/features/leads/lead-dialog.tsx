'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { CreateLeadInput } from '@/lib/features/leads/types';
import { useTranslations } from 'next-intl';
import { LeadForm } from './lead-form';

interface LeadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  onSubmit: (data: Omit<CreateLeadInput, 'organizationId'>) => void | Promise<void>;
  isLoading?: boolean;
}

/**
 * Dialog for creating a lead. Existing leads are edited in place on the lead page (Refs #109)
 */
export function LeadDialog({ open, onOpenChange, onSubmit, isLoading }: LeadDialogProps) {
  const t = useTranslations('leads');

  const handleSubmit = async (data: Partial<Omit<CreateLeadInput, 'organizationId'>>) => {
    // A new lead gets every value of the form
    await onSubmit(data as Omit<CreateLeadInput, 'organizationId'>);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('createLeadTitle')}</DialogTitle>
          <DialogDescription>{t('createLeadDescription')}</DialogDescription>
        </DialogHeader>

        <LeadForm onSubmit={handleSubmit} isLoading={isLoading} />
      </DialogContent>
    </Dialog>
  );
}
