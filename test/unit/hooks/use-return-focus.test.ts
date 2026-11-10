/**
 * The focus given back to the control that opened a dialog without a dialog trigger (#720, #776)
 */
import { useReturnFocus } from '@/hooks/use-return-focus';
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

/** A dialog's close, as Radix sends it to onCloseAutoFocus: preventDefault keeps its own */
const closing = () => new Event('focusScope.autoFocusOnUnmount', { cancelable: true });

const button = (name: string) => {
  const element = document.createElement('button');
  element.textContent = name;
  document.body.append(element);
  return element;
};

afterEach(() => {
  document.body.replaceChildren();
});

describe('useReturnFocus', () => {
  it('gives the focus back to the control its ref is on, instead of Radix', () => {
    const { result } = renderHook(() => useReturnFocus<HTMLButtonElement>());
    const opener = button('活動を記録');
    result.current.ref.current = opener;

    const event = closing();
    result.current.onCloseAutoFocus(event);

    expect(opener).toHaveFocus();
    expect(event.defaultPrevented).toBe(true);
  });

  it('gives it back to the control remembered last, of those that open the dialog', () => {
    const { result } = renderHook(() => useReturnFocus());
    const fromMenu = button('編集');
    const fromCard = button('次の行動を編集');
    result.current.remember(fromMenu);
    result.current.remember(fromCard);

    result.current.onCloseAutoFocus(closing());

    expect(fromCard).toHaveFocus();
  });

  it('leaves the dialog to do as it does once the control left the screen', () => {
    const { result } = renderHook(() => useReturnFocus());
    const opener = button('活動を記録');
    result.current.remember(opener);
    opener.remove();

    const event = closing();
    result.current.onCloseAutoFocus(event);

    expect(event.defaultPrevented).toBe(false);
    expect(document.body).toHaveFocus();
  });
});
