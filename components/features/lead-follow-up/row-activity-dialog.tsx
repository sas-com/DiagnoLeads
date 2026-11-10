'use client';

import { useRowDialog } from '@/hooks/use-row-dialog';
import { RecordActivityDialog } from './record-activity-dialog';

/** The lead a row's "Record an activity" is for */
export interface RowActivityLead {
  leadId: string;
  /** Whom it is for, in the dialog's description */
  leadLabel: string;
}

/** Opens a list's one "Record an activity" for a row's lead, from the row's button */
export type OpenRowActivity = (lead: RowActivityLead, opener: HTMLElement | null) => void;

/**
 * The state of a list's one "Record an activity" (#998), opened from the menu of a row
 * (ContactRecordMenu): closed, the focus goes back to the menu's button, or to the list's heading
 * (focusable by script) when the row left meanwhile.
 */
export function useRowActivityDialog(headingId?: string) {
  return useRowDialog<RowActivityLead>(
    ({ opener }) => opener ?? (headingId ? document.getElementById(headingId) : null)
  );
}

/**
 * A list's one "Record an activity" (#998): the screen puts it outside what a read of the list
 * can replace, so that what was entered stays when a row leaves or the list fails to be read
 * again. Keyed by the lead, so that nothing of one lead's dialog goes on to another's.
 */
export function RowActivityDialog({
  dialog,
  organizationId,
}: {
  dialog: ReturnType<typeof useRowActivityDialog>;
  organizationId: string;
}) {
  if (!dialog.chosen) return null;
  return (
    <RecordActivityDialog
      key={dialog.chosen.leadId}
      open={dialog.open}
      onOpenChange={dialog.setOpen}
      organizationId={organizationId}
      leadId={dialog.chosen.leadId}
      leadLabel={dialog.chosen.leadLabel}
      onCloseAutoFocus={dialog.returnFocus}
    />
  );
}
