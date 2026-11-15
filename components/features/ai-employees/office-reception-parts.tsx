'use client';

import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';
import { CAP, FOCUS, KEY } from './office-hud';
import type { ReceptionShelf } from './rooms/reception';

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

/** Which shelf is open, over its guide: the numbers mean something else on each level (#1226) */
export function ShelfName({ shelf }: { shelf: ReceptionShelf }) {
  const t = useTranslations('aiOffice.immersive.room.reception');
  return <p className={CAP}>{t(`shelves.${shelf}`)}</p>;
}

/** The guide panel of the reception: scrolls inside itself on a low screen instead of overflowing */
export const GUIDE_PANEL =
  'shrink-0 space-y-3 px-5 pt-4 pb-6 lg:max-h-full lg:w-[26rem] lg:overflow-y-auto';

/** A message in the middle of a board: nothing to show, or it could not be read */
export const BOARD_MESSAGE = 'm-auto max-w-md px-6 text-center text-base leading-relaxed';

/** A link out of the office to a page of the normal view */
export const DOOR_LINK =
  'inline-flex min-h-11 items-center gap-1 text-sm underline underline-offset-4 hover:text-white';
