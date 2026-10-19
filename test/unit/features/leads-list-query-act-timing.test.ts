/**
 * The list's "when to act" filter and sort (#151) in the URL, the chips and the API input.
 */
import {
  DEFAULT_LEAD_LIST_QUERY,
  EMPTY_LEAD_FILTERS,
  filterChips,
  parseLeadListQuery,
  removeChip,
  serializeLeadListQuery,
  toListLeadsInput,
} from '@/lib/features/leads/list-query';
import { describe, expect, it } from 'vitest';

describe('when to act in the lead list query', () => {
  it('keeps the filter and the sort in the URL', () => {
    const query = {
      ...DEFAULT_LEAD_LIST_QUERY,
      filters: { ...EMPTY_LEAD_FILTERS, actTiming: 'soon' as const },
      sort: { by: 'actBy' as const, order: 'asc' as const },
    };
    const params = serializeLeadListQuery(query);
    expect(params.get('act')).toBe('soon');
    expect(params.get('sort')).toBe('actBy');
    const parsed = parseLeadListQuery(params);
    expect(parsed.filters.actTiming).toBe('soon');
    expect(parsed.sort).toEqual({ by: 'actBy', order: 'asc' });
    // Unknown values are dropped
    expect(parseLeadListQuery(new URLSearchParams('act=later')).filters.actTiming).toBeUndefined();
  });

  it('passes the filter to the API and shows a removable chip', () => {
    const filters = { ...EMPTY_LEAD_FILTERS, actTiming: 'has' as const };
    const query = {
      ...DEFAULT_LEAD_LIST_QUERY,
      filters,
      sort: { by: 'actBy' as const, order: 'asc' as const },
    };
    expect(toListLeadsInput(query, '660e8400-e29b-41d4-a716-446655440000')).toMatchObject({
      actTiming: 'has',
      sortBy: 'actBy',
    });
    const chips = filterChips(filters);
    expect(chips).toEqual([{ kind: 'actTiming', value: 'has' }]);
    expect(removeChip(filters, chips[0]).actTiming).toBeUndefined();
  });
});
