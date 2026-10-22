import { createStepHistory } from '@/components/features/diagnosis-runner/step-history';
import { useStepHistory } from '@/components/features/diagnosis-runner/use-step-history';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

/**
 * Go back and wait until the browser has moved (popstate fired). jsdom moves in two nested
 * timeouts, so a fixed sleep can end before the move when the test process stalls (#346).
 * Listeners added earlier (the hook's) run before this one resolves.
 */
const backAndSettle = () =>
  new Promise<void>((resolve) => {
    window.addEventListener('popstate', () => resolve(), { once: true });
    window.history.back();
  });

describe('createStepHistory', () => {
  const steps = createStepHistory('runner');

  it('keeps the router state in every entry it writes', () => {
    window.history.replaceState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: 'tree' }, '');
    steps.stamp('run-1', 0);
    expect(window.history.state).toMatchObject({ __NA: true, runner: { run: 'run-1', step: 0 } });
    // An entry the browser added for an in-page link has no router state
    window.history.pushState(null, '', '#diagnosis');
    steps.push('run-1', 1);
    expect(window.history.state).toMatchObject({
      __NA: true,
      __PRIVATE_NEXTJS_INTERNALS_TREE: 'tree',
      runner: { run: 'run-1', step: 1 },
    });
  });

  it('marks an entry of the page itself as the step before a pushed one', async () => {
    window.history.replaceState({ other: 1 }, '');
    steps.push('run-2', 3);
    expect(steps.read()).toEqual({ run: 'run-2', step: 3 });
    window.history.back();
    await waitFor(() => expect(steps.read()).toEqual({ run: 'run-2', step: 2 }));
    expect(window.history.state.other).toBe(1);
  });

  it('reads nothing from entries without a step', () => {
    expect(steps.read({ runner: { run: 'x' } })).toBeUndefined();
    expect(steps.read(null)).toBeUndefined();
  });
});

describe('useStepHistory', () => {
  const setup = (active = true) => {
    const onStep = vi.fn();
    const hook = renderHook(
      ({ isActive }) => useStepHistory<string>({ historyKey: 'runner', active: isActive, onStep }),
      { initialProps: { isActive: active } }
    );
    return { onStep, hook };
  };

  it('moves to the step of the entry the browser returns to', async () => {
    const { onStep, hook } = setup();
    act(() => {
      hook.result.current.stamp(0);
      hook.result.current.push(1);
      hook.result.current.push(2);
    });
    window.history.back();
    await waitFor(() => expect(onStep).toHaveBeenCalledWith(1, null));
  });

  it('goes back through history with the page button, carrying what the step should show', async () => {
    const { onStep, hook } = setup();
    act(() => {
      hook.result.current.stamp(0);
      hook.result.current.push(1);
      hook.result.current.push(2);
    });
    let viaHistory = false;
    act(() => {
      viaHistory = hook.result.current.back(0, 2, 'errors there');
    });
    expect(viaHistory).toBe(true);
    await waitFor(() => expect(onStep).toHaveBeenCalledWith(0, 'errors there'));
  });

  it('leaves the move to the caller when the current entry is not that step', () => {
    const { hook } = setup();
    act(() => hook.result.current.stamp(1));
    expect(hook.result.current.back(0, 2)).toBe(false);
  });

  it('ignores entries of another run, and all entries while inactive', async () => {
    const { onStep, hook } = setup();
    act(() => {
      hook.result.current.stamp(0);
      hook.result.current.push(1);
      hook.result.current.restart();
      hook.result.current.stamp(0);
      hook.result.current.push(1);
    });
    hook.rerender({ isActive: false });
    await backAndSettle();
    // Step 0 of the current run, ignored while inactive
    const current = window.history.state.runner;
    expect(current.step).toBe(0);
    hook.rerender({ isActive: true });
    await backAndSettle();
    // Step 0 of the previous run, ignored as another run's entry
    expect(window.history.state.runner).toMatchObject({ step: 0 });
    expect(window.history.state.runner.run).not.toBe(current.run);
    expect(onStep).not.toHaveBeenCalled();
  });

  it('rewinds a finished run without moving to its first step', async () => {
    const { onStep, hook } = setup();
    act(() => {
      hook.result.current.stamp(0);
      hook.result.current.push(1);
      hook.result.current.push(2);
    });
    const length = window.history.length;
    act(() => hook.result.current.rewind());
    await waitFor(() => expect(window.history.state.runner.step).toBe(0));
    expect(window.history.length).toBe(length);
    expect(onStep).not.toHaveBeenCalled();
  });

  it('turns off the browser scroll restoring while mounted', () => {
    window.history.scrollRestoration = 'auto';
    const { hook } = setup();
    expect(window.history.scrollRestoration).toBe('manual');
    hook.unmount();
    expect(window.history.scrollRestoration).toBe('auto');
  });
});
