'use client';

import { useEffect } from 'react';
import type { ProgressStore } from './progress-store';

/**
 * Save the answers whenever they or the step change, while `enabled` and something is answered
 * (the store's own isEmpty decides, the same check as when the answers are loaded)
 */
export function useProgressAutosave<Answers extends object>(
  store: ProgressStore<Answers>,
  { enabled, step, answers }: { enabled: boolean; step: number; answers: Answers }
) {
  useEffect(() => {
    if (!enabled || store.isEmpty(answers)) return;
    store.save({ step, answers });
  }, [store, enabled, step, answers]);
}
