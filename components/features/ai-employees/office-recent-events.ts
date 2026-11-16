/**
 * What really just happened to an AI employee in the full-screen office (#1148): it was hired, or
 * called back from its rest. The 3D robot shows it for a short while (a cheer over its status,
 * `office-emotion.ts`), and the staff list says it in words.
 *
 * Only what was carried out is noted here, by the answer of the server: never something made up,
 * and never an order that failed. The while starts once the employee stands still: a robot on its
 * way back from the charging station cheers when it arrives, not unseen in the corridor.
 */
import type { AiEmployeeRole } from '@/lib/features/ai-employees/types/roles';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { OfficeEvent } from './office-3d/office-emotion';

/** How long an employee shows what just happened to it, once it stands still */
export const EVENT_SHOWN_MS = 8000;

export type RecentEvents = Partial<Record<AiEmployeeRole, OfficeEvent>>;

/**
 * The events of the last moments, by role, and the way to note one. `walking` tells who is on
 * the way to another room: their while does not run until they arrive.
 */
export function useRecentEvents(
  walking: Partial<Record<AiEmployeeRole, boolean>>
): [events: RecentEvents, note: (role: AiEmployeeRole, event: OfficeEvent) => void] {
  const [events, setEvents] = useState<RecentEvents>({});
  const timers = useRef<Partial<Record<AiEmployeeRole, number>>>({});

  const note = useCallback((role: AiEmployeeRole, event: OfficeEvent) => {
    // A new event starts its own while
    window.clearTimeout(timers.current[role]);
    timers.current[role] = undefined;
    setEvents((current) => ({ ...current, [role]: event }));
  }, []);

  useEffect(() => {
    for (const role of Object.keys(events) as AiEmployeeRole[]) {
      if (walking[role]) {
        // On its way: the while starts over when it arrives
        window.clearTimeout(timers.current[role]);
        timers.current[role] = undefined;
      } else if (timers.current[role] === undefined) {
        timers.current[role] = window.setTimeout(() => {
          timers.current[role] = undefined;
          setEvents((current) => {
            const { [role]: _over, ...rest } = current;
            return rest;
          });
        }, EVENT_SHOWN_MS);
      }
    }
  }, [events, walking]);

  // Leaving the office ends every while
  useEffect(
    () => () => {
      for (const timer of Object.values(timers.current)) window.clearTimeout(timer);
    },
    []
  );

  return [events, note];
}
