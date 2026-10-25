'use client';

import { TAP_TARGET } from '@/components/common/tap-target';
import { Button } from '@/components/ui/button';
import { type ContactKind, QUICK_CONTACT_KINDS } from '@/lib/features/lead-follow-up/types/schemas';
import { cn } from '@/lib/utils';
import { NotebookPen } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { CONTACT_KIND_ICONS } from './contact-kinds';
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
  const { record, pending } = useRecordContact({ organizationId, leadId });

  const submit = (kind: ContactKind) => {
    // The hook shows the error
    record({ kind }).catch(() => undefined);
  };

  // The lead page's bar is 44px tall on phones (#196); the dashboard row stays compact
  const size = compact ? 'h-8 px-2 text-xs' : cn('h-9', TAP_TARGET);
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
            className={size}
            disabled={pending}
            onClick={() => submit(kind)}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {t(`kinds.${kind}`)}
          </Button>
        );
      })}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={size}
        aria-label={compact ? tActivity('openFor', { lead: leadLabel }) : undefined}
        disabled={pending}
        onClick={() => setDialogOpen(true)}
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
      />
    </fieldset>
  );
}
