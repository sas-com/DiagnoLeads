/**
 * Assignee filter in the lead list URL and presets (#135)
 */
import {
  DEFAULT_LEAD_LIST_QUERY,
  EMPTY_LEAD_FILTERS,
  filterChips,
  matchingPreset,
  parseLeadListQuery,
  presetHref,
  removeChip,
  serializeLeadListQuery,
  toListLeadsInput,
} from '@/lib/features/leads/list-query';
import { describe, expect, it } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const parse = (search: string) => parseLeadListQuery(new URLSearchParams(search));

describe('assignee in the lead list URL', () => {
  it.each(['me', 'unassigned', USER_ID])('reads and writes %s', (value) => {
    const query = parse(`assignee=${value}`);
    expect(query.filters.assignee).toBe(value);
    expect(serializeLeadListQuery(query).toString()).toBe(`assignee=${value}`);
    expect(toListLeadsInput(query, ORG_ID).assignee).toBe(value);
  });

  it('drops a broken value', () => {
    expect(parse('assignee=someone').filters.assignee).toBeUndefined();
    expect(toListLeadsInput(parse('assignee=someone'), ORG_ID).assignee).toBeUndefined();
  });

  it('has the presets 自分の担当 and 担当未定', () => {
    expect(presetHref('mine')).toBe('/leads?assignee=me');
    expect(presetHref('unassigned')).toBe('/leads?assignee=unassigned');
    expect(matchingPreset(parse('assignee=me').filters)).toBe('mine');
    expect(matchingPreset(parse('assignee=unassigned').filters)).toBe('unassigned');
    expect(matchingPreset(parse(`assignee=${USER_ID}`).filters)).toBeNull();
  });

  it('shows the filter as a chip that can be removed', () => {
    const filters = { ...EMPTY_LEAD_FILTERS, assignee: 'unassigned' as const, status: ['new' as const] };
    const chips = filterChips(filters);
    const chip = chips.find((c) => c.kind === 'assignee');
    expect(chip).toEqual({ kind: 'assignee', value: 'unassigned' });
    if (!chip) throw new Error('no chip');
    expect(removeChip(filters, chip)).toEqual({ ...EMPTY_LEAD_FILTERS, status: ['new'] });
  });

  it('sorts by assignee A→Z first', () => {
    const query = parse('sort=assignee');
    expect(query.sort).toEqual({ by: 'assignee', order: 'asc' });
    expect(serializeLeadListQuery({ ...DEFAULT_LEAD_LIST_QUERY, sort: query.sort }).toString()).toBe(
      'sort=assignee&order=asc'
    );
  });
});
