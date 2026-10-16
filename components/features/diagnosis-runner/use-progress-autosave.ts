'use client';

import { useEffect } from 'react';
import type { ProgressStore } from './progress-store';

/** Save the answers whenever they or the step change, while `enabled` and something is answered */
export function useProgressAutosave<Answers extends object>(
  store: ProgressStore<Answers>,
  { enabled, step, answers }: { enabled: boolean; step: number; answers: Answers }
) {
  useEffect(() => {
    if (!enabled || Object.keys(answers).length === 0) return;
    store.save({ step, answers });
  }, [store, enabled, step, answers]);
}
