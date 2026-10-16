/**
 * Lead list URL state for the latest hearing (#137) and the pure parts of the export (#173)
 */
import {
  LEAD_EXPORT_MAX_ROWS,
  type LeadExportRow,
  csvCell,
  exportAuditFilters,
  leadExportCsv,
  leadExportFilename,
  leadExportJson,
} from '@/lib/features/leads/export';
import {
  DEFAULT_LEAD_LIST_QUERY,
  EMPTY_LEAD_FILTERS,
  applyPreset,
  filterChips,
  isNextMeetingOverdue,
  matchingPreset,
  parseLeadListQuery,
  presetHref,
  removeChip,
  serializeLeadListQuery,
  toLeadFilterInput,
  toListLeadsInput,
} from '@/lib/features/leads/list-query';
import { nextMeetingRate } from '@/lib/features/leads/meetings';
import { describe, expect, it } from 'vitest';

const ORG = '11111111-1111-4111-8111-111111111111';
// Thursday 2026-10-15 in Japan
const NOW = new Date('2026-10-15T03:00:00Z');
const parse = (search: string) => parseLeadListQuery(new URLSearchParams(search));

describe('next meeting and rating in the URL (#137)', () => {
  it('reads and writes the filters, in canonical order', () => {
    const query = parse('next=overdue&rating=c,a,a,x');
    expect(query.filters.nextMeeting).toBe('overdue');
    expect(query.filters.dealRating).toEqual(['a', 'c']);
    expect(serializeLeadListQuery(query).toString()).toBe('next=overdue&rating=a%2Cc');
  });

  it('drops broken values', () => {
    const query = parse('next=tomorrow&rating=x');
    expect(query.filters.nextMeeting).toBeUndefined();
    expect(query.filters.dealRating).toBeUndefined();
    expect(serializeLeadListQuery(query).toString()).toBe('');
  });

  it('sorts by the next meeting soonest first and the rating A first when clicked first', () => {
    expect(parse('sort=nextMeetingDate').sort).toEqual({ by: 'nextMeetingDate', order: 'asc' });
    expect(parse('sort=dealRating').sort).toEqual({ by: 'dealRating', order: 'asc' });
  });

  it('passes them to leads.list and to the export (no page there)', () => {
    const query = parse('next=thisWeek&rating=b&sort=dealRating&page=3');
    expect(toListLeadsInput(query, ORG, 20)).toEqual({
      organizationId: ORG,
      limit: 20,
      offset: 40,
      sortBy: 'dealRating',
      sortOrder: 'asc',
      nextMeeting: 'thisWeek',
      dealRating: ['b'],
    });
    expect(toLeadFilterInput(query, ORG)).toEqual({
      organizationId: ORG,
      sortBy: 'dealRating',
      sortOrder: 'asc',
      nextMeeting: 'thisWeek',
      dealRating: ['b'],
    });
  });

  it('has a chip per condition, each removable', () => {
    const filters = parse('next=has&rating=a,b').filters;
    const chips = filterChips(filters);
    expect(chips).toEqual([
      { kind: 'nextMeeting', value: 'has' },
      { kind: 'dealRating', value: 'a' },
      { kind: 'dealRating', value: 'b' },
    ]);
    const withoutA = removeChip(filters, chips[1]);
    expect(withoutA.dealRating).toEqual(['b']);
    const withoutRatings = removeChip(withoutA, { kind: 'dealRating', value: 'b' });
    expect(withoutRatings.dealRating).toBeUndefined();
    expect(removeChip(filters, chips[0]).nextMeeting).toBeUndefined();
  });
});

describe('presets 今週の商談 / 次回日程の過ぎたリード (#137)', () => {
  it('set the filter and sort by the date, soonest first', () => {
    const week = applyPreset(
      { ...DEFAULT_LEAD_LIST_QUERY, page: 4, sort: { by: 'score', order: 'desc' } },
      'meetingsThisWeek',
      NOW
    );
    expect(week).toEqual({
      filters: { ...EMPTY_LEAD_FILTERS, nextMeeting: 'thisWeek' },
      sort: { by: 'nextMeetingDate', order: 'asc' },
      page: 1,
    });
    expect(matchingPreset(week.filters, NOW)).toBe('meetingsThisWeek');
    expect(presetHref('nextMeetingOverdue', NOW, '/ja/leads')).toBe(
      '/ja/leads?next=overdue&sort=nextMeetingDate&order=asc'
    );
  });

  it('other presets keep the current sort', () => {
    const query = { ...DEFAULT_LEAD_LIST_QUERY, sort: { by: 'score', order: 'desc' } as const };
    expect(applyPreset(query, 'consultation', NOW).sort).toEqual({ by: 'score', order: 'desc' });
  });
});

describe('isNextMeetingOverdue', () => {
  const at = (nextMeetingDate: string | null, status = 'nurturing') => ({ nextMeetingDate, status });

  it('is before today in Japan; today and later are not overdue', () => {
    expect(isNextMeetingOverdue(at('2026-10-14'), NOW)).toBe(true);
    expect(isNextMeetingOverdue(at('2026-10-15'), NOW)).toBe(false);
    expect(isNextMeetingOverdue(at('2026-10-20'), NOW)).toBe(false);
    expect(isNextMeetingOverdue(at(null), NOW)).toBe(false);
    // 00:30 JST on the 16th: the 15th has passed
    expect(isNextMeetingOverdue(at('2026-10-15'), new Date('2026-10-15T15:30:00Z'))).toBe(true);
  });

  it('never marks won or lost leads', () => {
    expect(isNextMeetingOverdue(at('2026-10-01', 'won'), NOW)).toBe(false);
    expect(isNextMeetingOverdue(at('2026-10-01', 'lost'), NOW)).toBe(false);
    expect(isNextMeetingOverdue(at('2026-10-01', 'negotiating'), NOW)).toBe(true);
  });
});

describe('nextMeetingRate', () => {
  it('is the share of first meetings that fixed a next meeting; null without any', () => {
    expect(nextMeetingRate(4, 3)).toBe(0.75);
    expect(nextMeetingRate(0, 0)).toBeNull();
  });
});

describe('export file (#173)', () => {
  const row = (overrides: Partial<LeadExportRow> = {}): LeadExportRow => ({
    id: 'l1',
    name: '山田, 太郎',
    email: 'yamada@example.jp',
    company: '架空"製作所"',
    phone: null,
    status: 'new',
    dealPhase: null,
    score: 70,
    source: 'diagnostic',
    inflowSource: null,
    assignee: null,
    nextMeetingDate: '2026-10-20',
    dealRating: 'b',
    createdAt: new Date('2026-10-01T00:00:00Z'),
    ...overrides,
  });

  it('caps at 5,000 rows', () => {
    expect(LEAD_EXPORT_MAX_ROWS).toBe(5000);
  });

  it('quotes cells and keeps spreadsheet formulas from running', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+81')).toBe("'+81");
    expect(csvCell('@SUM(1)')).toBe("'@SUM(1)");
  });

  it('writes CSV with a BOM, a header and one line per lead', () => {
    const csv = leadExportCsv([row(), row({ id: 'l2', company: null, dealRating: null })]);
    expect(csv.startsWith('﻿ID,Name,Email,Company,Phone,Status,Deal Phase')).toBe(true);
    const lines = csv.slice(1).trimEnd().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe(
      'l1,"山田, 太郎",yamada@example.jp,"架空""製作所""",,new,,70,diagnostic,,,2026-10-20,B,2026-10-01T00:00:00.000Z'
    );
  });

  it('writes JSON with ISO dates', () => {
    expect(JSON.parse(leadExportJson([row()]))[0]).toMatchObject({
      id: 'l1',
      nextMeetingDate: '2026-10-20',
      createdAt: '2026-10-01T00:00:00.000Z',
    });
  });

  it('names the file with the Japan day', () => {
    expect(leadExportFilename('pdf', '2026-10-16')).toBe('leads_2026-10-16.pdf');
  });

  it('records the filters used, never the search text or the advanced filter values', () => {
    expect(
      exportAuditFilters({
        organizationId: ORG,
        status: ['new'],
        dealRating: [],
        search: 'yamada@example.jp',
        nextMeeting: 'overdue',
        advancedFilter: {
          logic: 'and',
          conditions: [{ field: 'email', operator: 'contains', value: 'yamada' }],
        },
      })
    ).toEqual({ status: ['new'], nextMeeting: 'overdue', search: true, advancedFilter: true });
  });
});
