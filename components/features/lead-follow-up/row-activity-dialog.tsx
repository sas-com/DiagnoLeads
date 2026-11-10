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
 * (ContactRecordMenu, which is given its start): closed, the focus goes back to the menu's
 * button, or to the list's heading when the row left meanwhile. Not to the row beside it, as
 * after ticking a next action (#776): a row leaving here is not what the user did, and the focus
 * would land on another lead's button unnoticed; the heading says the list changed.
 * The heading needs that id and tabIndex={-1} (TodaySection does it for a headingId given).
 */
export function useRowActivityDialog(headingId: string) {
  return useRowDialog<RowActivityLead>(
    ({ opener }) => opener ?? document.getElementById(headingId)
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
