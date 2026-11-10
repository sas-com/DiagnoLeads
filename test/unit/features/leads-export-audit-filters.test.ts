/**
 * The filters an export of leads records in its audit row (#954): each of the list's filters as it
 * was sent, the search only as having been used, so that the audit never says an export was wider
 * than it was. The list's own filters are checked against the audit's, so that one added to the
 * list is not left out of it.
 */
import { EXPORT_AUDIT_FILTER_KEYS, exportAuditFilters } from '@/lib/features/leads/export';
import { listLeadsSchema } from '@/lib/features/leads/types/schemas';
import { describe, expect, it } from 'vitest';

const ORG = '660e8400-e29b-41d4-a716-446655440000';

/** Not filters: the organization, the page and the order */
const NOT_FILTERS = ['organizationId', 'limit', 'offset', 'sortBy', 'sortOrder'];
/** Filters the audit records apart: that there was a search, and the deals not yet made when on */
const RECORDED_APART = ['search', 'missingDeal'];

describe('exportAuditFilters', () => {
  it('records the MQL level and the act timing an export filtered by', () => {
    expect(
      exportAuditFilters({ organizationId: ORG, mqlLevel: ['interest', 'fit'], actTiming: 'soon' })
    ).toEqual({ mqlLevel: ['interest', 'fit'], actTiming: 'soon' });
    // One level, as the list takes it too
    expect(exportAuditFilters({ organizationId: ORG, mqlLevel: 'none' })).toEqual({
      mqlLevel: 'none',
    });
  });

  it('records none of them when they do not filter', () => {
    expect(exportAuditFilters({ organizationId: ORG, mqlLevel: [] })).toEqual({});
    expect(exportAuditFilters({ organizationId: ORG })).toEqual({});
  });

  it('records the search only as having been used', () => {
    expect(exportAuditFilters({ organizationId: ORG, search: ' 山田 ' })).toEqual({ search: true });
  });

  it('covers every filter of the lead list', () => {
    const filters = Object.keys(listLeadsSchema.shape).filter((key) => !NOT_FILTERS.includes(key));
    expect([...EXPORT_AUDIT_FILTER_KEYS, ...RECORDED_APART].sort()).toEqual(filters.sort());
  });
});
