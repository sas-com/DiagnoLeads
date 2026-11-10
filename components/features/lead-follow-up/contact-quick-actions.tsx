'use client';

import { TAP_TARGET } from '@/components/common/tap-target';
import { Button } from '@/components/ui/button';
import { useReturnFocus } from '@/hooks/use-return-focus';
import { type ContactKind, QUICK_CONTACT_KINDS } from '@/lib/features/lead-follow-up/types/schemas';
import { cn } from '@/lib/utils';
import { NotebookPen } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { CONTACT_KIND_ICONS } from './contact-kinds';
import { CONTACT_RECORDING_CLASS } from './contact-record-menu';
import { RecordActivityDialog } from './record-activity-dialog';
import { useRecordContact } from './use-record-contact';

export interface ContactQuickActionsProps {
  organizationId: string;
  leadId: string;
  /** Who the buttons are for (the screen reader name of the group) */
  leadLabel: string;
  /** Smaller buttons (a row of the dashboard) */
  compact?: boolean;
  className?: string;
}

/**
 * One tap records "called", "emailed" or "could not reach" now (Refs #136). A wrong tap can be
 * undone from the toast. "Record an activity" records one with its details: a visit or an
 * online meeting, a past time, how long it took, its outcome, its deal and a note (Refs #554).
 * Its dialog gives the focus back to the button once it closes (#776). While it records, the
 * buttons stay focusable but do nothing (aria-disabled), so the focus a keyboard press left on
 * one is not lost, as on ContactRecordMenu (#776).
 */
export function ContactQuickActions({
  organizationId,
  leadId,
  leadLabel,
  compact = false,
  className,
}: ContactQuickActionsProps) {
  const t = useTranslations('leadFollowUp.contact');
  const tActivity = useTranslations('leadFollowUp.activity');
  const [dialogOpen, setDialogOpen] = useState(false);
  // The dialog is opened without a dialog trigger: the focus goes back to its button. A row of
  // the dashboard can leave once recorded: nothing to give it back to then (#776)
  const activityFocus = useReturnFocus<HTMLButtonElement>();
  const { record, pending } = useRecordContact({ organizationId, leadId, leadLabel });

  const submit = (kind: ContactKind) => {
    // The hook shows the error
    record({ kind }).catch(() => undefined);
  };

  // The lead page's bar is 44px tall on phones (#196); the dashboard row stays compact. While it
  // records, dimmed as the list rows' menu
  const buttonClass = cn(
    compact ? 'h-8 px-2 text-xs' : cn('h-9', TAP_TARGET),
    CONTACT_RECORDING_CLASS
  );
  return (
    <fieldset
      aria-label={t('recordFor', { lead: leadLabel })}
      className={cn('flex flex-wrap items-center gap-1.5', className)}
    >
      {QUICK_CONTACT_KINDS.map((kind) => {
        const Icon = CONTACT_KIND_ICONS[kind];
        return (
          <Button
            key={kind}
            type="button"
            variant="outline"
            size="sm"
            className={buttonClass}
            aria-disabled={pending || undefined}
            onClick={() => {
              if (!pending) submit(kind);
            }}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {t(`kinds.${kind}`)}
          </Button>
        );
      })}
      {!compact && (
        <span aria-hidden="true" className="mx-0.5 hidden h-6 w-px bg-gray-300 sm:block" />
      )}
      <Button
        ref={activityFocus.ref}
        type="button"
        variant="outline"
        size="sm"
        className={buttonClass}
        aria-label={compact ? tActivity('openFor', { lead: leadLabel }) : undefined}
        title={compact ? tActivity('open') : undefined}
        aria-disabled={pending || undefined}
        onClick={() => {
          if (!pending) setDialogOpen(true);
        }}
      >
        <NotebookPen className="h-4 w-4" aria-hidden="true" />
        {!compact && tActivity('open')}
      </Button>
      <RecordActivityDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        organizationId={organizationId}
        leadId={leadId}
        leadLabel={leadLabel}
        onCloseAutoFocus={activityFocus.onCloseAutoFocus}
      />
    </fieldset>
  );
}
