/**
 * Steps as browser history entries, so the browser's back button and the page's own back button
 * walk the same steps. Each run (one pass through a diagnosis) has its own id; entries of other
 * runs, or of the page itself, are not steps of the current one.
 */

export interface StepEntry {
  run: string;
  step: number;
}

export const newRunId = (): string => Math.random().toString(36).slice(2, 10);

/**
 * The App Router's own keys in history.state. Next.js reloads the whole page when the browser
 * returns to an entry without them, and the entries the browser adds for in-page links
 * (#diagnosis) have none, so every entry written here carries them.
 */
let routerState: Record<string, unknown> | null = null;

const currentState = () => (window.history.state ?? {}) as Record<string, unknown>;

function isStepEntry(value: unknown): value is StepEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as StepEntry).run === 'string' &&
    typeof (value as StepEntry).step === 'number'
  );
}

/** Reads and writes step entries under one key of history.state (e.g. 'ax') */
export function createStepHistory(key: string) {
  const entryState = (run: string, step: number) => {
    const current = currentState();
    if (current.__NA) routerState = current;
    return { ...(current.__NA ? {} : routerState), ...current, [key]: { run, step } };
  };

  /** The step entry in a history state (the current one by default) */
  const read = (state: unknown = window.history.state): StepEntry | undefined => {
    const entry = (state as Record<string, unknown> | null)?.[key];
    return isStepEntry(entry) ? entry : undefined;
  };

  /** Mark the current history entry as a step */
  const stamp = (run: string, step: number) => {
    window.history.replaceState(entryState(run, step), '');
  };

  /** Add an entry for a step after the current one */
  const push = (run: string, step: number) => {
    // Entries the page added itself (such as #diagnosis) show the step before this one
    if (read()?.run !== run) stamp(run, Math.max(0, step - 1));
    window.history.pushState(entryState(run, step), '');
  };

  return { read, stamp, push };
}

export type StepHistory = ReturnType<typeof createStepHistory>;
