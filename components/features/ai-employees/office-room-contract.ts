import type { DeskStatus } from '@/lib/features/ai-employees/office';
import type { RobotLook } from '@/lib/features/ai-employees/types/profile';
import type { AiEmployeeRole } from '@/lib/features/ai-employees/types/roles';
import type { MutableRefObject } from 'react';

/**
 * What every room of the full-screen office is given and gives back (#1142): one contract, so
 * that a room is added with its own files and a line of the registry (office-room-registry.tsx),
 * without the office itself knowing what the room holds. Types only.
 */

/**
 * The key a room is handed: enough of the browser's event to read the key and to tell whether it
 * belongs to a Japanese conversion (IME), which a room must never take as an answer
 */
export type RoomKeyEvent = Pick<KeyboardEvent, 'key' | 'isComposing' | 'keyCode'> & {
  preventDefault: () => void;
};

/** What the keys of a room do; true when the key was used */
export type RoomKeys = (event: RoomKeyEvent) => boolean;

/** The AI employee a room belongs to, as the office shows it */
export interface RoomEmployee {
  role: AiEmployeeRole;
  status: DeskStatus;
  /** Null while the seat is vacant: the role is named instead */
  name: string | null;
  /** How the employee was customized (#1134) */
  look?: RobotLook;
}

/** The props of every room */
export interface OfficeRoomProps {
  organizationId: string;
  /** The AI employee of the room; null for a room without one (the president's desk) */
  guide: RoomEmployee | null;
  /** Filled with the room's key handler while the room is shown */
  keysRef: MutableRefObject<RoomKeys | null>;
  /** A page of the normal view is opened from the room: the office closes */
  onLeaveOffice: () => void;
  /** Told when something opens or closes inside the room: while open, Esc closes it, not the room */
  onFileOpenChange: (open: boolean) => void;
  /**
   * Told while an answer given in the room is being saved, and when it no longer is: the office
   * keeps the room open meanwhile, since leaving would carry the answer out with nobody told what
   * came of it (#1205). A room that never tells is never held.
   */
  onBusyChange: (busy: boolean) => void;
}
