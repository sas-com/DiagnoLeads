/**
 * Leaving signed out (#1057): the organization chosen on this browser is dropped, and the next
 * page is loaded as a new one, without what this one read (the query cache, in memory)
 */
import { leaveSignedOut } from '@/lib/auth/leave-signed-out';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'diagnoleads:current-organization';
const location = { assign: vi.fn(), replace: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom does not load pages
  vi.stubGlobal('location', location);
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ id: 'org-a', organization: { id: 'org-a', name: '架空商事' } })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('leaveSignedOut', () => {
  it('drops the organization chosen, then loads the page as a new one', () => {
    location.assign.mockImplementationOnce(() => {
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    leaveSignedOut('/ja/login');

    expect(location.assign).toHaveBeenCalledWith('/ja/login');
    expect(location.replace).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('keeps the page left out of the history when asked', () => {
    leaveSignedOut('/ja/login?accountDeleted=1', { replace: true });

    expect(location.replace).toHaveBeenCalledWith('/ja/login?accountDeleted=1');
    expect(location.assign).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('leaves all the same when the storage cannot be written', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    leaveSignedOut('/ja/login');

    expect(location.assign).toHaveBeenCalledWith('/ja/login');
  });
});
