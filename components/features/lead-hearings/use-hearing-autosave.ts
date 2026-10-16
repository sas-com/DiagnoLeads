'use client';

import {
  type AutosaveSettled,
  type AutosaveSnapshot,
  HearingAutosaveQueue,
} from '@/lib/features/lead-hearings/autosave';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Save this long after the last change */
export const HEARING_AUTOSAVE_DELAY_MS = 3000;

interface UseHearingAutosaveOptions {
  /** false in read-only mode: edits are never saved automatically */
  enabled: boolean;
  /**
   * Send a save of the current form. Returns false when nothing was sent (invalid input).
   * The caller reports the result with saved() / failed().
   */
  start: (manual: boolean) => boolean;
  delayMs?: number;
}

/**
 * Autosave of the hearing editor (Refs #96): debounced after each change, and right away when
 * the tab is hidden, the page is left or the editor unmounts. One save at a time; see
 * HearingAutosaveQueue for the rules.
 */
export function useHearingAutosave({
  enabled,
  start,
  delayMs = HEARING_AUTOSAVE_DELAY_MS,
}: UseHearingAutosaveOptions) {
  const queue = useRef(new HearingAutosaveQueue());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef(start);
  startRef.current = start;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const [snapshot, setSnapshot] = useState<AutosaveSnapshot>(() => queue.current.snapshot());
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const publish = useCallback(() => setSnapshot(queue.current.snapshot()), []);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const flush = useCallback(
    (manual = false) => {
      clearTimer();
      if (!manual && !enabledRef.current) return;
      if (queue.current.request(manual) === 'start' && !startRef.current(manual)) {
        queue.current.abort();
      }
      publish();
    },
    [clearTimer, publish]
  );

  /** Call after every change of the form */
  const notifyEdit = useCallback(() => {
    queue.current.edit();
    publish();
    if (!enabledRef.current || queue.current.isBlocked) return;
    clearTimer();
    timer.current = setTimeout(() => {
      timer.current = null;
      flush();
    }, delayMs);
  }, [clearTimer, delayMs, flush, publish]);

  /** The save sent by start() succeeded; a queued save starts right away */
  const saved = useCallback((): AutosaveSettled => {
    const settled = queue.current.succeeded();
    setLastSavedAt(new Date());
    publish();
    if (settled.again) flush(settled.againManual);
    return settled;
  }, [flush, publish]);

  /** The save failed; a conflict stops autosave until reset() or a manual save */
  const failed = useCallback(
    (conflict: boolean) => {
      const result = queue.current.failedWith(conflict);
      if (conflict) clearTimer();
      publish();
      return result;
    },
    [clearTimer, publish]
  );

  /** The form was (re)loaded from the server */
  const reset = useCallback(() => {
    clearTimer();
    queue.current.reset();
    publish();
  }, [clearTimer, publish]);

  // Save right away when the tab is hidden or the page is left (best effort), and when the
  // editor goes away (navigation inside the app).
  useEffect(() => {
    const flushIfDirty = () => {
      if (queue.current.dirty) flush();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushIfDirty();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', flushIfDirty);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', flushIfDirty);
      flushIfDirty();
      clearTimer();
    };
  }, [flush, clearTimer]);

  return { snapshot, lastSavedAt, notifyEdit, flush, saved, failed, reset };
}
