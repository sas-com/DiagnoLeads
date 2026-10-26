import { TAP_TARGET } from '@/components/common/tap-target';
import { cn } from '@/lib/utils';
import type { KeyboardEvent } from 'react';

/**
 * An item of the type choice and of the filter (#722): 44px on phones, and the chosen one shows
 * by its border and weight too, not by its shade alone
 */
export const TOGGLE_ITEM = cn(
  TAP_TARGET,
  'data-[state=on]:border-gray-900 data-[state=on]:font-bold dark:data-[state=on]:border-gray-50'
);

/** Ctrl+Enter (⌘+Enter on a Mac) sends what is written; not while a conversion is open (IME) */
export const isSendShortcut = (event: KeyboardEvent<HTMLTextAreaElement>) =>
  event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing;

/** What a field with the shortcut announces (aria-keyshortcuts) */
export const SEND_SHORTCUTS = 'Control+Enter Meta+Enter';
