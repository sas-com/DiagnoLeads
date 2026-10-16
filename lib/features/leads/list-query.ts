/**
 * Lead list state in the URL (#131): filters, sort and page as search params, so back,
 * reload and a shared link show the same list.
 *
 * - parseLeadListQuery / serializeLeadListQuery: URL search params <-> LeadListQuery.
 *   Parsing never throws: unknown or broken values are dropped.
 * - toListLeadsInput: LeadListQuery -> input of `leads.list`.
 * - Presets (よく使う絞り込み), filter chips and a link builder for other pages (dashboard).
 *
 * Pure functions only, usable on the server and in tests.
 */
import { z } from 'zod';
import {
  DEAL_PHASES,
  type DealPhase,
  INFLOW_SOURCES,
  type InflowSource,
  LEAD_STATUSES,
  type LeadStatus,
  TARGET_SYSTEMS,
  type TargetSystem,
  jstDate,
} from './types/pipeline';
import {
  type AssigneeFilter,
  LEAD_SORT_KEYS,
  type LeadSortKey,
  type ListLeadsInput,
  SQL_DECISION_FILTERS,
  type SqlDecisionFilter,
  assigneeFilterSchema,
  jstDaySchema,
} from './types/schemas';

export type SortOrder = 'asc' | 'desc';

export interface LeadListFilters {
  status: LeadStatus[];
  dealPhase: DealPhase[];
  inflowSource: InflowSource[];
  targetSystem: TargetSystem[];
  scoreMin?: number;
  scoreMax?: number;
  /** Created on or after this Japan day ('YYYY-MM-DD') */
  createdFrom?: string;
  /** Created on or before this Japan day ('YYYY-MM-DD') */
  createdTo?: string;
  /** true: asked for a consultation only; false: without one */
  consultation?: boolean;
  /** true: MQL only; false: not MQL */
  mql?: boolean;
  sql?: SqlDecisionFilter;
  /** Assignee: 'me', 'unassigned' or a member's user id (#135) */
  assignee?: AssigneeFilter;
  /** Name, email or company */
  search?: string;
}

export interface LeadListSort {
  by: LeadSortKey;
  order: SortOrder;
}

export interface LeadListQuery {
  filters: LeadListFilters;
  sort: LeadListSort;
  /** 1-based */
  page: number;
}

export const EMPTY_LEAD_FILTERS: LeadListFilters = {
  status: [],
  dealPhase: [],
  inflowSource: [],
  targetSystem: [],
};

export const DEFAULT_LEAD_SORT: LeadListSort = { by: 'createdAt', order: 'desc' };

export const DEFAULT_LEAD_LIST_QUERY: LeadListQuery = {
  filters: EMPTY_LEAD_FILTERS,
  sort: DEFAULT_LEAD_SORT,
  page: 1,
};

/** Page sizes offered; the server accepts up to 100 */
export const LEAD_PAGE_SIZES = [10, 20, 50, 100] as const;
export const DEFAULT_LEAD_PAGE_SIZE = 20;

/**
 * Direction a column sorts in when its header is clicked first: newest / highest first for
 * dates and scores, A→Z / pipeline order for text and stages.
 */
export const FIRST_SORT_ORDER: Record<LeadSortKey, SortOrder> = {
  createdAt: 'desc',
  updatedAt: 'desc',
  name: 'asc',
  email: 'asc',
  company: 'asc',
  score: 'desc',
  status: 'asc',
  dealPhase: 'asc',
  lastActivityAt: 'desc',
  mqlQualifiedAt: 'desc',
  assignee: 'asc',
};

/** Search param names. Short, readable, stable: links to the list depend on them. */
export const LEAD_LIST_PARAMS = {
  status: 'status',
  dealPhase: 'phase',
  inflowSource: 'inflow',
  targetSystem: 'system',
  scoreMin: 'scoreMin',
  scoreMax: 'scoreMax',
  createdFrom: 'from',
  createdTo: 'to',
  consultation: 'consult',
  mql: 'mql',
  sql: 'sql',
  assignee: 'assignee',
  search: 'q',
  sortBy: 'sort',
  sortOrder: 'order',
  page: 'page',
} as const;

const MAX_SEARCH_LENGTH = 200;

// ---------------------------------------------------------------------------
// URL schema
// ---------------------------------------------------------------------------

/** Comma-separated values, unknown ones dropped, duplicates removed, kept in canonical order */
function csvOf<T extends string>(allowed: readonly T[]) {
  return z
    .string()
    .optional()
    .catch(undefined)
    .transform((raw): T[] => {
      if (!raw) return [];
      const picked = new Set(raw.split(',').map((v) => v.trim()));
      return allowed.filter((value) => picked.has(value));
    });
}

const scoreParam = z.coerce.number().int().min(0).max(100).optional().catch(undefined);
const dayParam = jstDaySchema.optional().catch(undefined);
const flagParam = z
  .enum(['1', '0'])
  .optional()
  .catch(undefined)
  .transform((v) => (v === undefined ? undefined : v === '1'));

/** Search params of the lead list (all optional, broken values ignored) */
export const leadListUrlSchema = z.object({
  [LEAD_LIST_PARAMS.status]: csvOf(LEAD_STATUSES),
  [LEAD_LIST_PARAMS.dealPhase]: csvOf(DEAL_PHASES),
  [LEAD_LIST_PARAMS.inflowSource]: csvOf(INFLOW_SOURCES),
  [LEAD_LIST_PARAMS.targetSystem]: csvOf(TARGET_SYSTEMS),
  [LEAD_LIST_PARAMS.scoreMin]: scoreParam,
  [LEAD_LIST_PARAMS.scoreMax]: scoreParam,
  [LEAD_LIST_PARAMS.createdFrom]: dayParam,
  [LEAD_LIST_PARAMS.createdTo]: dayParam,
  [LEAD_LIST_PARAMS.consultation]: flagParam,
  [LEAD_LIST_PARAMS.mql]: flagParam,
  [LEAD_LIST_PARAMS.sql]: z.enum(SQL_DECISION_FILTERS).optional().catch(undefined),
  [LEAD_LIST_PARAMS.assignee]: assigneeFilterSchema.optional().catch(undefined),
  [LEAD_LIST_PARAMS.search]: z
    .string()
    .optional()
    .catch(undefined)
    .transform((v) => v?.trim().slice(0, MAX_SEARCH_LENGTH) || undefined),
  [LEAD_LIST_PARAMS.sortBy]: z.enum(LEAD_SORT_KEYS).optional().catch(undefined),
  [LEAD_LIST_PARAMS.sortOrder]: z.enum(['asc', 'desc']).optional().catch(undefined),
  [LEAD_LIST_PARAMS.page]: z.coerce.number().int().min(1).max(100_000).optional().catch(undefined),
});

/** Anything with URLSearchParams' get (also Next's ReadonlyURLSearchParams) */
export interface SearchParamsLike {
  get(name: string): string | null;
}

/** Read the list state from search params. Never throws. */
export function parseLeadListQuery(params: SearchParamsLike): LeadListQuery {
  const raw: Record<string, string | undefined> = {};
  for (const name of Object.values(LEAD_LIST_PARAMS)) {
    // An empty value (`?scoreMin=`) counts as not set; z.coerce would read it as 0
    raw[name] = params.get(name) || undefined;
  }
  const p = leadListUrlSchema.parse(raw);

  let scoreMin = p[LEAD_LIST_PARAMS.scoreMin];
  let scoreMax = p[LEAD_LIST_PARAMS.scoreMax];
  if (scoreMin !== undefined && scoreMax !== undefined && scoreMin > scoreMax) {
    [scoreMin, scoreMax] = [scoreMax, scoreMin];
  }
  let createdFrom = p[LEAD_LIST_PARAMS.createdFrom];
  let createdTo = p[LEAD_LIST_PARAMS.createdTo];
  if (createdFrom && createdTo && createdFrom > createdTo) {
    [createdFrom, createdTo] = [createdTo, createdFrom];
  }

  const by = p[LEAD_LIST_PARAMS.sortBy] ?? DEFAULT_LEAD_SORT.by;
  return {
    filters: normalizeFilters({
      status: p[LEAD_LIST_PARAMS.status],
      dealPhase: p[LEAD_LIST_PARAMS.dealPhase],
      inflowSource: p[LEAD_LIST_PARAMS.inflowSource],
      targetSystem: p[LEAD_LIST_PARAMS.targetSystem],
      scoreMin,
      scoreMax,
      createdFrom,
      createdTo,
      consultation: p[LEAD_LIST_PARAMS.consultation],
      mql: p[LEAD_LIST_PARAMS.mql],
      sql: p[LEAD_LIST_PARAMS.sql],
      assignee: p[LEAD_LIST_PARAMS.assignee],
      search: p[LEAD_LIST_PARAMS.search],
    }),
    sort: {
      by,
      order:
        p[LEAD_LIST_PARAMS.sortOrder] ??
        (p[LEAD_LIST_PARAMS.sortBy] ? FIRST_SORT_ORDER[by] : DEFAULT_LEAD_SORT.order),
    },
    page: p[LEAD_LIST_PARAMS.page] ?? 1,
  };
}

/**
 * Write the list state as search params. Defaults are left out, so the plain list is
 * `/leads` and equal states give equal strings.
 */
export function serializeLeadListQuery(query: LeadListQuery): URLSearchParams {
  const f = normalizeFilters(query.filters);
  const params = new URLSearchParams();
  const list = (name: string, values: readonly string[]) => {
    if (values.length > 0) params.set(name, values.join(','));
  };
  list(LEAD_LIST_PARAMS.status, f.status);
  list(LEAD_LIST_PARAMS.dealPhase, f.dealPhase);
  list(LEAD_LIST_PARAMS.inflowSource, f.inflowSource);
  list(LEAD_LIST_PARAMS.targetSystem, f.targetSystem);
  if (f.scoreMin !== undefined) params.set(LEAD_LIST_PARAMS.scoreMin, String(f.scoreMin));
  if (f.scoreMax !== undefined) params.set(LEAD_LIST_PARAMS.scoreMax, String(f.scoreMax));
  if (f.createdFrom) params.set(LEAD_LIST_PARAMS.createdFrom, f.createdFrom);
  if (f.createdTo) params.set(LEAD_LIST_PARAMS.createdTo, f.createdTo);
  if (f.consultation !== undefined) {
    params.set(LEAD_LIST_PARAMS.consultation, f.consultation ? '1' : '0');
  }
  if (f.mql !== undefined) params.set(LEAD_LIST_PARAMS.mql, f.mql ? '1' : '0');
  if (f.sql) params.set(LEAD_LIST_PARAMS.sql, f.sql);
  if (f.assignee) params.set(LEAD_LIST_PARAMS.assignee, f.assignee);
  if (f.search) params.set(LEAD_LIST_PARAMS.search, f.search);
  if (query.sort.by !== DEFAULT_LEAD_SORT.by || query.sort.order !== DEFAULT_LEAD_SORT.order) {
    params.set(LEAD_LIST_PARAMS.sortBy, query.sort.by);
    params.set(LEAD_LIST_PARAMS.sortOrder, query.sort.order);
  }
  if (query.page > 1) params.set(LEAD_LIST_PARAMS.page, String(query.page));
  return params;
}

/**
 * Put the list state into existing search params, keeping params that are not the list's
 * (e.g. `leadId` that opens a lead).
 */
export function mergeLeadListQuery(
  current: SearchParamsLike & { toString(): string },
  query: LeadListQuery
): string {
  const merged = new URLSearchParams(current.toString());
  for (const name of Object.values(LEAD_LIST_PARAMS)) merged.delete(name);
  for (const [name, value] of serializeLeadListQuery(query)) merged.set(name, value);
  return merged.toString();
}

/** Canonical form: values in definition order, no duplicates, blank search removed */
export function normalizeFilters(filters: Partial<LeadListFilters>): LeadListFilters {
  const pick = <T extends string>(allowed: readonly T[], values: readonly T[] | undefined) => {
    const set = new Set(values ?? []);
    return allowed.filter((v) => set.has(v));
  };
  const search = filters.search?.trim().slice(0, MAX_SEARCH_LENGTH);
  const result: LeadListFilters = {
    status: pick(LEAD_STATUSES, filters.status),
    dealPhase: pick(DEAL_PHASES, filters.dealPhase),
    inflowSource: pick(INFLOW_SOURCES, filters.inflowSource),
    targetSystem: pick(TARGET_SYSTEMS, filters.targetSystem),
  };
  if (filters.scoreMin !== undefined) result.scoreMin = filters.scoreMin;
  if (filters.scoreMax !== undefined) result.scoreMax = filters.scoreMax;
  if (filters.createdFrom) result.createdFrom = filters.createdFrom;
  if (filters.createdTo) result.createdTo = filters.createdTo;
  if (filters.consultation !== undefined) result.consultation = filters.consultation;
  if (filters.mql !== undefined) result.mql = filters.mql;
  if (filters.sql) result.sql = filters.sql;
  if (filters.assignee) result.assignee = filters.assignee;
  if (search) result.search = search;
  return result;
}

export function sameFilters(a: LeadListFilters, b: LeadListFilters): boolean {
  return (
    serializeLeadListQuery({ ...DEFAULT_LEAD_LIST_QUERY, filters: a }).toString() ===
    serializeLeadListQuery({ ...DEFAULT_LEAD_LIST_QUERY, filters: b }).toString()
  );
}

export function hasActiveFilters(filters: LeadListFilters): boolean {
  return !sameFilters(filters, EMPTY_LEAD_FILTERS);
}

/** Input of `leads.list` for the query (page size is kept per browser, not in the URL) */
export function toListLeadsInput(
  query: LeadListQuery,
  organizationId: string,
  pageSize: number = DEFAULT_LEAD_PAGE_SIZE
): ListLeadsInput {
  const f = query.filters;
  const input: ListLeadsInput = {
    organizationId,
    limit: pageSize,
    offset: (query.page - 1) * pageSize,
    sortBy: query.sort.by,
    sortOrder: query.sort.order,
  };
  if (f.status.length > 0) input.status = f.status;
  if (f.dealPhase.length > 0) input.dealPhase = f.dealPhase;
  if (f.inflowSource.length > 0) input.inflowSource = f.inflowSource;
  if (f.targetSystem.length > 0) input.targetSystem = f.targetSystem;
  if (f.scoreMin !== undefined) input.scoreMin = f.scoreMin;
  if (f.scoreMax !== undefined) input.scoreMax = f.scoreMax;
  if (f.createdFrom) input.createdFromDay = f.createdFrom;
  if (f.createdTo) input.createdToDay = f.createdTo;
  if (f.consultation !== undefined) input.consultationRequested = f.consultation;
  if (f.mql !== undefined) input.mql = f.mql;
  if (f.sql) input.sqlDecision = f.sql;
  if (f.assignee) input.assignee = f.assignee;
  if (f.search) input.search = f.search;
  return input;
}

// ---------------------------------------------------------------------------
// Japan days
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

/** Add days to a 'YYYY-MM-DD' day */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  return new Date(date.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** Monday of the Japan week that contains `now` ('YYYY-MM-DD') */
export function jstWeekStart(now: Date = new Date()): string {
  const today = jstDate(now);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(today, -((weekday + 6) % 7));
}

// ---------------------------------------------------------------------------
// Presets (よく使う絞り込み)
// ---------------------------------------------------------------------------

export const LEAD_LIST_PRESETS = [
  'needsAction',
  'consultation',
  'newThisWeek',
  'negotiating',
  'mine',
  'unassigned',
] as const;
export type LeadListPreset = (typeof LEAD_LIST_PRESETS)[number];

/** Filters of a preset. "This week" is the Japan week (Monday start) of `now`. */
export function presetFilters(preset: LeadListPreset, now: Date = new Date()): LeadListFilters {
  switch (preset) {
    case 'needsAction':
      // 新規・未着手: nobody has started on it yet
      return { ...EMPTY_LEAD_FILTERS, status: ['new'] };
    case 'consultation':
      return { ...EMPTY_LEAD_FILTERS, consultation: true };
    case 'newThisWeek':
      return { ...EMPTY_LEAD_FILTERS, createdFrom: jstWeekStart(now) };
    case 'negotiating':
      return { ...EMPTY_LEAD_FILTERS, status: ['negotiating'] };
    case 'mine':
      // 自分の担当 (#135)
      return { ...EMPTY_LEAD_FILTERS, assignee: 'me' };
    case 'unassigned':
      // 担当未定 (#135)
      return { ...EMPTY_LEAD_FILTERS, assignee: 'unassigned' };
  }
}

/** Replace the filters with a preset's; the sort is kept and the page goes back to 1 */
export function applyPreset(
  query: LeadListQuery,
  preset: LeadListPreset,
  now: Date = new Date()
): LeadListQuery {
  return { ...query, filters: presetFilters(preset, now), page: 1 };
}

/** The preset the filters are exactly equal to, if any */
export function matchingPreset(
  filters: LeadListFilters,
  now: Date = new Date()
): LeadListPreset | null {
  return (
    LEAD_LIST_PRESETS.find((preset) => sameFilters(filters, presetFilters(preset, now))) ?? null
  );
}

/**
 * Link to the list with filters (for the dashboard and notifications), e.g.
 * leadListHref({ status: ['new'], consultation: true }) -> '/leads?status=new&consult=1'.
 * Pass the locale prefix as `basePath` when the link is not handled by the i18n Link.
 */
export function leadListHref(
  filters: Partial<LeadListFilters> = {},
  sort: LeadListSort = DEFAULT_LEAD_SORT,
  basePath = '/leads'
): string {
  const search = serializeLeadListQuery({
    filters: normalizeFilters(filters),
    sort,
    page: 1,
  }).toString();
  return search ? `${basePath}?${search}` : basePath;
}

export function presetHref(preset: LeadListPreset, now: Date = new Date(), basePath = '/leads') {
  return leadListHref(presetFilters(preset, now), DEFAULT_LEAD_SORT, basePath);
}

// ---------------------------------------------------------------------------
// Filter chips
// ---------------------------------------------------------------------------

export type LeadFilterChip =
  | { kind: 'status'; value: LeadStatus }
  | { kind: 'dealPhase'; value: DealPhase }
  | { kind: 'inflowSource'; value: InflowSource }
  | { kind: 'targetSystem'; value: TargetSystem }
  | { kind: 'score'; min?: number; max?: number }
  | { kind: 'created'; from?: string; to?: string }
  | { kind: 'consultation'; value: boolean }
  | { kind: 'mql'; value: boolean }
  | { kind: 'sql'; value: SqlDecisionFilter }
  | { kind: 'assignee'; value: AssigneeFilter }
  | { kind: 'search'; value: string };

/** One chip per condition (one per selected value for the multi-selects) */
export function filterChips(filters: LeadListFilters): LeadFilterChip[] {
  const chips: LeadFilterChip[] = [];
  if (filters.search) chips.push({ kind: 'search', value: filters.search });
  for (const value of filters.status) chips.push({ kind: 'status', value });
  for (const value of filters.dealPhase) chips.push({ kind: 'dealPhase', value });
  for (const value of filters.inflowSource) chips.push({ kind: 'inflowSource', value });
  for (const value of filters.targetSystem) chips.push({ kind: 'targetSystem', value });
  if (filters.scoreMin !== undefined || filters.scoreMax !== undefined) {
    chips.push({ kind: 'score', min: filters.scoreMin, max: filters.scoreMax });
  }
  if (filters.createdFrom || filters.createdTo) {
    chips.push({ kind: 'created', from: filters.createdFrom, to: filters.createdTo });
  }
  if (filters.consultation !== undefined) {
    chips.push({ kind: 'consultation', value: filters.consultation });
  }
  if (filters.mql !== undefined) chips.push({ kind: 'mql', value: filters.mql });
  if (filters.sql) chips.push({ kind: 'sql', value: filters.sql });
  if (filters.assignee) chips.push({ kind: 'assignee', value: filters.assignee });
  return chips;
}

/** Stable React key of a chip */
export function chipKey(chip: LeadFilterChip): string {
  switch (chip.kind) {
    case 'score':
    case 'created':
      return chip.kind;
    default:
      return `${chip.kind}:${String(chip.value)}`;
  }
}

/** Filters without the chip's condition */
export function removeChip(filters: LeadListFilters, chip: LeadFilterChip): LeadListFilters {
  const next: LeadListFilters = { ...filters };
  switch (chip.kind) {
    case 'status':
      next.status = filters.status.filter((v) => v !== chip.value);
      break;
    case 'dealPhase':
      next.dealPhase = filters.dealPhase.filter((v) => v !== chip.value);
      break;
    case 'inflowSource':
      next.inflowSource = filters.inflowSource.filter((v) => v !== chip.value);
      break;
    case 'targetSystem':
      next.targetSystem = filters.targetSystem.filter((v) => v !== chip.value);
      break;
    case 'score':
      next.scoreMin = undefined;
      next.scoreMax = undefined;
      break;
    case 'created':
      next.createdFrom = undefined;
      next.createdTo = undefined;
      break;
    case 'consultation':
      next.consultation = undefined;
      break;
    case 'mql':
      next.mql = undefined;
      break;
    case 'sql':
      next.sql = undefined;
      break;
    case 'assignee':
      next.assignee = undefined;
      break;
    case 'search':
      next.search = undefined;
      break;
  }
  return normalizeFilters(next);
}

/** Next sort when a column header is clicked: flip the same column, else its first order */
export function nextSort(current: LeadListSort, column: LeadSortKey): LeadListSort {
  if (current.by === column) {
    return { by: column, order: current.order === 'asc' ? 'desc' : 'asc' };
  }
  return { by: column, order: FIRST_SORT_ORDER[column] };
}
