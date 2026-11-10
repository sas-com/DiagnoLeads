'use client';

import { useRef, useState } from 'react';

/** What decides where the focus goes once a row's dialog closes */
export interface RowDialogClosed<T> {
  /** What the dialog was opened for */
  chosen: T;
  /** It was saved before closing (added, recorded): markDone */
  done: boolean;
  /** The button that opened it, null once it left the screen with its row */
  opener: HTMLElement | null;
}

/**
 * A dialog opened from a row of a list (#853, #970, #998): one for the list, opened for the row
 * chosen. The screen puts it outside what a read of the list can replace, so that it and what
 * was entered in it stay whatever the list reads meanwhile: a row leaving, a failure, an empty
 * list. It is opened without a trigger, so Radix has none to give the focus back to:
 * `focusAfter` says where it goes, from what was chosen, whether it was done and the button that
 * opened it while that is still there. Nothing is focused when it returns nothing.
 */
export function useRowDialog<T>(
  focusAfter: (closed: RowDialogClosed<T>) => HTMLElement | null | undefined
) {
  const [chosen, setChosen] = useState<T | null>(null);
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const done = useRef(false);
  return {
    /** What the dialog is open for: kept once it closed, until a row opens it again */
    chosen,
    open,
    setOpen,
    /** Opens the dialog for a row, from its button */
    start: (value: T, from: HTMLElement | null) => {
      opener.current = from;
      done.current = false;
      setChosen(value);
      setOpen(true);
    },
    /** What it was opened for was saved */
    markDone: () => {
      done.current = true;
    },
    /** The dialog's onCloseAutoFocus */
    returnFocus: (event: Event) => {
      if (chosen === null) return;
      const button = opener.current?.isConnected ? opener.current : null;
      const target = focusAfter({ chosen, done: done.current, opener: button });
      if (!target) return;
      event.preventDefault();
      target.focus();
    },
  };
}
