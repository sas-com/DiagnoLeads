'use client';

import { TAP_TARGET } from '@/components/common/tap-target';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { QUICK_CONTACT_KINDS } from '@/lib/features/lead-follow-up/types/schemas';
import { cn } from '@/lib/utils';
import { Loader2, NotebookPen } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { CONTACT_KIND_ICONS } from './contact-kinds';
import { RecordActivityDialog } from './record-activity-dialog';
import { useRecordContact } from './use-record-contact';

/** The menu's items: 44px to tap on phones like the button, with 14px text (DADS) */
const ITEM_CLASS = cn('gap-2 text-sm', TAP_TARGET);

export interface ContactRecordMenuProps {
  organizationId: string;
  leadId: string;
  /** Who the contact is with (the button's screen reader name and the dialog's description) */
  leadLabel: string;
  className?: string;
}

/**
 * Records a contact with a lead from a row of a list (今日, #863): one button rather than the four
 * of the lead page's bar, so a row does not wrap into lines of buttons on a phone, opening the
 * one-tap "called", "emailed" and "could not reach" (Refs #136) and "Record an activity" for the
 * details (Refs #554). Sized for DADS (decision 2026-10-24-admin-dads): 44px to tap on phones and
 * no text under 14px. While it records, the button stays focusable but does not open
 * (aria-disabled) and turns its icon into a spinner, so the focus the menu gives back on closing
 * is not lost; the toasts of the record name the lead and have its undo.
 */
export function ContactRecordMenu({
  organizationId,
  leadId,
  leadLabel,
  className,
}: ContactRecordMenuProps) {
  const t = useTranslations('leadFollowUp.contact');
  const tActivity = useTranslations('leadFollowUp.activity');
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  /** The press began with a touch or a pen: the menu opens on its click */
  const touchPress = useRef(false);
  const { record, pending } = useRecordContact({ organizationId, leadId, leadLabel });

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={(open) => setMenuOpen(open && !pending)}>
        <DropdownMenuTrigger asChild>
          <Button
            ref={buttonRef}
            type="button"
            variant="outline"
            size="sm"
            className={cn(
              // While it records: dimmed, and no hover colour as it does not open
              'aria-disabled:cursor-wait aria-disabled:opacity-50 aria-disabled:hover:bg-white dark:aria-disabled:hover:bg-gray-800',
              TAP_TARGET,
              className
            )}
            aria-label={t('recordFor', { lead: leadLabel })}
            aria-disabled={pending || undefined}
            onPointerDown={(event) => {
              // Radix opens the menu on pointerdown, which on a touch screen is also where a
              // scroll starts: a touch or a pen opens it on its click instead. The Slot calls
              // this before Radix's handler, which preventDefault makes it skip; a mouse is left
              // to Radix as it was
              touchPress.current = event.pointerType !== 'mouse';
              if (touchPress.current) event.preventDefault();
            }}
            onPointerCancel={() => {
              // The touch became a scroll: no click comes
              touchPress.current = false;
            }}
            onClick={() => {
              // A mouse and the keyboard: Radix has opened it already
              if (!touchPress.current) return;
              touchPress.current = false;
              setMenuOpen((open) => !open && !pending);
            }}
          >
            {pending ? (
              <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : (
              <NotebookPen aria-hidden="true" />
            )}
            {t('recordMenu')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={(event) => {
            // The dialog takes the focus, and gives it back to the button when it closes
            if (dialogOpen) event.preventDefault();
          }}
        >
          {QUICK_CONTACT_KINDS.map((kind) => {
            const Icon = CONTACT_KIND_ICONS[kind];
            return (
              <DropdownMenuItem
                key={kind}
                className={ITEM_CLASS}
                onSelect={() => {
                  // The hook shows the error
                  record({ kind }).catch(() => undefined);
                }}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {t(`kinds.${kind}`)}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem className={ITEM_CLASS} onSelect={() => setDialogOpen(true)}>
            <NotebookPen className="h-4 w-4" aria-hidden="true" />
            {tActivity('open')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <RecordActivityDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        organizationId={organizationId}
        leadId={leadId}
        leadLabel={leadLabel}
        onCloseAutoFocus={(event) => {
          // Opened from the menu, not from a dialog trigger: Radix would leave the focus nowhere
          event.preventDefault();
          buttonRef.current?.focus();
        }}
      />
    </>
  );
}
