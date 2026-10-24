/**
 * Forecast (#437): the periods of a fiscal year, the figures with their ratios, the targets of
 * the organization and its members, and how the week's pipeline changes are grouped. The DB
 * behaviour is covered by test/unit/integration/sales-forecast.db.test.ts.
 */
import { forecastRange } from '@/lib/features/sales-forecast/period';
import {
  CHANGED_DEALS_SHOWN,
  type DealChangeInput,
  EMPTY_FIGURES,
  changeKinds,
  classifyChanges,
  forecastRow,
  memberTarget,
  organizationTarget,
  ownerRowsFor,
  sumFigures,
} from '@/lib/features/sales-forecast/report';
import {
  fiscalYearOf,
  fiscalYearRange,
  readFiscalYearStartMonth,
} from '@/lib/features/sales-targets/fiscal-year';
import { describe, expect, it } from 'vitest';

describe('forecastRange', () => {
  it('is the calendar month for this month', () => {
    expect(forecastRange('thisMonth', '2026-02-10')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
      months: ['2026-02-01'],
    });
  });

  it.each([
    ['2026-10-24', 4, '2026-10-01', '2026-12-31'],
    ['2026-04-01', 4, '2026-04-01', '2026-06-30'],
    ['2027-03-31', 4, '2027-01-01', '2027-03-31'],
    ['2026-05-15', 1, '2026-04-01', '2026-06-30'],
    ['2026-02-15', 11, '2026-02-01', '2026-04-30'],
    ['2026-12-15', 11, '2026-11-01', '2027-01-31'],
  ])('this quarter of %s with the year starting in month %i', (today, start, from, to) => {
    const range = forecastRange('thisQuarter', today, start);
    expect(range).toMatchObject({ from, to });
    expect(range.months).toHaveLength(3);
  });

  it('is the fiscal year containing today', () => {
    expect(forecastRange('thisFiscalYear', '2027-03-31', 4)).toMatchObject({
      from: '2026-04-01',
      to: '2027-03-31',
    });
    expect(forecastRange('thisFiscalYear', '2026-04-01', 4).from).toBe('2026-04-01');
    expect(forecastRange('thisFiscalYear', '2026-10-24', 1)).toMatchObject({
      from: '2026-01-01',
      to: '2026-12-31',
    });
  });

  it('reads the start month from the settings, April when missing or broken', () => {
    expect(readFiscalYearStartMonth({ salesForecast: { fiscalYearStartMonth: 1 } })).toBe(1);
    expect(readFiscalYearStartMonth({ salesForecast: { fiscalYearStartMonth: 13 } })).toBe(4);
    expect(readFiscalYearStartMonth({})).toBe(4);
    expect(readFiscalYearStartMonth(null)).toBe(4);
  });

  it('names a fiscal year by the year it starts in', () => {
    expect(fiscalYearOf(2027, 3, 4)).toBe(2026);
    expect(fiscalYearOf(2026, 4, 4)).toBe(2026);
    expect(fiscalYearRange(2026, 4).months).toEqual([
      '2026-04-01',
      '2026-05-01',
      '2026-06-01',
      '2026-07-01',
      '2026-08-01',
      '2026-09-01',
      '2026-10-01',
      '2026-11-01',
      '2026-12-01',
      '2027-01-01',
      '2027-02-01',
      '2027-03-01',
    ]);
  });
});

describe('forecastRow', () => {
  const figures = {
    ...EMPTY_FIGURES,
    won: 4_000_000,
    commit: 3_000_000,
    bestCase: 2_000_000,
    pipeline: 1_000_000,
    weighted: 3_500_000,
    openCount: 4,
  };

  it('adds the forecast, the best case and the ratios against the target', () => {
    expect(forecastRow(figures, 10_000_000)).toMatchObject({
      forecast: 7_000_000,
      bestCaseTotal: 9_000_000,
      achievement: 0.4,
      forecastAchievement: 0.7,
      gap: 3_000_000,
    });
  });

  it('has no ratios without a target and a negative gap above it', () => {
    expect(forecastRow(figures, null)).toMatchObject({
      achievement: null,
      forecastAchievement: null,
      gap: null,
    });
    expect(forecastRow(figures, 0).achievement).toBeNull();
    expect(forecastRow(figures, 5_000_000).gap).toBe(-2_000_000);
  });

  it('sums the figures of several owners', () => {
    expect(sumFigures([figures, { ...EMPTY_FIGURES, won: 1, noAmountCount: 2 }])).toEqual({
      ...figures,
      won: 4_000_001,
      noAmountCount: 2,
    });
  });
});

describe('targets', () => {
  const months = ['2026-10-01', '2026-11-01', '2026-12-01'];
  const targets = [
    { userId: 'a', month: '2026-10-01', amount: 1_000_000 },
    { userId: 'b', month: '2026-10-01', amount: 2_000_000 },
    { userId: null, month: '2026-11-01', amount: 5_000_000 },
    { userId: 'a', month: '2026-11-01', amount: 1_000_000 },
  ];

  it('takes the organization-wide target of a month, else the sum of its members', () => {
    expect(organizationTarget(months, targets)).toBe(8_000_000);
    expect(organizationTarget(['2026-12-01'], targets)).toBeNull();
  });

  it('sums a member over the months', () => {
    expect(memberTarget('a', targets)).toBe(2_000_000);
    expect(memberTarget('c', targets)).toBeNull();
  });
});

describe('changeKinds', () => {
  const deal = (overrides: Partial<DealChangeInput>): DealChangeInput => ({
    id: 'd',
    name: '商談',
    ownerName: null,
    stage: 'proposal',
    amount: 1_000_000,
    expectedCloseOn: '2026-11-30',
    before: { stage: 'proposal', amount: 1_000_000, expectedCloseOn: '2026-11-30' },
    ...overrides,
  });

  it.each([
    [{ before: null }, ['created']],
    [{ before: null, stage: 'won' }, ['created', 'won']],
    [{ stage: 'negotiation' }, ['advanced']],
    [{ stage: 'discovery' }, ['movedBack']],
    [{ stage: 'won' }, ['won']],
    [{ stage: 'lost' }, ['lost']],
    [
      { stage: 'qualification', before: { stage: 'lost', amount: 1, expectedCloseOn: null } },
      ['reopened'],
    ],
    [{ expectedCloseOn: '2026-12-31' }, ['slipped']],
    [{ expectedCloseOn: null }, ['slipped']],
    [{ expectedCloseOn: '2026-11-01' }, []],
    [{ stage: 'negotiation', expectedCloseOn: '2027-01-31' }, ['advanced', 'slipped']],
  ] as const)('%o', (overrides, expected) => {
    expect(changeKinds(deal(overrides as Partial<DealChangeInput>))).toEqual(expected);
  });
});

describe('classifyChanges', () => {
  const base = {
    name: '商談',
    ownerName: '営業 花子',
    expectedCloseOn: '2026-11-30',
  };

  it('counts and sums each group and nets the change of open amounts', () => {
    const changes = classifyChanges([
      { ...base, id: 'a', stage: 'proposal', amount: 2_000_000, before: null },
      {
        ...base,
        id: 'b',
        stage: 'negotiation',
        amount: 3_000_000,
        before: { stage: 'proposal', amount: 2_500_000, expectedCloseOn: '2026-11-30' },
      },
      {
        ...base,
        id: 'c',
        stage: 'won',
        amount: 1_000_000,
        before: { stage: 'negotiation', amount: 1_000_000, expectedCloseOn: '2026-11-30' },
      },
    ]);
    expect(changes.groups.created).toMatchObject({ count: 1, amount: 2_000_000 });
    expect(changes.groups.advanced).toMatchObject({ count: 1, amount: 3_000_000 });
    expect(changes.groups.won.deals.map((deal) => deal.id)).toEqual(['c']);
    expect(changes.groups.lost.count).toBe(0);
    // Only deals open both then and now: b went from 2.5M to 3M
    expect(changes.amountDelta).toBe(500_000);
  });

  it('lists a limited number of deals per group but counts them all', () => {
    const many = Array.from({ length: CHANGED_DEALS_SHOWN + 5 }, (_, index) => ({
      ...base,
      id: `n${index}`,
      stage: 'qualification',
      amount: 100,
      before: null,
    }));
    const changes = classifyChanges(many);
    expect(changes.groups.created.count).toBe(CHANGED_DEALS_SHOWN + 5);
    expect(changes.groups.created.deals).toHaveLength(CHANGED_DEALS_SHOWN);
    expect(changes.groups.created.amount).toBe(100 * (CHANGED_DEALS_SHOWN + 5));
  });
});

describe('ownerRowsFor', () => {
  const row = (ownerUserId: string | null, target: number | null) => ({
    ...forecastRow({ ...EMPTY_FIGURES, won: 2_000_000, commit: 1_000_000 }, target),
    ownerUserId,
  });
  const owners = [row('rep-1', 10_000_000), row('rep-2', 8_000_000), row(null, null)];

  it('shows every target to those who set them', () => {
    const rows = ownerRowsFor(owners, { userId: 'manager', seesEveryTarget: true });
    expect(rows.map((r) => [r.target, r.targetHidden])).toEqual([
      [10_000_000, false],
      [8_000_000, false],
      [null, false],
    ]);
  });

  it("shows a rep their own target and keeps only the others' deal figures", () => {
    const rows = ownerRowsFor(owners, { userId: 'rep-1', seesEveryTarget: false });
    expect(rows[0]).toMatchObject({ target: 10_000_000, achievement: 0.2, targetHidden: false });
    expect(rows[1]).toMatchObject({
      won: 2_000_000,
      commit: 1_000_000,
      target: null,
      achievement: null,
      forecastAchievement: null,
      gap: null,
      targetHidden: true,
    });
    expect(rows[2].targetHidden).toBe(false);
  });
});

