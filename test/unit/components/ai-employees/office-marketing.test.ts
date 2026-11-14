/** The marketing room as the marketer's room (#1200): pure helpers */
import {
  MARKETING_CHOICES,
  MARKETING_FIGURE_BOARDS,
  MARKETING_FIRST_CHOICE,
  MARKETING_RANGE,
  MARKETING_RANGE_DAYS,
  UNSET_SOURCE,
  figureState,
  isLeadBoardView,
  marketingChoiceKey,
  marketingChoiceOfKey,
  marketingReport,
  progressRows,
  showsDealReturns,
  sourceRows,
  uncostedLeads,
} from '@/components/features/ai-employees/office-marketing';
import { LEAD_BOARD_VIEWS } from '@/components/features/ai-employees/office-rooms';
import { UNSET_INFLOW_SOURCE } from '@/lib/features/analytics/lead-sources';
import {
  type AcquisitionCostRow,
  type AcquisitionCostSummary,
  type ConversionFunnelData,
  type DealReturns,
  FUNNEL_STAGES,
  getAcquisitionCostSchema,
  getConversionFunnelSchema,
} from '@/lib/features/analytics/types/schemas';
import { describe, expect, it } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';

/** A funnel of the API from the prospects that reached each stage */
function funnel(reached: [number, number, number, number, number]): ConversionFunnelData {
  const total = reached[0];
  const rate = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 10000) / 100 : 0);
  return {
    stages: FUNNEL_STAGES.map((name, index) => ({
      name,
      count: reached[index] - (reached[index + 1] ?? 0),
      cumulativeCount: reached[index],
      percentage: index === 0 ? 100 : rate(reached[index], total),
      conversionRate: index === 0 ? 100 : rate(reached[index], reached[index - 1]),
    })),
    totalLeads: total,
    nurturingCount: 0,
    overallConversionRate: rate(reached[4], total),
    averageConversionDays: 0,
  };
}

const row = (
  source: string,
  leadCount: number,
  deals: DealReturns | null = null
): AcquisitionCostRow => ({
  source,
  leadCount,
  costedLeadCount: 0,
  sqlCount: 0,
  wonCount: 0,
  totalCost: 0,
  costPerSql: null,
  costPerWon: null,
  deals,
});

function cost(
  bySource: AcquisitionCostRow[],
  over: Partial<AcquisitionCostSummary> = {}
): AcquisitionCostSummary {
  return {
    leadCount: bySource.reduce((sum, source) => sum + source.leadCount, 0),
    costedLeadCount: 0,
    sqlCount: 0,
    wonCount: 0,
    totalCost: 0,
    costPerSql: null,
    costPerWon: null,
    deals: null,
    bySource,
    ...over,
  };
}

const RETURNS: DealReturns = {
  dealCount: 2,
  wonDealCount: 1,
  wonAmount: 3_000_000,
  costPerWonDeal: 100_000,
  roi: 30,
  medianDaysToWin: 21,
};

describe('the choices of the marketing room', () => {
  it('are the boards of figures first, then the views of the lead board', () => {
    expect(MARKETING_CHOICES).toEqual([...MARKETING_FIGURE_BOARDS, ...LEAD_BOARD_VIEWS]);
    expect(MARKETING_CHOICES).toContain(MARKETING_FIRST_CHOICE);
    expect(MARKETING_FIRST_CHOICE).toBe('sources');
  });

  it('each have their own number key, which chooses them', () => {
    const keys = MARKETING_CHOICES.map(marketingChoiceKey);
    expect(new Set(keys).size).toBe(MARKETING_CHOICES.length);
    for (const choice of MARKETING_CHOICES) {
      expect(marketingChoiceKey(choice)).toMatch(/^[1-9]$/);
      expect(marketingChoiceOfKey(marketingChoiceKey(choice))).toBe(choice);
    }
    // The keys a help article and a muscle memory rely on
    expect(marketingChoiceKey('sources')).toBe('1');
    expect(marketingChoiceKey('funnel')).toBe('2');
    expect(marketingChoiceKey('needsAction')).toBe('3');
    expect(marketingChoiceKey('all')).toBe('7');
  });

  it('are not chosen by other keys', () => {
    for (const key of ['0', '8', '9', 'a', 'Enter', 'ArrowDown', '']) {
      expect(marketingChoiceOfKey(key)).toBeNull();
    }
  });

  it('tell a view of the lead board from a board of figures', () => {
    for (const view of LEAD_BOARD_VIEWS) expect(isLeadBoardView(view)).toBe(true);
    for (const board of MARKETING_FIGURE_BOARDS) expect(isLeadBoardView(board)).toBe(false);
  });
});

describe('the period of the room', () => {
  it('is a period the analytics API accepts, said in the same days', () => {
    const input = { organizationId: ORG_ID, dateRange: MARKETING_RANGE };
    expect(getConversionFunnelSchema.safeParse(input).success).toBe(true);
    expect(getAcquisitionCostSchema.safeParse(input).success).toBe(true);
    expect(MARKETING_RANGE).toBe(`${MARKETING_RANGE_DAYS}d`);
  });

  it('names the bucket without a source as the API does', () => {
    expect(UNSET_SOURCE).toBe(UNSET_INFLOW_SOURCE);
  });
});

describe('marketingReport', () => {
  it('reads the prospects, those that reached MQL and a deal, and the largest source', () => {
    expect(
      marketingReport(funnel([20, 8, 3, 2, 1]), cost([row('seminar', 12), row('advertising', 8)]))
    ).toEqual({
      leads: 20,
      mql: 8,
      deals: 3,
      topSource: { source: 'seminar', count: 12 },
      withoutSource: 0,
    });
  });

  it('never names the prospects without a source as the largest source', () => {
    const report = marketingReport(
      funnel([10, 0, 0, 0, 0]),
      cost([row('referral_partner', 3), row(UNSET_SOURCE, 7)])
    );
    expect(report.topSource).toEqual({ source: 'referral_partner', count: 3 });
    // They are counted apart, so the report can say how many have no source
    expect(report.withoutSource).toBe(7);
    expect(
      marketingReport(funnel([7, 0, 0, 0, 0]), cost([row(UNSET_SOURCE, 7)])).topSource
    ).toBeNull();
  });

  it('reports nothing of its own for a period without prospects', () => {
    expect(marketingReport(funnel([0, 0, 0, 0, 0]), cost([]))).toEqual({
      leads: 0,
      mql: 0,
      deals: 0,
      topSource: null,
      withoutSource: 0,
    });
  });
});

describe('the source board', () => {
  it('keeps the order of the API and adds the share of each source', () => {
    const rows = sourceRows(cost([row('seminar', 2), row('advertising', 1), row(UNSET_SOURCE, 0)]));
    expect(rows.map((source) => [source.source, source.share])).toEqual([
      ['seminar', 67],
      ['advertising', 33],
      [UNSET_SOURCE, 0],
    ]);
    expect(sourceRows(cost([]))).toEqual([]);
  });

  it('shows what the deals brought in only when the API answered with it', () => {
    expect(showsDealReturns(cost([row('seminar', 1)]))).toBe(false);
    expect(showsDealReturns(cost([row('seminar', 1, RETURNS)], { deals: RETURNS }))).toBe(true);
  });

  it('counts the prospects without a recorded cost', () => {
    expect(uncostedLeads(cost([row('seminar', 5)], { costedLeadCount: 2 }))).toBe(3);
    expect(uncostedLeads(cost([row('seminar', 5)], { costedLeadCount: 5 }))).toBe(0);
  });
});

describe('the progress board', () => {
  it('has a row per stage, in the order of the lead lifecycle', () => {
    const rows = progressRows(funnel([20, 8, 3, 2, 1]));
    expect(rows.map((stage) => stage.name)).toEqual([...FUNNEL_STAGES]);
    expect(rows).toEqual([
      { name: 'lead', reached: 20, ofAll: 100, fromPrevious: null },
      { name: 'mql', reached: 8, ofAll: 40, fromPrevious: 40 },
      { name: 'deal', reached: 3, ofAll: 15, fromPrevious: 38 },
      { name: 'sql', reached: 2, ofAll: 10, fromPrevious: 67 },
      { name: 'won', reached: 1, ofAll: 5, fromPrevious: 50 },
    ]);
  });
});

describe('figureState', () => {
  it('tells reading, a missing permission, a failure and figures apart', () => {
    expect(figureState({ data: undefined, isError: false, error: null })).toBe('loading');
    expect(figureState({ data: {}, isError: false, error: null })).toBe('ready');
    expect(
      figureState({ data: undefined, isError: true, error: { data: { code: 'FORBIDDEN' } } })
    ).toBe('forbidden');
    expect(
      figureState({ data: undefined, isError: true, error: { data: { code: 'INTERNAL' } } })
    ).toBe('error');
    expect(figureState({ data: undefined, isError: true, error: { data: null } })).toBe('error');
  });
});
