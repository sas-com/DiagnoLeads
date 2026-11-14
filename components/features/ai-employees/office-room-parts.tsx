'use client';

import type { DeskStatus } from '@/lib/features/ai-employees/office';
import type { RobotLook } from '@/lib/features/ai-employees/types/profile';
import type { AiEmployeeRole } from '@/lib/features/ai-employees/types/roles';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { FOCUS, KEY } from './office-hud';
import { ROLE_ACCENTS } from './office-robot';
import { RobotPortrait } from './office-scene-svg';

/** Whose room this is: the AI employee of the room (or its vacant seat) with its status */
export function RoomGuideHeader({
  role,
  status,
  employeeName,
  look,
}: {
  role: AiEmployeeRole;
  status: DeskStatus;
  /** Null while the seat is vacant: the role is named instead */
  employeeName: string | null;
  /** How the employee was customized (#1134) */
  look?: RobotLook;
}) {
  const tOffice = useTranslations('aiOffice');
  const roleTitle = tOffice(`roles.${role}.title`);
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden="true"
        style={{ borderColor: ROLE_ACCENTS[role] }}
        className="flex h-14 w-14 shrink-0 items-end justify-center overflow-hidden border-2 bg-[#f2f2f2]"
      >
        <RobotPortrait role={role} status={status} look={look} className="h-[4.75rem] w-14" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-lg font-bold">{employeeName ?? roleTitle}</p>
        <p className="text-sm text-[#d8d2c4]">
          {roleTitle}・{tOffice(`status.${status}`)}
        </p>
      </div>
    </div>
  );
}

/** The frame of a room: the guide panel on the left, the room's board on the right */
export const ROOM_FRAME =
  'absolute inset-x-4 top-20 bottom-4 flex flex-col gap-4 overflow-y-auto lg:inset-x-6 lg:bottom-6 lg:flex-row lg:items-end lg:overflow-visible';

/** The board, the file or the card on the room's wall */
export const ROOM_BOARD =
  'flex min-h-[30rem] min-w-0 flex-1 flex-col border border-[#e9cf9a]/45 border-t-[3px] border-t-[#e9cf9a] bg-[linear-gradient(180deg,rgba(12,17,30,0.96)_0%,rgba(9,13,24,0.94)_100%)] shadow-[0_30px_60px_rgba(2,5,12,0.6)] lg:self-stretch';

/** A choice of the president: the main one is filled */
export function choiceClass(main: boolean): string {
  return main
    ? 'border-[#e9cf9a] bg-[#e9cf9a] text-[#1b2130]'
    : 'border-[#f5f1e8]/35 bg-[#f5f1e8]/5 hover:border-[#e9cf9a] hover:bg-[#f5f1e8]/15';
}

/**
 * An answer of the president in a room, with its key. One that is not carried out right now stays
 * in its place, dimmed: it is `aria-disabled` and not `disabled`, so it keeps the focus and the
 * room's keys keep working.
 */
export function RoomChoiceButton({
  keyCap,
  main = false,
  closed = false,
  waiting = false,
  pressed,
  onClick,
  children,
}: {
  keyCap: string;
  /** The answer the room expects next, or the one that is on: filled */
  main?: boolean;
  /** Not carried out right now */
  closed?: boolean;
  /** Closed only for a moment (reading, saving) */
  waiting?: boolean;
  /** For an answer that switches something on: whether it is on */
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const filled = main && !closed;
  return (
    <button
      type="button"
      aria-disabled={closed || undefined}
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'flex min-h-11 w-full items-center gap-3 border px-3 text-left text-sm font-bold',
        closed
          ? cn(
              'border-[#f5f1e8]/35 bg-[#f5f1e8]/5 opacity-45',
              waiting ? 'cursor-wait' : 'cursor-not-allowed'
            )
          : choiceClass(filled),
        FOCUS
      )}
    >
      <span className={cn(KEY, filled && 'border-[#1b2130]/60')}>{keyCap}</span>
      {children}
    </button>
  );
}

/** The line that says who holds the room, over the room's report */
export function RoomGuideLine({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-relaxed text-[#d8d2c4]">{children}</p>;
}

/** What a board says instead of its rows: nothing to show, no permission, or reading failed */
export function RoomBoardMessage({ children }: { children: ReactNode }) {
  return <p className="m-auto max-w-md px-6 text-center text-base leading-relaxed">{children}</p>;
}

/** A board that is still reading */
export function RoomBoardLoading({ children }: { children: ReactNode }) {
  return (
    <output className="m-auto flex items-center gap-3 text-sm text-[#d8d2c4]">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      {children}
    </output>
  );
}
