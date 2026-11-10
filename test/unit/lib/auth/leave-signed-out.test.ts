/**
 * Leaving a page without a session (#1057): the next page is loaded as a new one, without what
 * this one read (the query cache, in memory); this one is hidden, and loaded again if the browser
 * shows it again from its back-forward cache. Signing out drops the organization chosen too. The
 * sign-in page says, once, that the account was just deleted in this tab.
 */
import {
  leaveSignedOut,
  leaveWithoutSession,
  noteAccountDeleted,
  takeAccountDeleted,
} from '@/lib/auth/leave-signed-out';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'diagnoleads:current-organization';
const SITE = 'http://localhost:3000';
// jsdom does not load pages
const location = {
  assign: vi.fn(),
  replace: vi.fn(),
  reload: vi.fn(),
  href: `${SITE}/ja/leads`,
  origin: SITE,
};

/** The page goes: to the next one, or into the back-forward cache */
const goes = () => window.dispatchEvent(new Event('pagehide'));
/** The browser shows the page again: from its back-forward cache when `persisted` */
const showAgain = (persisted: boolean) => {
  const event = new Event('pageshow');
  Object.defineProperty(event, 'persisted', { value: persisted });
  window.dispatchEvent(event);
};

beforeEach(() => {
  vi.resetAllMocks();
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
  sessionStorage.clear();
  document.documentElement.hidden = false;
});

describe('leaveSignedOut', () => {
  it('drops the organization chosen, loads the next page as new, and hides this one as it goes', () => {
    location.assign.mockImplementationOnce(() => {
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    leaveSignedOut('/ja/login');

    expect(location.assign).toHaveBeenCalledWith(`${SITE}/ja/login`);
    expect(location.replace).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    // Shown until it goes: a question not to leave (unsaved changes) may keep it
    expect(document.documentElement.hidden).toBe(false);
    goes();
    expect(document.documentElement.hidden).toBe(true);
  });

  it('loads the same page again without its fragment, which would not load it', () => {
    leaveSignedOut(`${SITE}/ja/invite/abc#note`, { replace: true });

    expect(location.replace).toHaveBeenCalledWith(`${SITE}/ja/invite/abc`);
  });

  it('keeps the page left out of the history when asked', () => {
    leaveSignedOut('/ja/login', { replace: true });

    expect(location.replace).toHaveBeenCalledWith(`${SITE}/ja/login`);
    expect(location.assign).not.toHaveBeenCalled();
  });

  it('loads the page left again when the browser shows it from its back-forward cache', () => {
    leaveSignedOut('/ja/login');

    showAgain(false);
    expect(location.reload).not.toHaveBeenCalled();
    showAgain(true);
    expect(location.reload).toHaveBeenCalled();
  });

  it('leaves for no other site, and does nothing then', () => {
    expect(() => leaveSignedOut('https://example.com/login')).toThrow();
    expect(() => leaveSignedOut('javascript:alert(1)')).toThrow();

    expect(location.assign).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    expect(document.documentElement.hidden).toBe(false);
  });

  it('leaves all the same when the storage cannot be written', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    leaveSignedOut('/ja/login');

    expect(location.assign).toHaveBeenCalledWith(`${SITE}/ja/login`);
  });
});

describe('leaveWithoutSession', () => {
  it('keeps the organization chosen: mostly the same one signs in again', () => {
    leaveWithoutSession('/ja/login?callbackUrl=%2Fja%2Fleads', { replace: true });

    expect(location.replace).toHaveBeenCalledWith(`${SITE}/ja/login?callbackUrl=%2Fja%2Fleads`);
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    goes();
    expect(document.documentElement.hidden).toBe(true);
  });
});

describe('the account deleted', () => {
  it('is said once, in the tab that deleted it', () => {
    expect(takeAccountDeleted()).toBe(false);

    noteAccountDeleted();

    expect(takeAccountDeleted()).toBe(true);
    expect(takeAccountDeleted()).toBe(false);
  });

  it('is not said when the storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    expect(takeAccountDeleted()).toBe(false);
  });
});
