import { TAP_TARGET } from '@/components/common/tap-target';
import { cn } from '@/lib/utils';
import type { KeyboardEvent } from 'react';

/**
 * Controls shared by the forms of the lead pages (#722, #554): the toggles of a choice, and the
 * keys that send or close a text field.
 */

/**
 * An item of a toggle group of choices: 44px on phones, and the chosen one shows by its border
 * and weight too, not by its shade alone
 */
export const TOGGLE_ITEM = cn(
  TAP_TARGET,
  'data-[state=on]:border-gray-900 data-[state=on]:font-bold dark:data-[state=on]:border-gray-50'
);

/**
 * A key of a conversion (IME): one open, or the Enter or Esc that confirms or cancels it, which
 * Safari sends after compositionend, with isComposing false and keyCode 229
 */
export const isComposing = (event: KeyboardEvent<Element>) =>
  event.nativeEvent.isComposing || event.keyCode === 229;

/** Ctrl+Enter (⌘+Enter on a Mac) sends what is written; not the Enter of a conversion */
export const isSendShortcut = (event: KeyboardEvent<Element>) =>
  event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !isComposing(event);

/** Esc closes the field; not the Esc that cancels a conversion */
export const isCloseShortcut = (event: KeyboardEvent<Element>) =>
  event.key === 'Escape' && !isComposing(event);

/** What a field with the shortcut announces (aria-keyshortcuts) */
export const SEND_SHORTCUTS = 'Control+Enter Meta+Enter';
