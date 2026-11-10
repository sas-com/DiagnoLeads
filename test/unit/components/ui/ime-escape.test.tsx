/**
 * The Esc that cancels a Japanese conversion must not close a dialog and lose what was typed
 * (#969). Chrome marks it isComposing; Safari sends it after compositionend with keyCode 229.
 */
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

type Open = (onEscapeKeyDown?: (event: KeyboardEvent) => void) => ReactNode;

const kinds: [string, Open][] = [
  [
    'Dialog',
    (onEscapeKeyDown) => (
      <Dialog defaultOpen>
        <DialogContent onEscapeKeyDown={onEscapeKeyDown}>
          <DialogTitle>Title</DialogTitle>
          <DialogDescription>Description</DialogDescription>
          <input aria-label="note" />
        </DialogContent>
      </Dialog>
    ),
  ],
  [
    'Sheet',
    (onEscapeKeyDown) => (
      <Sheet defaultOpen>
        <SheetContent onEscapeKeyDown={onEscapeKeyDown}>
          <SheetTitle>Title</SheetTitle>
          <SheetDescription>Description</SheetDescription>
          <input aria-label="note" />
        </SheetContent>
      </Sheet>
    ),
  ],
  [
    'AlertDialog',
    (onEscapeKeyDown) => (
      <AlertDialog defaultOpen>
        <AlertDialogContent onEscapeKeyDown={onEscapeKeyDown}>
          <AlertDialogTitle>Title</AlertDialogTitle>
          <AlertDialogDescription>Description</AlertDialogDescription>
          <input aria-label="note" />
        </AlertDialogContent>
      </AlertDialog>
    ),
  ],
  [
    'Popover (#1012)',
    (onEscapeKeyDown) => (
      <Popover defaultOpen>
        <PopoverContent onEscapeKeyDown={onEscapeKeyDown}>
          <p>Title</p>
          <input aria-label="note" />
        </PopoverContent>
      </Popover>
    ),
  ],
];

describe.each(kinds)('%s and the Esc of a conversion', (_, open) => {
  it('stays open on the Esc that cancels a conversion (Safari: keyCode 229)', () => {
    const onEscape = vi.fn();
    render(open(onEscape));
    fireEvent.keyDown(screen.getByLabelText('note'), { key: 'Escape', keyCode: 229 });
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(onEscape).not.toHaveBeenCalled();
  });

  it('stays open on an Esc while composing (Chrome: isComposing)', () => {
    render(open());
    fireEvent.keyDown(screen.getByLabelText('note'), { key: 'Escape', isComposing: true });
    expect(screen.getByText('Title')).toBeInTheDocument();
  });

  it('still closes on a plain Esc, and passes it to the caller', () => {
    const onEscape = vi.fn();
    render(open(onEscape));
    fireEvent.keyDown(screen.getByLabelText('note'), { key: 'Escape', keyCode: 27 });
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Title')).not.toBeInTheDocument();
  });
});
