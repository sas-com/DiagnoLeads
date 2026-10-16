/** Focus and scrolling between steps, respecting prefers-reduced-motion */

export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/** Smooth scrolling unless the respondent asked for less motion */
export const scrollBehavior = (): ScrollBehavior => (prefersReducedMotion() ? 'auto' : 'smooth');

/** Scroll a step (or the result) to the top of the view */
export function scrollToStart(element: HTMLElement | null | undefined): void {
  element?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
}

/**
 * Bring the first invalid field into view and focus it. The id may name the input itself or
 * an element inside a fieldset (such as its legend): then the group's first control is focused.
 */
export function focusFirstError(elementId: string): void {
  requestAnimationFrame(() => {
    const element = document.getElementById(elementId);
    if (!element) return;
    element.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
    const target =
      element instanceof HTMLInputElement || element instanceof HTMLButtonElement
        ? element
        : element.closest('fieldset')?.querySelector<HTMLElement>('button, input');
    target?.focus({ preventScroll: true });
  });
}
