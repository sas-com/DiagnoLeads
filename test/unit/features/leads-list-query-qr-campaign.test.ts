/**
 * The list filter by a QR campaign (#1255) in the URL, the chips, the API input and the export's
 * audit row. The rows it finds are checked on a real database, against the campaigns' breakdown,
 * in test/unit/integration/qr-campaign-breakdown.db.test.ts.
 */
import { exportAuditFilters } from '@/lib/features/leads/export';
import {
  DEFAULT_LEAD_LIST_QUERY,
  EMPTY_LEAD_FILTERS,
  type LeadListQuery,
  chipKey,
  filterChips,
  hasActiveFilters,
  leadListHref,
  parseLeadListQuery,
  removeChip,
  serializeLeadListQuery,
  toListLeadsInput,
} from '@/lib/features/leads/list-query';
import { exportLeadsSchema, listLeadsSchema } from '@/lib/features/leads/types/schemas';
import { describe, expect, it } from 'vitest';

const ORG = '660e8400-e29b-41d4-a716-446655440000';
const CAMPAIGN = 'c0000000-0000-4000-8000-000000000001';
const parse = (search: string) => parseLeadListQuery(new URLSearchParams(search));
const filtered: LeadListQuery = {
  ...DEFAULT_LEAD_LIST_QUERY,
  filters: { ...EMPTY_LEAD_FILTERS, qrCampaign: CAMPAIGN },
};

describe('a QR campaign in the lead list query (#1255)', () => {
  it('reads, writes and reads the filter back the same', () => {
    const read = parse(`qr=${CAMPAIGN}`);
    expect(read).toEqual(filtered);
    const written = serializeLeadListQuery(read).toString();
    expect(written).toBe(`qr=${CAMPAIGN}`);
    expect(parse(written)).toEqual(read);
  });

  it('round-trips it with the other filters, the sort and the page', () => {
    const query: LeadListQuery = {
      filters: { ...EMPTY_LEAD_FILTERS, consultation: true, qrCampaign: CAMPAIGN },
      sort: { by: 'updatedAt', order: 'asc' },
      page: 2,
    };
    const written = serializeLeadListQuery(query).toString();
    expect(parse(written)).toEqual(query);
    expect(written).toContain(`qr=${CAMPAIGN}`);
  });

  it.each(['qr=', 'qr=1', 'qr=Qb12345678', "qr=' or 1=1 --", `qr=${CAMPAIGN}x`])(
    'drops what is not a campaign id (%s)',
    (search) => {
      expect(parse(search)).toEqual(DEFAULT_LEAD_LIST_QUERY);
    }
  );

  it('links to the filtered list: the same view the room shows', () => {
    expect(leadListHref({ qrCampaign: CAMPAIGN }, undefined, '/ja/leads')).toBe(
      `/ja/leads?qr=${CAMPAIGN}`
    );
  });

  it('shows as one condition that can be removed', () => {
    expect(hasActiveFilters(filtered.filters)).toBe(true);
    const chips = filterChips(filtered.filters);
    expect(chips).toEqual([{ kind: 'qrCampaign', value: CAMPAIGN }]);
    expect(chipKey(chips[0])).toBe(`qrCampaign:${CAMPAIGN}`);
    expect(removeChip(filtered.filters, chips[0])).toEqual(EMPTY_LEAD_FILTERS);
    // The other conditions stay
    expect(
      removeChip({ ...filtered.filters, consultation: true }, chips[0])
    ).toEqual({ ...EMPTY_LEAD_FILTERS, consultation: true });
  });

  it('asks the API for the campaign, and for nothing of it without the filter', () => {
    const input = toListLeadsInput(filtered, ORG, 20);
    expect(input.qrCampaignId).toBe(CAMPAIGN);
    expect(listLeadsSchema.parse(input).qrCampaignId).toBe(CAMPAIGN);
    expect(toListLeadsInput(DEFAULT_LEAD_LIST_QUERY, ORG, 20)).not.toHaveProperty('qrCampaignId');
  });

  it('is refused by the API when it is not an id', () => {
    expect(listLeadsSchema.safeParse({ organizationId: ORG, qrCampaignId: 'Qb12345678' }).success).toBe(
      false
    );
  });

  it('is carried by the export, and written to its audit row as the id', () => {
    const input = exportLeadsSchema.parse({ organizationId: ORG, format: 'csv', qrCampaignId: CAMPAIGN });
    expect(input.qrCampaignId).toBe(CAMPAIGN);
    expect(exportAuditFilters(input)).toEqual({ qrCampaignId: CAMPAIGN });
  });
});
