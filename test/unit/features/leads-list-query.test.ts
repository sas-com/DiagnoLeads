/**
 * Lead list state in the URL (#131): parse / serialize round trip, broken params, presets,
 * chips and the list input.
 */
import {
  DEFAULT_LEAD_LIST_QUERY,
  EMPTY_LEAD_FILTERS,
  type LeadListQuery,
  applyPreset,
  filterChips,
  hasActiveFilters,
  jstWeekStart,
  leadListHref,
  matchingPreset,
  mergeLeadListQuery,
  nextSort,
  parseLeadListQuery,
  presetFilters,
  presetHref,
  removeChip,
  serializeLeadListQuery,
  toListLeadsInput,
} from '@/lib/features/leads/list-query';
import { listLeadsSchema } from '@/lib/features/leads/types/schemas';
import { describe, expect, it } from 'vitest';

const ORG = '660e8400-e29b-41d4-a716-446655440000';
const parse = (search: string) => parseLeadListQuery(new URLSearchParams(search));
// Friday 2026-10-16 15:00 JST
const NOW = new Date('2026-10-16T06:00:00Z');

const full: LeadListQuery = {
  filters: {
    status: ['new', 'negotiating'],
    dealPhase: ['proposal'],
    inflowSource: ['seminar', 'advertising'],
    targetSystem: ['as400'],
    scoreMin: 40,
    scoreMax: 80,
    createdFrom: '2026-10-01',
    createdTo: '2026-10-16',
    consultation: true,
    mql: false,
    sql: 'qualified',
    search: '山田 商事',
  },
  sort: { by: 'score', order: 'asc' },
  page: 3,
};

describe('parse / serialize', () => {
  it('reads the plain list as the defaults and writes it as nothing', () => {
    expect(parse('')).toEqual(DEFAULT_LEAD_LIST_QUERY);
    expect(serializeLeadListQuery(DEFAULT_LEAD_LIST_QUERY).toString()).toBe('');
  });

  it('round-trips every field', () => {
    const search = serializeLeadListQuery(full).toString();
    expect(parse(search)).toEqual(full);
    expect(serializeLeadListQuery(parse(search)).toString()).toBe(search);
  });

  it('uses short, readable names', () => {
    expect(serializeLeadListQuery(full).toString()).toBe(
      'status=new%2Cnegotiating&phase=proposal&inflow=seminar%2Cadvertising&system=as400&scoreMin=40&scoreMax=80&from=2026-10-01&to=2026-10-16&consult=1&mql=0&sql=qualified&q=%E5%B1%B1%E7%94%B0+%E5%95%86%E4%BA%8B&sort=score&order=asc&page=3'
    );
  });

  it('round-trips each filter alone', () => {
    const singles: Partial<LeadListQuery['filters']>[] = [
      { status: ['lost'] },
      { dealPhase: ['ax', 'initial_hearing'] },
      { inflowSource: ['referral_agency'] },
      { targetSystem: ['other', 'unknown'] },
      { scoreMin: 0 },
      { scoreMax: 100 },
      { createdFrom: '2026-01-31' },
      { createdTo: '2026-02-01' },
      { consultation: false },
      { mql: true },
      { sql: 'undecided' },
      { search: '100%' },
    ];
    for (const patch of singles) {
      const query = { ...DEFAULT_LEAD_LIST_QUERY, filters: { ...EMPTY_LEAD_FILTERS, ...patch } };
      const parsed = parse(serializeLeadListQuery(query).toString());
      // Multi-selects come back in definition order
      expect(serializeLeadListQuery(parsed).toString()).toBe(
        serializeLeadListQuery(query).toString()
      );
      expect(hasActiveFilters(parsed.filters)).toBe(true);
    }
  });

  it('drops unknown and broken values instead of failing', () => {
    const query = parse(
      'status=new,bogus,new&phase=&inflow=x&scoreMin=abc&scoreMax=150&from=2026-13-01&to=yesterday&consult=yes&mql=2&sql=maybe&sort=phone&order=up&page=-1&q=%20%20'
    );
    expect(query).toEqual({
      ...DEFAULT_LEAD_LIST_QUERY,
      filters: { ...EMPTY_LEAD_FILTERS, status: ['new'] },
    });
  });

  it('does not read an empty score as 0', () => {
    expect(parse('scoreMin=&scoreMax=').filters.scoreMin).toBeUndefined();
  });

  it('swaps reversed ranges', () => {
    const query = parse('scoreMin=90&scoreMax=10&from=2026-10-16&to=2026-10-01');
    expect(query.filters).toMatchObject({
      scoreMin: 10,
      scoreMax: 90,
      createdFrom: '2026-10-01',
      createdTo: '2026-10-16',
    });
  });

  it('gives a sort column its natural order when the order is missing', () => {
    expect(parse('sort=name').sort).toEqual({ by: 'name', order: 'asc' });
    expect(parse('sort=score').sort).toEqual({ by: 'score', order: 'desc' });
  });

  it('keeps search params that are not the list’s', () => {
    const merged = mergeLeadListQuery(
      new URLSearchParams('leadId=abc&status=won&page=4'),
      { ...DEFAULT_LEAD_LIST_QUERY, filters: { ...EMPTY_LEAD_FILTERS, status: ['new'] } }
    );
    expect(merged).toBe('leadId=abc&status=new');
  });
});

describe('list input', () => {
  it('maps the query to a valid leads.list input', () => {
    const input = toListLeadsInput(full, ORG, 20);
    expect(input).toEqual({
      organizationId: ORG,
      limit: 20,
      offset: 40,
      sortBy: 'score',
      sortOrder: 'asc',
      status: ['new', 'negotiating'],
      dealPhase: ['proposal'],
      inflowSource: ['seminar', 'advertising'],
      targetSystem: ['as400'],
      scoreMin: 40,
      scoreMax: 80,
      createdFromDay: '2026-10-01',
      createdToDay: '2026-10-16',
      consultationRequested: true,
      mql: false,
      sqlDecision: 'qualified',
      search: '山田 商事',
    });
    expect(listLeadsSchema.safeParse(input).success).toBe(true);
  });

  it('sends no filter for the plain list', () => {
    expect(toListLeadsInput(DEFAULT_LEAD_LIST_QUERY, ORG)).toEqual({
      organizationId: ORG,
      limit: 20,
      offset: 0,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
  });
});

describe('presets', () => {
  it('starts the week on Monday in Japan time', () => {
    expect(jstWeekStart(NOW)).toBe('2026-10-12');
    // Sunday 23:30 JST still belongs to the week that started on Monday 10/12
    expect(jstWeekStart(new Date('2026-10-18T14:30:00Z'))).toBe('2026-10-12');
    // Monday 00:10 JST (Sunday in UTC) starts a new week
    expect(jstWeekStart(new Date('2026-10-18T15:10:00Z'))).toBe('2026-10-19');
  });

  it('defines the four quick filters', () => {
    expect(presetFilters('needsAction', NOW)).toEqual({ ...EMPTY_LEAD_FILTERS, status: ['new'] });
    expect(presetFilters('consultation', NOW)).toEqual({ ...EMPTY_LEAD_FILTERS, consultation: true });
    expect(presetFilters('newThisWeek', NOW)).toEqual({
      ...EMPTY_LEAD_FILTERS,
      createdFrom: '2026-10-12',
    });
    expect(presetFilters('negotiating', NOW)).toEqual({
      ...EMPTY_LEAD_FILTERS,
      status: ['negotiating'],
    });
  });

  it('replaces the filters, keeps the sort and goes back to page 1', () => {
    const next = applyPreset(full, 'consultation', NOW);
    expect(next).toEqual({
      filters: { ...EMPTY_LEAD_FILTERS, consultation: true },
      sort: full.sort,
      page: 1,
    });
  });

  it('recognises a preset only when the filters are exactly it', () => {
    expect(matchingPreset(presetFilters('negotiating', NOW), NOW)).toBe('negotiating');
    expect(matchingPreset(parse('consult=1').filters, NOW)).toBe('consultation');
    expect(matchingPreset(parse('consult=1&q=a').filters, NOW)).toBeNull();
    expect(matchingPreset(EMPTY_LEAD_FILTERS, NOW)).toBeNull();
  });

  it('builds links for the dashboard', () => {
    expect(presetHref('needsAction', NOW)).toBe('/leads?status=new');
    expect(presetHref('newThisWeek', NOW, '/ja/leads')).toBe('/ja/leads?from=2026-10-12');
    expect(leadListHref()).toBe('/leads');
    expect(leadListHref({ status: ['won', 'new'], consultation: true })).toBe(
      '/leads?status=new%2Cwon&consult=1'
    );
    expect(leadListHref({}, { by: 'lastActivityAt', order: 'desc' })).toBe(
      '/leads?sort=lastActivityAt&order=desc'
    );
  });
});

describe('chips', () => {
  it('makes one chip per condition and value', () => {
    expect(filterChips(full.filters).map((chip) => chip.kind)).toEqual([
      'search',
      'status',
      'status',
      'dealPhase',
      'inflowSource',
      'inflowSource',
      'targetSystem',
      'score',
      'created',
      'consultation',
      'mql',
      'sql',
    ]);
    expect(filterChips(EMPTY_LEAD_FILTERS)).toEqual([]);
  });

  it('removes one chip at a time until nothing is left', () => {
    let filters = full.filters;
    let chips = filterChips(filters);
    expect(chips).toHaveLength(12);
    while (chips.length > 0) {
      const [first] = chips;
      filters = removeChip(filters, first);
      const next = filterChips(filters);
      expect(next).toHaveLength(chips.length - 1);
      chips = next;
    }
    expect(filters).toEqual(EMPTY_LEAD_FILTERS);
  });

  it('removes only the chosen value of a multi-select', () => {
    const filters = removeChip(full.filters, { kind: 'status', value: 'new' });
    expect(filters.status).toEqual(['negotiating']);
    expect(filters.inflowSource).toEqual(full.filters.inflowSource);
  });
});

describe('sorting by header', () => {
  it('flips the same column and starts another in its natural order', () => {
    expect(nextSort({ by: 'createdAt', order: 'desc' }, 'createdAt')).toEqual({
      by: 'createdAt',
      order: 'asc',
    });
    expect(nextSort({ by: 'createdAt', order: 'desc' }, 'company')).toEqual({
      by: 'company',
      order: 'asc',
    });
    expect(nextSort({ by: 'company', order: 'asc' }, 'lastActivityAt')).toEqual({
      by: 'lastActivityAt',
      order: 'desc',
    });
  });
});
