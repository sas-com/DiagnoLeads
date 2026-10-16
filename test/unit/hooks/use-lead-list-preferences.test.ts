/**
 * Page size and column visibility of the lead list, remembered per browser (#131)
 */
import {
  DEFAULT_LEAD_LIST_PREFERENCES,
  LEAD_LIST_PREFERENCES_KEY,
  readLeadListPreferences,
  useLeadListPreferences,
} from '@/hooks/use-lead-list-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('useLeadListPreferences', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('starts with the defaults', () => {
    const { result } = renderHook(() => useLeadListPreferences());
    expect(result.current.pageSize).toBe(20);
    expect(result.current.columnVisibility).toEqual({});
  });

  it('remembers the page size and the columns for the next visit', () => {
    const first = renderHook(() => useLeadListPreferences());
    act(() => first.result.current.setPageSize(50));
    act(() => first.result.current.setColumnVisibility({ company: false }));
    act(() => first.result.current.setColumnVisibility((old) => ({ ...old, score: false })));
    first.unmount();

    const next = renderHook(() => useLeadListPreferences());
    expect(next.result.current.pageSize).toBe(50);
    expect(next.result.current.columnVisibility).toEqual({ company: false, score: false });
  });

  it('ignores page sizes the list does not offer', () => {
    const { result } = renderHook(() => useLeadListPreferences());
    act(() => result.current.setPageSize(1000));
    expect(result.current.pageSize).toBe(20);
  });

  it('falls back to the defaults for broken or tampered data', () => {
    window.localStorage.setItem(LEAD_LIST_PREFERENCES_KEY, '{not json');
    expect(readLeadListPreferences()).toEqual(DEFAULT_LEAD_LIST_PREFERENCES);
    window.localStorage.setItem(
      LEAD_LIST_PREFERENCES_KEY,
      JSON.stringify({ pageSize: 7, columnVisibility: { name: 'yes' } })
    );
    expect(readLeadListPreferences()).toEqual(DEFAULT_LEAD_LIST_PREFERENCES);
  });

  it('keeps working when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = renderHook(() => useLeadListPreferences());
    act(() => result.current.setPageSize(100));
    expect(result.current.pageSize).toBe(100);
  });
});
