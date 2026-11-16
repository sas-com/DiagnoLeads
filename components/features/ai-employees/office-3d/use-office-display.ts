'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { officeFits } from '../office-app';
import {
  DEFAULT_DISPLAY,
  type FpsWatch,
  NEW_FPS_WATCH,
  type OfficeDisplay,
  type StoredDisplay,
  firstDisplay,
  mayFallBack,
  readDisplay,
  watchFps,
  webglAvailable,
  writeDisplay,
} from './office-display';

/**
 * Why the office shows the 2D floor although 3D was wanted: it could not be shown (the chunk, a
 * render error), it was too slow on this device, or this browser gives no WebGL at all
 */
export type DisplayNote = 'failed' | 'slow' | 'unavailable';

/** The storage of this browser, or null where it may not be touched (private mode, a sandbox) */
function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Which floor the full-screen office shows (#1150), for the office to keep in one place: it
 * starts with what this device remembers (else the default), remembers what the person chooses,
 * and watches once how fast the 3D floor is drawn, so a slow device gets the 2D floor and is
 * told so. The rules are the pure functions of office-display.ts.
 */
export function useOfficeDisplay({ reducedMotion }: { reducedMotion: boolean }) {
  const [threeD, setThreeD] = useState(false);
  const [note, setNote] = useState<DisplayNote | null>(null);
  const kept = useRef<{ stored: StoredDisplay | null; chose: boolean; watch: FpsWatch }>({
    stored: null,
    chose: false,
    watch: NEW_FPS_WATCH,
  });
  const still = useRef(reducedMotion);
  still.current = reducedMotion;

  // Decided once, in the browser: the width and WebGL are not known on the server
  useEffect(() => {
    const stored = readDisplay(browserStorage());
    kept.current.stored = stored;
    const fits = officeFits(window.innerWidth);
    const wanted = stored?.display ?? DEFAULT_DISPLAY;
    // Asked only where 3D is wanted: a browser that starts in 2D is not asked for a context
    const webgl = fits && wanted === '3d' && webglAvailable();
    if (firstDisplay({ stored, fits, webgl, preferred: DEFAULT_DISPLAY }) === '3d') {
      setThreeD(true);
    } else if (fits && wanted === '3d') {
      setNote('unavailable');
    } else if (fits && stored?.reason === 'slow') {
      // 2D because 3D was slow here last time: said again, with the way to try once more
      setNote('slow');
    }
  }, []);

  // A page that was hidden drew nothing meanwhile: the count starts over when it comes back
  useEffect(() => {
    const restart = () => {
      if (!kept.current.watch.done) kept.current.watch = NEW_FPS_WATCH;
    };
    document.addEventListener('visibilitychange', restart);
    return () => document.removeEventListener('visibilitychange', restart);
  }, []);

  /** The person switches: remembered on this device, and never overruled by the watch */
  const choose = useCallback((display: OfficeDisplay) => {
    kept.current.chose = true;
    kept.current.watch = NEW_FPS_WATCH;
    kept.current.stored = { display, reason: 'chosen' };
    writeDisplay(browserStorage(), kept.current.stored);
    setNote(null);
    setThreeD(display === '3d');
  }, []);

  /** The office leaves 3D by itself, for a reason it says: nothing is remembered but slowness */
  const fallBack = useCallback((why: DisplayNote) => {
    kept.current.watch = NEW_FPS_WATCH;
    if (why === 'slow') {
      kept.current.stored = { display: '2d', reason: 'slow' };
      writeDisplay(browserStorage(), kept.current.stored);
    }
    setNote(why);
    setThreeD(false);
  }, []);

  /** One report of the frame rate of the 3D floor: true once, when the device proved too slow */
  const tooSlow = useCallback((fps: number): boolean => {
    const { watch, verdict } = watchFps(kept.current.watch, fps, {
      counts: !document.hidden && !still.current,
    });
    kept.current.watch = watch;
    return verdict === 'slow' && mayFallBack(kept.current.stored, kept.current.chose);
  }, []);

  return { threeD, note, choose, fallBack, tooSlow };
}
