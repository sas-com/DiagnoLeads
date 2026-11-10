'use client';

import { useRef } from 'react';

/**
 * Gives the focus back to the control that opened a dialog once it closes (#720, #776). A dialog
 * opened by state, not by a dialog trigger, gives Radix nothing to give the focus back to, and
 * the focus would be left on the page. The control is the one `ref` is put on, or the one last
 * `remember`ed when several open the dialog; once it left the screen, nothing is focused and
 * the dialog does as it does on its own.
 */
export function useReturnFocus<T extends HTMLElement = HTMLElement>() {
  const opener = useRef<T | null>(null);
  return {
    /** For the one control that opens the dialog */
    ref: opener,
    /** For a dialog opened from several controls: the one that opened it */
    remember: (element: T | null) => {
      opener.current = element;
    },
    /** The dialog's onCloseAutoFocus */
    onCloseAutoFocus: (event: Event) => {
      if (!opener.current?.isConnected) return;
      event.preventDefault();
      opener.current.focus();
    },
  };
}
