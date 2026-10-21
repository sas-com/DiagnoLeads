'use client';

import { useEffect, useMemo, useRef } from 'react';
import { createStepHistory, newRunId } from './step-history';

interface UseStepHistoryOptions<Pending> {
  /** Key of the step entries in history.state */
  historyKey: string;
  /** Only while the questions are shown does the browser's back button move between steps */
  active: boolean;
  /**
   * The browser moved to a step entry of the current run. `pending` is what `back` left for
   * that step (e.g. errors to show there), or null.
   */
  onStep: (step: number, pending: Pending | null) => void;
}

/**
 * Keeps the steps of a diagnosis in the browser history: forward moves push an entry, the page's
 * back button goes back through the same entries, and a finished run is rewound so the browser's
 * back button then leaves the page.
 */
export function useStepHistory<Pending = never>({
  historyKey,
  active,
  onStep,
}: UseStepHistoryOptions<Pending>) {
  const history = useMemo(() => createStepHistory(historyKey), [historyKey]);
  /** Each run (including starting again) owns its own history entries */
  const runRef = useRef(newRunId());
  /** Set while the entries of a finished run are rewound (that popstate is ignored) */
  const rewinding = useRef(false);
  /** Left by `back` for the step the browser is moving to */
  const pending = useRef<Pending | null>(null);
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;
  const activeRef = useRef(active);
  activeRef.current = active;

  // Steps scroll themselves into view; the browser's own restoring would fight with that
  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, []);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      if (rewinding.current) {
        rewinding.current = false;
        return;
      }
      const entry = history.read(event.state);
      // Entries of another run, or of the page itself, are not steps of this one
      if (!entry || entry.run !== runRef.current || !activeRef.current) return;
      const left = pending.current;
      pending.current = null;
      onStepRef.current(entry.step, left);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [history]);

  return useMemo(
    () => ({
      /** Mark the current entry as this step of the current run */
      stamp: (step: number) => history.stamp(runRef.current, step),
      /** Add an entry for a forward move */
      push: (step: number) => history.push(runRef.current, step),
      /**
       * Go back like the browser's back button, so both buttons walk the same entries. Returns
       * false when the current entry is not `current` of this run: then the caller moves in place
       * (and stamps the entry).
       */
      back: (target: number, current: number, leave?: Pending): boolean => {
        const entry = history.read();
        if (entry?.run === runRef.current && entry.step === current && target < current) {
          pending.current = leave ?? null;
          window.history.go(target - current);
          return true;
        }
        return false;
      },
      /**
       * Leave the entries of a finished run: the browser's back button then leaves the page.
       * `base` is the step of the run's first entry (a run may start past step 0).
       */
      rewind: (base = 0) => {
        const entry = history.read();
        if (entry?.run === runRef.current && entry.step > base) {
          rewinding.current = true;
          window.history.go(base - entry.step);
        }
      },
      /** Start a new run; entries of the previous one are no longer steps */
      restart: () => {
        runRef.current = newRunId();
      },
    }),
    [history]
  );
}
