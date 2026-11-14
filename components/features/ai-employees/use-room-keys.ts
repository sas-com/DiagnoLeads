import { type MutableRefObject, useEffect, useRef } from 'react';
import type { RoomKeys } from './office-room-contract';

/**
 * Hands the keys of a room (or of what is open in it) to the office while it is shown (#1142).
 * The office always calls the handler of the latest render.
 */
export function useRoomKeys(keysRef: MutableRefObject<RoomKeys | null>, handler: RoomKeys) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    keysRef.current = (event) => latest.current(event);
    return () => {
      keysRef.current = null;
    };
  }, [keysRef]);
}
