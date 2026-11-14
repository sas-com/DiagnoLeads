'use client';

import { isImeKey } from '@/components/ui/ime';
import type { DeskStatus } from '@/lib/features/ai-employees/office';
import type { RobotLook } from '@/lib/features/ai-employees/types/profile';
import type { AiEmployeeRole } from '@/lib/features/ai-employees/types/roles';
import { cn } from '@/lib/utils';
import { ChevronRight } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { type MutableRefObject, useEffect, useRef } from 'react';
import { FOCUS, PANEL } from './office-hud';
import type { RoomKeys } from './office-lead-file';
import { ShelfBackButton } from './office-reception-parts';
import { ROOM_BOARD, ROOM_FRAME, RoomGuideHeader, RoomGuideLine } from './office-room-parts';
import { nextRow, roomGuide } from './office-rooms';
import { SETTINGS_DOORS } from './rooms/reception';

/**
 * The settings shelf of the reception (#1196): the doors to the settings pages of the normal
 * view, in the order of the side menu. Nothing is changed here; a door closes the office and opens
 * its page. The arrows move over the doors, Enter opens the one in focus (it is a link).
 */
export function OfficeRoomSettings({
  role,
  status,
  employeeName,
  look,
  keysRef,
  onOpenNormal,
  onBack,
}: {
  role: AiEmployeeRole;
  status: DeskStatus;
  /** The name of the AI employee of the room; null while the seat is vacant */
  employeeName: string | null;
  look?: RobotLook;
  /** Filled with the shelf's key handler while the shelf is shown */
  keysRef: MutableRefObject<RoomKeys | null>;
  /** A page of the normal view is opened: the office closes */
  onOpenNormal: () => void;
  /** Back to the counter */
  onBack: () => void;
}) {
  const t = useTranslations('aiOffice.immersive.room');
  const tShelf = useTranslations('aiOffice.immersive.room.reception.settingsShelf');
  const tOffice = useTranslations('aiOffice');
  const tNav = useTranslations('navigation');
  const locale = useLocale();
  const listRef = useRef<HTMLUListElement>(null);
  const roleTitle = tOffice(`roles.${role}.title`);

  useEffect(() => {
    keysRef.current = (event) => {
      // A key of a Japanese conversion (IME) belongs to what is being typed
      if (isImeKey(event)) return false;
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return false;
      const doors = [...(listRef.current?.querySelectorAll<HTMLElement>('a') ?? [])];
      const current = doors.indexOf(document.activeElement as HTMLElement);
      const next = nextRow(current, event.key === 'ArrowDown' ? 1 : -1, doors.length);
      event.preventDefault();
      doors[next]?.focus();
      return true;
    };
    return () => {
      keysRef.current = null;
    };
  }, [keysRef]);

  return (
    <div className={ROOM_FRAME}>
      <div className={cn(PANEL, 'shrink-0 space-y-3 px-5 pt-4 pb-6 lg:w-[26rem]')}>
        <RoomGuideHeader role={role} status={status} employeeName={employeeName} look={look} />
        <div tabIndex={-1} data-autofocus="" className="space-y-2 outline-none">
          <RoomGuideLine>
            {t(`guide.${roomGuide(status)}`, { name: employeeName ?? roleTitle, role: roleTitle })}
          </RoomGuideLine>
          <p className="text-base leading-relaxed font-medium">{tShelf('report')}</p>
        </div>
        <ShelfBackButton onBack={onBack} />
      </div>

      <section aria-label={tShelf('board')} className={ROOM_BOARD}>
        <header className="border-b border-[#f5f1e8]/15 px-5 pt-4 pb-3">
          <h2 className="text-xl font-bold">{tShelf('board')}</h2>
        </header>
        <ul
          ref={listRef}
          className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto px-5 py-5 md:grid-cols-2"
        >
          {SETTINGS_DOORS.map((door) => (
            <li key={door.name}>
              <Link
                href={`/${locale}${door.path}`}
                onClick={onOpenNormal}
                className={cn(
                  'flex min-h-14 items-center justify-between gap-3 border border-[#f5f1e8]/35 bg-[#f5f1e8]/5 px-4 text-base font-bold hover:border-[#e9cf9a] hover:bg-[#f5f1e8]/15',
                  FOCUS
                )}
              >
                <span className="min-w-0 break-words">{tNav(door.name)}</span>
                <ChevronRight className="h-5 w-5 shrink-0 text-[#e9cf9a]" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
        <footer className="border-t border-[#f5f1e8]/15 px-5 py-3 text-sm text-[#d8d2c4]">
          {tShelf('note')}
        </footer>
      </section>
    </div>
  );
}
