/**
 * A key of a conversion (IME): one open, or the Enter or Esc that confirms or cancels it, which
 * Safari sends after compositionend, with isComposing false and keyCode 229 (#722, #969)
 */
export const isImeKey = (event: Pick<KeyboardEvent, 'isComposing' | 'keyCode'>) =>
  event.isComposing || event.keyCode === 229;

/**
 * For the onEscapeKeyDown of a Radix dialog: the Esc that cancels a conversion only ends the
 * conversion, so the dialog stays open and keeps what was typed (#969). A caller's own handler
 * still runs for a plain Esc.
 */
export function ignoreImeEscape(onEscapeKeyDown?: (event: KeyboardEvent) => void) {
  return (event: KeyboardEvent) => {
    if (isImeKey(event)) {
      event.preventDefault();
      return;
    }
    onEscapeKeyDown?.(event);
  };
}
