/**
 * Tap targets on phones (#196): at least 44px (h-11) below md, so a finger hits them, while
 * desktop keeps the control's own compact height. Add it next to the control's height class
 * (min-height wins over height), the same idea as TAP_SELECT of the lead card (#110).
 */
export const TAP_TARGET = 'min-h-11 md:min-h-0';
