'use client';

import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';
import { FOCUS, KEY } from './office-hud';

/** The way back from a shelf of the reception to its counter (#1196): Esc, or this button */
export function ShelfBackButton({
  onBack,
  closed = false,
  label,
}: {
  onBack: () => void;
  /** No way back right now (something is being saved): Esc is closed with it */
  closed?: boolean;
  /** Where it goes back to, when not to the counter */
  label?: string;
}) {
  const t = useTranslations('aiOffice.immersive.room.reception');
  return (
    <button
      type="button"
      // Not disabled: a disabled button would drop the focus out of the shelf
      aria-disabled={closed || undefined}
      onClick={() => {
        if (!closed) onBack();
      }}
      className={cn(
        'flex min-h-11 items-center gap-2.5 text-sm font-bold text-[#d8d2c4] hover:text-white aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
        FOCUS
      )}
    >
      <span className={KEY}>Esc</span>
      {label ?? t('back')}
    </button>
  );
}

/** A message in the middle of a board: nothing to show, or it could not be read */
export const BOARD_MESSAGE = 'm-auto max-w-md px-6 text-center text-base leading-relaxed';

/** A link out of the office to a page of the normal view */
export const DOOR_LINK =
  'inline-flex min-h-11 items-center gap-1 text-sm underline underline-offset-4 hover:text-white';
