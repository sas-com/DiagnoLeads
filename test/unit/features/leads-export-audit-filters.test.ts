/**
 * The filters an export of leads records in its audit row (#954): each of the list's filters as it
 * was sent, the search only as having been used, so that the audit never says an export was wider
 * than it was. The export's own filters are checked against the audit's, so that one added to it
 * (or to the list it extends) is not left out.
 */
import { EXPORT_AUDIT_FILTER_KEYS, exportAuditFilters } from '@/lib/features/leads/export';
import { exportLeadsSchema } from '@/lib/features/leads/types/schemas';
import { describe, expect, it } from 'vitest';

const ORG = '660e8400-e29b-41d4-a716-446655440000';

/**
 * Not filters of the leads: the organization (the audit row's own column), the order and the
 * format (other fields of the row's metadata), and the language (only the PDF's headings)
 */
const NOT_FILTERS = ['organizationId', 'sortBy', 'sortOrder', 'format', 'locale'];
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

  it('covers every filter an export takes', () => {
    const filters = Object.keys(exportLeadsSchema.shape).filter((key) => !NOT_FILTERS.includes(key));
    expect([...EXPORT_AUDIT_FILTER_KEYS, ...RECORDED_APART].sort()).toEqual(filters.sort());
    // Those recorded apart are recorded too, when they filter
    expect(
      Object.keys(exportAuditFilters({ organizationId: ORG, search: 'x', missingDeal: true })).sort()
    ).toEqual([...RECORDED_APART].sort());
  });
});
