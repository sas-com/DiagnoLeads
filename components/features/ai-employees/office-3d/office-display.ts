/**
 * Which floor the full-screen office shows, the 2D drawing or the 3D one (#1150): what it starts
 * with, what this device remembers, and when a device is too slow for 3D. The speed of drawing
 * belongs to the device, not to the account, so the choice is kept in this browser.
 *
 * Pure functions: the office (office-immersive.tsx) only keeps the state.
 */

export type OfficeDisplay = '2d' | '3d';

/** The floor the office starts with where nothing else decides (owner, 2026-11-14: 3D) */
export const DEFAULT_DISPLAY: OfficeDisplay = '3d';

/**
 * Below this many frames a second, on average, a device is too slow for the 3D floor and gets
 * the 2D one. Provisional (owner, 2026-11-16): the only measure so far is 60 on the owner's
 * machine. To be set again once weak laptops, phones and tablets were measured.
 */
export const SLOW_FPS = 20;
/** The first reports after the 3D floor appeared are not counted: shaders and textures warm up */
export const WARM_UP_REPORTS = 3;
/** How many reports (one a second) the verdict is the average of */
export const MEASURED_REPORTS = 5;

/** Why this device remembers a display: the person chose it, or 3D was too slow here */
export type DisplayReason = 'chosen' | 'slow';

export interface StoredDisplay {
  display: OfficeDisplay;
  reason: DisplayReason;
}

/** Where the choice is kept in this browser */
export const DISPLAY_KEY = 'diagnoleads.office.display';

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

/** What this device remembers, or null: nothing kept, something else kept, or no storage */
export function readDisplay(storage: Storage | null | undefined): StoredDisplay | null {
  try {
    const raw = storage?.getItem(DISPLAY_KEY);
    if (!raw) return null;
    const kept = JSON.parse(raw) as Partial<StoredDisplay> | null;
    if (
      (kept?.display === '2d' || kept?.display === '3d') &&
      (kept.reason === 'chosen' || kept.reason === 'slow')
    ) {
      return { display: kept.display, reason: kept.reason };
    }
    return null;
  } catch {
    // Private mode, a full or blocked storage: the office starts as if nothing was kept
    return null;
  }
}

/** Keeps the display for the next visit; a storage that refuses is ignored */
export function writeDisplay(storage: Storage | null | undefined, kept: StoredDisplay): void {
  try {
    storage?.setItem(DISPLAY_KEY, JSON.stringify(kept));
  } catch {
    // Nothing to do: the office works without remembering
  }
}

/**
 * The floor the office starts with: what the person chose here before, else 2D where 3D was
 * too slow, else the default. Never 3D where the office is too narrow for its panels or the
 * browser gives no WebGL.
 */
export function firstDisplay({
  stored,
  fits,
  webgl,
  preferred = DEFAULT_DISPLAY,
}: {
  stored: StoredDisplay | null;
  /** Whether the screen is wide enough for the full-screen office */
  fits: boolean;
  webgl: boolean;
  preferred?: OfficeDisplay;
}): OfficeDisplay {
  if (!fits || !webgl) return '2d';
  return stored?.display ?? preferred;
}

/**
 * Whether the 3D floor may be taken away by itself when it is slow: only where the person never
 * chose 3D, neither on an earlier visit nor during this one. A choice is not overruled.
 */
export function mayFallBack(stored: StoredDisplay | null, choseThisVisit: boolean): boolean {
  return !choseThisVisit && !(stored?.display === '3d' && stored.reason === 'chosen');
}

/** The reports of the frame rate gathered so far, and whether the verdict was given */
export interface FpsWatch {
  skipped: number;
  measured: readonly number[];
  done: boolean;
}

export const NEW_FPS_WATCH: FpsWatch = { skipped: 0, measured: [], done: false };

/**
 * Takes one report of the frame rate (the 3D floor reports once a second) and says, once, whether
 * the device is slow. A report does not count while the page is hidden (a hidden page draws
 * nothing, which is not slowness) or while the floor draws only on a change (less motion). The
 * warm-up is skipped; then the average of the next reports decides, and nothing is watched after.
 */
export function watchFps(
  watch: FpsWatch,
  fps: number,
  { counts }: { counts: boolean }
): { watch: FpsWatch; verdict: 'slow' | 'fine' | null } {
  if (watch.done || !counts) return { watch, verdict: null };
  if (watch.skipped < WARM_UP_REPORTS) {
    return { watch: { ...watch, skipped: watch.skipped + 1 }, verdict: null };
  }
  const measured = [...watch.measured, fps];
  if (measured.length < MEASURED_REPORTS) return { watch: { ...watch, measured }, verdict: null };
  const average = measured.reduce((sum, value) => sum + value, 0) / measured.length;
  return {
    watch: { ...watch, measured, done: true },
    verdict: average < SLOW_FPS ? 'slow' : 'fine',
  };
}

/**
 * Whether this browser gives a WebGL context at all. Asked before the 3D floor is loaded, so a
 * browser without it never fetches three.js. Where the browser does not even know WebGL (and in
 * the unit tests) no canvas is asked for a context.
 */
export function webglAvailable(view: typeof globalThis | undefined = globalThis): boolean {
  try {
    if (!view?.document || !('WebGLRenderingContext' in view)) return false;
    const canvas = view.document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}
