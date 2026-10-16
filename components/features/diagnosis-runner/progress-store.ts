/**
 * Answers kept in this browser so a respondent can continue later (never contact details).
 * A saved entry is dropped when it is older than the TTL or was saved for another version of
 * the diagnosis; storage errors (private mode) are ignored.
 */

export interface SavedProgress<Answers> {
  version: number;
  savedAt: number;
  step: number;
  answers: Answers;
}

interface ProgressStoreOptions<Answers> {
  /** localStorage key */
  key: string;
  /** Version of the diagnosis definition the answers belong to */
  version: number;
  /** How long saved answers are offered again */
  ttlMs: number;
  /** Keep only answers that still fit the definition */
  sanitize: (answers: Record<string, unknown>) => Answers;
  /** Whether nothing is left to continue with */
  isEmpty: (answers: Answers) => boolean;
}

export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function createProgressStore<Answers>({
  key,
  version,
  ttlMs,
  sanitize,
  isEmpty,
}: ProgressStoreOptions<Answers>) {
  const load = (now: number = Date.now()): SavedProgress<Answers> | null => {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<SavedProgress<unknown>>;
      const fresh =
        parsed.version === version &&
        typeof parsed.savedAt === 'number' &&
        now - parsed.savedAt < ttlMs &&
        typeof parsed.step === 'number' &&
        typeof parsed.answers === 'object' &&
        parsed.answers !== null;
      if (!fresh) {
        window.localStorage.removeItem(key);
        return null;
      }
      const answers = sanitize(parsed.answers as Record<string, unknown>);
      if (isEmpty(answers)) return null;
      return { ...(parsed as SavedProgress<unknown>), answers };
    } catch {
      return null;
    }
  };

  /** Save the answers and the current step; null removes what was saved */
  const save = (progress: { step: number; answers: Answers } | null, now: number = Date.now()) => {
    try {
      if (progress) {
        const saved: SavedProgress<Answers> = { version, savedAt: now, ...progress };
        window.localStorage.setItem(key, JSON.stringify(saved));
      } else {
        window.localStorage.removeItem(key);
      }
    } catch {
      // Storage may be unavailable (private mode); the diagnosis still works without it
    }
  };

  return { load, save, clear: () => save(null), isEmpty };
}

export type ProgressStore<Answers> = ReturnType<typeof createProgressStore<Answers>>;
