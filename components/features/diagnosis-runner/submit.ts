'use client';

import { useCallback, useRef, useState } from 'react';

/** Shown under the form; a verification message goes away once a new check has passed */
export interface SubmitError {
  message: string;
  kind: 'verification' | 'other';
  /** Changes with every message, so the same text is announced again */
  run: number;
}

/** The message under the form, with a counter so a repeated message is announced again */
export function useSubmitError() {
  const [submitError, setSubmitErrorState] = useState<SubmitError | null>(null);
  const submitErrorRef = useRef(submitError);
  submitErrorRef.current = submitError;
  const setSubmitError = useCallback(
    (message: string | null, kind: SubmitError['kind'] = 'other') =>
      setSubmitErrorState((prev) =>
        message === null ? null : { message, kind, run: (prev?.run ?? 0) + 1 }
      ),
    []
  );
  return { submitError, submitErrorRef, setSubmitError };
}

/** Minutes until a rate limit ends, from Retry-After (undefined when it is not given) */
export function retryAfterMinutes(res: Response): number | undefined {
  const seconds = Number(res.headers?.get?.('Retry-After'));
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds / 60) : undefined;
}
