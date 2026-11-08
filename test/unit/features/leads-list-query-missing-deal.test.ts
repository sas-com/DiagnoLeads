/**
 * The list filter 商談が未作成のリード (#854) in the URL, the chips, the API input and the
 * export's audit row. The rows it finds are checked on a real database in
 * test/unit/integration/leads-missing-deal.db.test.ts.
 */
import { exportAuditFilters } from '@/lib/features/leads/export';
import {
  DEFAULT_LEAD_LIST_QUERY,
  EMPTY_LEAD_FILTERS,
  type LeadListQuery,
  filterChips,
  hasActiveFilters,
  leadListHref,
  matchingPreset,
  parseLeadListQuery,
  removeChip,
  serializeLeadListQuery,
  toListLeadsInput,
} from '@/lib/features/leads/list-query';
import { exportLeadsSchema, listLeadsSchema } from '@/lib/features/leads/types/schemas';
import { describe, expect, it } from 'vitest';

const ORG = '660e8400-e29b-41d4-a716-446655440000';
const parse = (search: string) => parseLeadListQuery(new URLSearchParams(search));
const filtered: LeadListQuery = {
  ...DEFAULT_LEAD_LIST_QUERY,
  filters: { ...EMPTY_LEAD_FILTERS, missingDeal: true },
};

describe('missing deal in the lead list query', () => {
  it('reads, writes and reads the filter back the same', () => {
    const read = parse('nodeal=1');
    expect(read).toEqual(filtered);
    const written = serializeLeadListQuery(read).toString();
    expect(written).toBe('nodeal=1');
    expect(parse(written)).toEqual(read);
  });

  it('round-trips it with the other filters, the sort and the page', () => {
    const query: LeadListQuery = {
      filters: { ...EMPTY_LEAD_FILTERS, status: ['negotiating', 'won'], missingDeal: true },
      sort: { by: 'updatedAt', order: 'asc' },
      page: 2,
    };
    const written = serializeLeadListQuery(query).toString();
    expect(written).toBe('status=negotiating%2Cwon&nodeal=1&sort=updatedAt&order=asc&page=2');
    expect(parse(written)).toEqual(query);
  });

  it.each(['nodeal=0', 'nodeal=true', 'nodeal=', 'nodeal=11'])(
    'drops any other value (%s): there is no filter for the leads that have a deal',
    (search) => {
      expect(parse(search)).toEqual(DEFAULT_LEAD_LIST_QUERY);
    }
  );

  it('links to the filtered list from the cards', () => {
    expect(leadListHref({ missingDeal: true }, undefined, '/ja/leads')).toBe('/ja/leads?nodeal=1');
  });

  it('passes the filter to the list and the export as the schemas take it', () => {
    const input = toListLeadsInput(filtered, ORG);
    expect(input).toMatchObject({ missingDeal: true, limit: 20, offset: 0 });
    expect(listLeadsSchema.parse(input).missingDeal).toBe(true);
    expect(exportLeadsSchema.parse({ ...input, format: 'csv' }).missingDeal).toBe(true);
    // Not set: not sent at all
    expect(toListLeadsInput(DEFAULT_LEAD_LIST_QUERY, ORG)).not.toHaveProperty('missingDeal');
  });

  it('shows a chip that removes it, and counts as a filter that no preset matches', () => {
    const chips = filterChips(filtered.filters);
    expect(chips).toEqual([{ kind: 'missingDeal', value: true }]);
    expect(hasActiveFilters(filtered.filters)).toBe(true);
    expect(matchingPreset(filtered.filters)).toBeNull();
    const removed = removeChip(filtered.filters, chips[0]);
    expect(removed).toEqual(EMPTY_LEAD_FILTERS);
    expect(serializeLeadListQuery({ ...filtered, filters: removed }).toString()).toBe('');
  });

  it('records the filter in the export audit only when it filters', () => {
    expect(exportAuditFilters({ organizationId: ORG, missingDeal: true })).toEqual({
      missingDeal: true,
    });
    expect(exportAuditFilters({ organizationId: ORG, missingDeal: false })).toEqual({});
    expect(exportAuditFilters({ organizationId: ORG })).toEqual({});
  });
});
