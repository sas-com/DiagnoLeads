/**
 * Hearing autosave queue (Refs #96)
 *
 * Framework-free bookkeeping behind the editor's autosave: which edits are saved, whether a
 * save is in flight, and whether another save has to follow it. Timers and the actual request
 * live in the editor; this only decides.
 * - Edits are counted; a save covers the edits made before it started.
 * - Only one save runs at a time. A request while one is in flight is queued and runs right
 *   after the first one succeeds (with the updatedAt that save returned).
 * - A CONFLICT blocks autosave until the form is reloaded or the user saves by hand.
 */

export type AutosaveRequestResult = 'start' | 'queued' | 'skip';

export interface AutosaveSnapshot {
  saving: boolean;
  dirty: boolean;
  blocked: boolean;
  /** The last save (manual or automatic) failed for another reason than a conflict */
  failed: boolean;
}

export interface AutosaveSettled {
  /** The save that just finished was started by the user (the save button) */
  manual: boolean;
  /** Edits were made while it was in flight (they are not in what was saved) */
  editedDuring: boolean;
  /** A queued save should start now */
  again: boolean;
  /** ...and it was the save button (it runs even without new edits) */
  againManual: boolean;
}

export class HearingAutosaveQueue {
  private revision = 0;
  private savedRevision = 0;
  private inFlight: { revision: number; manual: boolean } | null = null;
  private queued = false;
  private queuedManual = false;
  private blocked = false;
  private failed = false;

  /** A change on the form */
  edit(): void {
    this.revision++;
  }

  get dirty(): boolean {
    return this.revision !== this.savedRevision;
  }

  get saving(): boolean {
    return this.inFlight !== null;
  }

  get isBlocked(): boolean {
    return this.blocked;
  }

  snapshot(): AutosaveSnapshot {
    return {
      saving: this.saving,
      dirty: this.dirty,
      blocked: this.blocked,
      failed: this.failed,
    };
  }

  /**
   * Ask for a save. Automatic saves need unsaved edits and no unresolved conflict; a manual save
   * always runs (and clears a conflict, as the save button did before autosave).
   */
  request(manual = false): AutosaveRequestResult {
    if (!manual && (this.blocked || !this.dirty)) return 'skip';
    if (this.inFlight) {
      this.queued = true;
      this.queuedManual ||= manual;
      return 'queued';
    }
    if (manual) this.blocked = false;
    this.inFlight = { revision: this.revision, manual };
    return 'start';
  }

  /** The save could not be sent (e.g. invalid input); nothing is in flight */
  abort(): void {
    this.inFlight = null;
    this.clearQueue();
  }

  private clearQueue(): void {
    this.queued = false;
    this.queuedManual = false;
  }

  succeeded(): AutosaveSettled {
    const done = this.inFlight;
    this.inFlight = null;
    this.failed = false;
    if (!done) {
      return { manual: false, editedDuring: this.dirty, again: false, againManual: false };
    }
    this.savedRevision = done.revision;
    const againManual = this.queuedManual;
    const again = this.queued && (againManual || (this.dirty && !this.blocked));
    this.clearQueue();
    return { manual: done.manual, editedDuring: this.dirty, again, againManual };
  }

  failedWith(conflict: boolean): { manual: boolean } {
    const manual = this.inFlight?.manual ?? false;
    this.inFlight = null;
    this.clearQueue();
    if (conflict) this.blocked = true;
    else this.failed = true;
    return { manual };
  }

  /** The form was (re)loaded from the server: nothing unsaved, nothing blocked */
  reset(): void {
    this.revision = 0;
    this.savedRevision = 0;
    this.clearQueue();
    this.blocked = false;
    this.failed = false;
  }
}

export type AutosaveStatus = 'saving' | 'saved' | 'unsaved' | 'failed' | 'idle';

/** What the sticky bar says about saving */
export function autosaveStatus(
  snapshot: AutosaveSnapshot,
  lastSavedAt: Date | null
): AutosaveStatus {
  if (snapshot.saving) return 'saving';
  if (snapshot.dirty) return snapshot.failed ? 'failed' : 'unsaved';
  return lastSavedAt ? 'saved' : 'idle';
}
