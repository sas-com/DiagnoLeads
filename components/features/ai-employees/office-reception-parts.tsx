'use client';

import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';
import { FOCUS, KEY } from './office-hud';

/** The way back from a shelf of the reception to its counter (#1196): Esc, or this button */
export function ShelfBackButton({ onBack }: { onBack: () => void }) {
  const t = useTranslations('aiOffice.immersive.room.reception');
  return (
    <button
      type="button"
      onClick={onBack}
      className={cn(
        'flex min-h-11 items-center gap-2.5 text-sm font-bold text-[#d8d2c4] hover:text-white',
        FOCUS
      )}
    >
      <span className={KEY}>Esc</span>
      {t('back')}
    </button>
  );
}

/** A message in the middle of a board: nothing to show, or it could not be read */
export const BOARD_MESSAGE = 'm-auto max-w-md px-6 text-center text-base leading-relaxed';

/** A link out of the office to a page of the normal view */
export const DOOR_LINK =
  'inline-flex min-h-11 items-center gap-1 text-sm underline underline-offset-4 hover:text-white';
