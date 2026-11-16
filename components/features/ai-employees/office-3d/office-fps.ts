'use client';

import { useSyncExternalStore } from 'react';

/**
 * How fast the 3D floor is drawn, kept out of the office's state (#1270). The canvas reports a
 * figure every second; were it the office's state, the whole full-screen office (the 2D drawing,
 * the name tags, the 3D canvas's props) would render again each second. Only what shows the figure
 * reads it, through `useFps`.
 */
export interface FpsMeter {
  /** What the canvas calls each second: stable, so passing it renders nothing again */
  report: (fps: number) => void;
  /** Forget the figure (the 3D floor was left) */
  reset: () => void;
  subscribe: (listener: () => void) => () => void;
  get: () => number | null;
}

export function createFpsMeter(): FpsMeter {
  let value: number | null = null;
  const listeners = new Set<() => void>();
  const set = (next: number | null) => {
    if (next === value) return;
    value = next;
    for (const listener of listeners) listener();
  };
  return {
    report: (fps) => set(fps),
    reset: () => set(null),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get: () => value,
  };
}

/** The last figure of a meter, or null; renders only the component that calls it */
export function useFps(meter: FpsMeter): number | null {
  return useSyncExternalStore(meter.subscribe, meter.get, () => null);
}
