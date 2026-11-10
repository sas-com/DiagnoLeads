'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { AddTaskForm } from './lead-next-actions-card';
import { type NextActionDeal, useDealNextActionRecipient } from './use-deal-next-action-recipient';

export interface AddNextActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  /** The deal it is added for, and its lead */
  deal: NextActionDeal & { name: string; leadId: string };
  /** The lead's company or name, empty when it has neither */
  leadLabel: string;
  /** Japan calendar day the board was read on: the due date it starts with */
  today: string;
  /** Once a next action is added, before it closes */
  onAdded?: () => void;
  /** Where the focus goes when it closes: it was not opened by a dialog trigger */
  onCloseAutoFocus?: (event: Event) => void;
}

/**
 * Adds a next action or takeaway to a deal's lead from the deals board and list (#853), and from
 * 今日's deals that need attention (#970), which
 * offer it for an open deal marked for having none: the form of the lead's next actions card, in
 * a dialog, starting in "what to do". It says whose next action it is, and above the add button
 * who gets its due notices (the deal's owner when the lead's assignee is someone else); once added
 * it closes and a toast names it and the lead, and the board is read again (the form does), so
 * the mark goes and the card shows it. While it saves it does not close, so a failure is said in
 * place with what was entered kept; a tap outside does not close it then, nor once anything was
 * entered (as the dialog that records an activity).
 */
export function AddNextActionDialog({
  open,
  onOpenChange,
  organizationId,
  deal,
  leadLabel,
  today,
  onAdded,
  onCloseAutoFocus,
}: AddNextActionDialogProps) {
  const t = useTranslations('leadFollowUp.tasks');
  const recipient = useDealNextActionRecipient(organizationId, deal);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && saving) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"
        onInteractOutside={(event) => {
          if (dirty || saving) event.preventDefault();
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          {/* A long deal name wraps clear of the close button */}
          <DialogTitle className="pr-6 leading-normal">
            {t('dialog.title', { deal: deal.name })}
          </DialogTitle>
          <DialogDescription>
            {leadLabel
              ? t('dialog.description', { lead: leadLabel })
              : t('dialog.descriptionNoName')}
          </DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so each opening starts empty and due today */}
        <AddTaskForm
          organizationId={organizationId}
          leadId={deal.leadId}
          dealId={deal.id}
          today={today}
          hint={recipient}
          autoFocusTitle
          className="border-t-0 pt-0"
          onPendingChange={setSaving}
          onDirtyChange={setDirty}
          onCancel={() => onOpenChange(false)}
          onCreated={(task) => {
            toast.success(
              t('added', { title: task.title ?? t('nextMeetingTitle') }),
              leadLabel ? { description: leadLabel } : undefined
            );
            onAdded?.();
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
