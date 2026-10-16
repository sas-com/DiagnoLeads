'use client';

/**
 * Lead list state kept in the URL (#131) and per-browser list preferences.
 *
 * useLeadListQuery: reads filters / sort / page from the search params and writes them back
 * with the Next router, so back, reload and shared links show the same list. Filter, sort and
 * page changes push a history entry; typing in the search box replaces the current entry
 * after a short pause (debounced), so the history is not filled with every keystroke.
 *
 * The component that calls it uses useSearchParams: in the App Router it must render inside
 * a <Suspense> boundary.
 *
 * useLeadListPreferences: page size and column visibility, remembered in localStorage.
 */
import {
  DEFAULT_LEAD_PAGE_SIZE,
  EMPTY_LEAD_FILTERS,
  LEAD_PAGE_SIZES,
  type LeadFilterChip,
  type LeadListFilters,
  type LeadListPreset,
  type LeadListQuery,
  type LeadListSort,
  applyPreset as applyPresetToQuery,
  filterChips,
  hasActiveFilters,
  matchingPreset,
  mergeLeadListQuery,
  nextSort,
  normalizeFilters,
  parseLeadListQuery,
  removeChip as removeChipFromFilters,
  toListLeadsInput,
} from '@/lib/features/leads/list-query';
import type { LeadSortKey, ListLeadsInput } from '@/lib/features/leads/types/schemas';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';

export const SEARCH_DEBOUNCE_MS = 300;

export interface UseLeadListQueryOptions {
  /** Delay before the typed search reaches the URL */
  searchDebounceMs?: number;
  /** Clock for "this week" (tests) */
  now?: () => Date;
}

export interface LeadListQueryController {
  query: LeadListQuery;
  filters: LeadListFilters;
  sort: LeadListSort;
  page: number;
  chips: LeadFilterChip[];
  hasFilters: boolean;
  activePreset: LeadListPreset | null;
  /** What is in the search box (reaches the URL after the debounce) */
  searchText: string;
  setSearchText: (text: string) => void;
  /** Send the typed search now (Enter) */
  flushSearch: () => void;
  /** Replace all filters (page back to 1) */
  setFilters: (filters: LeadListFilters) => void;
  /** Change some filters (page back to 1) */
  updateFilters: (patch: Partial<LeadListFilters>) => void;
  removeChip: (chip: LeadFilterChip) => void;
  /** Remove every filter, the search included; the sort is kept */
  clearFilters: () => void;
  applyPreset: (preset: LeadListPreset) => void;
  setSort: (sort: LeadListSort) => void;
  /** Column header click: same column flips, another column starts in its natural order */
  toggleSort: (column: LeadSortKey) => void;
  setPage: (page: number) => void;
  /** Input of `leads.list` */
  listInput: (organizationId: string, pageSize: number) => ListLeadsInput;
}

export function useLeadListQuery(options: UseLeadListQueryOptions = {}): LeadListQueryController {
  const { searchDebounceMs = SEARCH_DEBOUNCE_MS, now = defaultNow } = options;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const paramsString = searchParams?.toString() ?? '';
  const query = useMemo(
    () => parseLeadListQuery(new URLSearchParams(paramsString)),
    [paramsString]
  );

  // Latest values for the debounce timer
  const latest = useRef({ query, paramsString, pathname });
  latest.current = { query, paramsString, pathname };

  const navigate = useCallback(
    (next: LeadListQuery, mode: 'push' | 'replace' = 'push') => {
      const { paramsString: current, pathname: path } = latest.current;
      const search = mergeLeadListQuery(new URLSearchParams(current), next);
      if (search === current) return;
      const href = search ? `${path}?${search}` : path;
      router[mode](href, { scroll: false });
    },
    [router]
  );

  // Search box: local text, sent to the URL after a pause
  const urlSearch = query.filters.search ?? '';
  const [searchText, setSearchTextState] = useState(urlSearch);
  const sentSearch = useRef(urlSearch);
  useEffect(() => {
    // The URL changed from elsewhere (back, chip removed, preset): show its search
    if (urlSearch !== sentSearch.current) {
      sentSearch.current = urlSearch;
      setSearchTextState(urlSearch);
    }
  }, [urlSearch]);

  const sendSearch = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      const current = latest.current.query;
      if (trimmed === (current.filters.search ?? '')) return;
      sentSearch.current = trimmed;
      navigate(
        {
          ...current,
          filters: normalizeFilters({ ...current.filters, search: trimmed || undefined }),
          page: 1,
        },
        'replace'
      );
    },
    [navigate]
  );

  useEffect(() => {
    if (searchText.trim() === urlSearch) return;
    const timer = setTimeout(() => sendSearch(searchText), searchDebounceMs);
    return () => clearTimeout(timer);
  }, [searchText, urlSearch, searchDebounceMs, sendSearch]);

  const setFilters = useCallback(
    (filters: LeadListFilters) => {
      const current = latest.current.query;
      navigate({ ...current, filters: normalizeFilters(filters), page: 1 });
    },
    [navigate]
  );

  const updateFilters = useCallback(
    (patch: Partial<LeadListFilters>) => {
      setFilters({ ...latest.current.query.filters, ...patch });
    },
    [setFilters]
  );

  const removeChip = useCallback(
    (chip: LeadFilterChip) => {
      setFilters(removeChipFromFilters(latest.current.query.filters, chip));
    },
    [setFilters]
  );

  const clearFilters = useCallback(() => setFilters(EMPTY_LEAD_FILTERS), [setFilters]);

  const applyPreset = useCallback(
    (preset: LeadListPreset) => navigate(applyPresetToQuery(latest.current.query, preset, now())),
    [navigate, now]
  );

  const setSort = useCallback(
    (sort: LeadListSort) => navigate({ ...latest.current.query, sort, page: 1 }),
    [navigate]
  );

  const toggleSort = useCallback(
    (column: LeadSortKey) => setSort(nextSort(latest.current.query.sort, column)),
    [setSort]
  );

  const setPage = useCallback(
    (page: number) => navigate({ ...latest.current.query, page: Math.max(1, Math.floor(page)) }),
    [navigate]
  );

  const flushSearch = useCallback(() => sendSearch(searchText), [sendSearch, searchText]);

  const listInput = useCallback(
    (organizationId: string, pageSize: number) => toListLeadsInput(query, organizationId, pageSize),
    [query]
  );

  return {
    query,
    filters: query.filters,
    sort: query.sort,
    page: query.page,
    chips: filterChips(query.filters),
    hasFilters: hasActiveFilters(query.filters),
    activePreset: matchingPreset(query.filters, now()),
    searchText,
    setSearchText: setSearchTextState,
    flushSearch,
    setFilters,
    updateFilters,
    removeChip,
    clearFilters,
    applyPreset,
    setSort,
    toggleSort,
    setPage,
    listInput,
  };
}

function defaultNow() {
  return new Date();
}

// ---------------------------------------------------------------------------
// Per-browser preferences
// ---------------------------------------------------------------------------

export const LEAD_LIST_PREFERENCES_KEY = 'leads-list-preferences-v1';

/** Shown / hidden per column id (same shape as TanStack Table's VisibilityState) */
export type ColumnVisibility = Record<string, boolean>;

export interface LeadListPreferences {
  pageSize: number;
  columnVisibility: ColumnVisibility;
}

export const DEFAULT_LEAD_LIST_PREFERENCES: LeadListPreferences = {
  pageSize: DEFAULT_LEAD_PAGE_SIZE,
  columnVisibility: {},
};

const preferencesSchema = z.object({
  pageSize: z
    .number()
    .refine((n) => (LEAD_PAGE_SIZES as readonly number[]).includes(n))
    .catch(DEFAULT_LEAD_PAGE_SIZE),
  columnVisibility: z.record(z.string(), z.boolean()).catch({}),
});

/** Saved preferences, or the defaults when storage is empty, broken or blocked */
export function readLeadListPreferences(): LeadListPreferences {
  try {
    const raw = window.localStorage.getItem(LEAD_LIST_PREFERENCES_KEY);
    if (!raw) return DEFAULT_LEAD_LIST_PREFERENCES;
    const parsed = preferencesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_LEAD_LIST_PREFERENCES;
  } catch {
    return DEFAULT_LEAD_LIST_PREFERENCES;
  }
}

function writeLeadListPreferences(preferences: LeadListPreferences) {
  try {
    window.localStorage.setItem(LEAD_LIST_PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Private mode or storage full: the choice lasts until the page is closed
  }
}

type Updater<T> = T | ((previous: T) => T);

export function useLeadListPreferences() {
  const [preferences, setPreferences] = useState<LeadListPreferences>(
    DEFAULT_LEAD_LIST_PREFERENCES
  );
  // Read after mount, so the server render and the first client render agree
  useEffect(() => {
    setPreferences(readLeadListPreferences());
  }, []);

  const update = useCallback((patch: Partial<LeadListPreferences>) => {
    setPreferences((previous) => {
      const next = { ...previous, ...patch };
      writeLeadListPreferences(next);
      return next;
    });
  }, []);

  const setPageSize = useCallback(
    (pageSize: number) => {
      if ((LEAD_PAGE_SIZES as readonly number[]).includes(pageSize)) update({ pageSize });
    },
    [update]
  );

  /** Accepts a value or an updater, like TanStack Table's onColumnVisibilityChange */
  const setColumnVisibility = useCallback((updater: Updater<ColumnVisibility>) => {
    setPreferences((previous) => {
      const columnVisibility =
        typeof updater === 'function' ? updater(previous.columnVisibility) : updater;
      const next = { ...previous, columnVisibility };
      writeLeadListPreferences(next);
      return next;
    });
  }, []);

  return {
    pageSize: preferences.pageSize,
    columnVisibility: preferences.columnVisibility,
    setPageSize,
    setColumnVisibility,
  };
}
