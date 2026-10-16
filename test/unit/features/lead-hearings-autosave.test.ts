/**
 * Hearing autosave queue (Refs #96)
 */
import { HearingAutosaveQueue, autosaveStatus } from '@/lib/features/lead-hearings/autosave';
import { describe, expect, it } from 'vitest';

describe('HearingAutosaveQueue', () => {
  it('skips an automatic save without edits, but always runs a manual one', () => {
    const queue = new HearingAutosaveQueue();
    expect(queue.request()).toBe('skip');
    expect(queue.request(true)).toBe('start');
  });

  it('saves the edits made before the save started', () => {
    const queue = new HearingAutosaveQueue();
    queue.edit();
    expect(queue.dirty).toBe(true);
    expect(queue.request()).toBe('start');
    expect(queue.saving).toBe(true);
    expect(queue.succeeded()).toEqual({
      manual: false,
      editedDuring: false,
      again: false,
      againManual: false,
    });
    expect(queue.dirty).toBe(false);
  });

  it('queues a request while a save is in flight and asks for it after success', () => {
    const queue = new HearingAutosaveQueue();
    queue.edit();
    queue.request();
    queue.edit();
    expect(queue.request()).toBe('queued');
    expect(queue.succeeded()).toMatchObject({ editedDuring: true, again: true });
    expect(queue.dirty).toBe(true);
    expect(queue.request()).toBe('start');
    expect(queue.succeeded()).toMatchObject({ again: false });
    expect(queue.dirty).toBe(false);
  });

  it('does not ask again when the edit made in flight already has its own timer', () => {
    const queue = new HearingAutosaveQueue();
    queue.edit();
    queue.request();
    queue.edit();
    // No request while in flight: the debounce of the new edit will ask later
    expect(queue.succeeded()).toMatchObject({ editedDuring: true, again: false });
    expect(queue.dirty).toBe(true);
  });

  it('runs a manual save queued behind an automatic one even without new edits', () => {
    const queue = new HearingAutosaveQueue();
    queue.edit();
    queue.request();
    expect(queue.request(true)).toBe('queued');
    expect(queue.succeeded()).toMatchObject({ again: true, againManual: true });
  });

  it('blocks automatic saves after a conflict until reset or a manual save', () => {
    const queue = new HearingAutosaveQueue();
    queue.edit();
    queue.request();
    expect(queue.failedWith(true)).toEqual({ manual: false });
    expect(queue.isBlocked).toBe(true);
    queue.edit();
    expect(queue.request()).toBe('skip');
    expect(queue.dirty).toBe(true);

    expect(queue.request(true)).toBe('start');
    expect(queue.isBlocked).toBe(false);
    queue.failedWith(true);
    queue.reset();
    expect(queue.isBlocked).toBe(false);
    expect(queue.dirty).toBe(false);
  });

  it('drops a queued save when the save in flight fails', () => {
    const queue = new HearingAutosaveQueue();
    queue.edit();
    queue.request();
    queue.edit();
    queue.request();
    queue.failedWith(false);
    expect(queue.snapshot()).toEqual({ saving: false, dirty: true, blocked: false, failed: true });
    // The next edit tries again
    queue.edit();
    expect(queue.request()).toBe('start');
  });

  it('frees the queue when a save could not be sent', () => {
    const queue = new HearingAutosaveQueue();
    queue.edit();
    queue.request();
    queue.abort();
    expect(queue.saving).toBe(false);
    expect(queue.request()).toBe('start');
  });
});

describe('autosaveStatus', () => {
  const base = { saving: false, dirty: false, blocked: false, failed: false };
  const at = new Date('2026-10-15T01:00:00Z');

  it.each([
    [{ ...base, saving: true, dirty: true }, at, 'saving'],
    [{ ...base, dirty: true }, at, 'unsaved'],
    [{ ...base, dirty: true, failed: true }, null, 'failed'],
    [base, at, 'saved'],
    [base, null, 'idle'],
  ] as const)('%o → %s', (snapshot, lastSavedAt, expected) => {
    expect(autosaveStatus(snapshot, lastSavedAt)).toBe(expected);
  });
});
