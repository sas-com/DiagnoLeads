/** What every room of the full-screen office shares with the office that holds it: types only */

/**
 * The key a room is handed: enough of the browser's event to read the key and to tell whether it
 * belongs to a Japanese conversion (IME), which a room must never take as an answer
 */
export type RoomKeyEvent = Pick<KeyboardEvent, 'key' | 'isComposing' | 'keyCode'> & {
  preventDefault: () => void;
};

/** What the keys of a room do; true when the key was used */
export type RoomKeys = (event: RoomKeyEvent) => boolean;
