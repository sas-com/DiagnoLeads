/**
 * Analytics Schemas Tests
 *
 * Unit tests for analytics type definitions and validation schemas
 */

import { describe, expect, it } from 'vitest';
import {
  dateRangeSchema,
  trendGranularitySchema,
  getOverviewSchema,
  getLeadTrendSchema,
  getSourceBreakdownSchema,
  getStatusBreakdownSchema,
  getConversionFunnelSchema,
  getResponseTimeSchema,
  getAcquisitionCostSchema,
  type DateRange,
  type TrendGranularity,
  type OverviewStats,
  type TrendDataPoint,
  type SourceBreakdown,
  type StatusBreakdown,
  type FunnelStage,
  type ConversionFunnelData,
  type ResponseTimeData,
  type AcquisitionCostSummary,
} from '@/lib/features/analytics/types/schemas';

describe('dateRangeSchema', () => {
  it('should accept valid date ranges', () => {
    expect(dateRangeSchema.parse('7d')).toBe('7d');
    expect(dateRangeSchema.parse('30d')).toBe('30d');
    expect(dateRangeSchema.parse('90d')).toBe('90d');
    expect(dateRangeSchema.parse('all')).toBe('all');
  });

  it('should reject invalid date range', () => {
    expect(() => dateRangeSchema.parse('1d')).toThrow();
    expect(() => dateRangeSchema.parse('invalid')).toThrow();
  });
});

describe('trendGranularitySchema', () => {
  it('should accept valid granularities', () => {
    expect(trendGranularitySchema.parse('daily')).toBe('daily');
    expect(trendGranularitySchema.parse('monthly')).toBe('monthly');
  });

  it('should reject invalid granularity', () => {
    expect(() => trendGranularitySchema.parse('weekly')).toThrow();
    expect(() => trendGranularitySchema.parse('hourly')).toThrow();
  });
});

describe('getOverviewSchema', () => {
  it('should accept valid input', () => {
    const input = {
      organizationId: '123e4567-e89b-12d3-a456-426614174000',
    };

    const result = getOverviewSchema.parse(input);
    expect(result.organizationId).toBe('123e4567-e89b-12d3-a456-426614174000');
    expect(result.dateRange).toBe('30d'); // default
  });

  it('should accept custom date range', () => {
    const input = {
      organizationId: '123e4567-e89b-12d3-a456-426614174000',
      dateRange: '90d' as const,
    };

    const result = getOverviewSchema.parse(input);
    expect(result.dateRange).toBe('90d');
  });

  it('should reject invalid organizationId', () => {
    expect(() =>
      getOverviewSchema.parse({
        organizationId: 'invalid',
      })
    ).toThrow();
  });
});

describe('getLeadTrendSchema', () => {
  it('should accept valid input with defaults', () => {
    const input = {
      organizationId: '123e4567-e89b-12d3-a456-426614174000',
    };

    const result = getLeadTrendSchema.parse(input);
    expect(result.dateRange).toBe('30d');
    expect(result.granularity).toBe('daily');
  });

  it('should accept custom granularity', () => {
    const input = {
      organizationId: '123e4567-e89b-12d3-a456-426614174000',
      granularity: 'monthly' as const,
    };

    const result = getLeadTrendSchema.parse(input);
    expect(result.granularity).toBe('monthly');
  });
});

describe('getSourceBreakdownSchema', () => {
  it('should accept valid input', () => {
    const input = {
      organizationId: '123e4567-e89b-12d3-a456-426614174000',
      dateRange: '7d' as const,
    };

    const result = getSourceBreakdownSchema.parse(input);
    expect(result.dateRange).toBe('7d');
  });
});

describe('getStatusBreakdownSchema', () => {
  it('should accept valid input', () => {
    const input = {
      organizationId: '123e4567-e89b-12d3-a456-426614174000',
    };

    const result = getStatusBreakdownSchema.parse(input);
    expect(result.dateRange).toBe('30d');
  });
});

describe('getConversionFunnelSchema', () => {
  it('should accept valid input', () => {
    const input = {
      organizationId: '123e4567-e89b-12d3-a456-426614174000',
      dateRange: 'all' as const,
    };

    const result = getConversionFunnelSchema.parse(input);
    expect(result.dateRange).toBe('all');
  });
});


describe('getResponseTimeSchema', () => {
  it('should accept valid input', () => {
    const input = {
      organizationId: '123e4567-e89b-12d3-a456-426614174000',
    };

    const result = getResponseTimeSchema.parse(input);
    expect(result.dateRange).toBe('30d');
  });
});

describe('getAcquisitionCostSchema', () => {
  it('should accept minimal input', () => {
    const result = getAcquisitionCostSchema.parse({
      organizationId: '123e4567-e89b-12d3-a456-426614174000',
    });
    expect(result.dateRange).toBe('30d');
  });

  it('takes no hand-typed unit prices: costs come from the leads', () => {
    const result = getAcquisitionCostSchema.parse({
      organizationId: '123e4567-e89b-12d3-a456-426614174000',
      costPerLead: { website: 50 },
      averageDealValue: 10000,
    });
    expect(result).not.toHaveProperty('costPerLead');
    expect(result).not.toHaveProperty('averageDealValue');
  });
});

describe('Analytics response types', () => {
  describe('OverviewStats', () => {
    it('should create valid overview stats', () => {
      const stats: OverviewStats = {
        totalLeads: 1000,
        newLeadsThisMonth: 150,
        conversionRate: 15.5,
        mqlLevels: { interest: 300, fit: 250, none: 350, unknown: 100 },
        mqlRate: 30,
        leadsByStatus: {
          new: 300,
          nurturing: 400,
          negotiating: 200,
          won: 100,
          lost: 0,
        },
      };

      expect(stats.totalLeads).toBe(1000);
      expect(stats.leadsByStatus.won).toBe(100);
    });
  });

  describe('TrendDataPoint', () => {
    it('should create valid trend data point', () => {
      const point: TrendDataPoint = {
        date: '2024-02-01',
        count: 50,
        converted: 10,
      };

      expect(point.count).toBe(50);
    });
  });

  describe('SourceBreakdown', () => {
    it('should create valid source breakdown', () => {
      const breakdown: SourceBreakdown = {
        source: 'website',
        count: 500,
        percentage: 50,
      };

      expect(breakdown.source).toBe('website');
      expect(breakdown.percentage).toBe(50);
    });
  });

  describe('StatusBreakdown', () => {
    it('should create valid status breakdown', () => {
      const breakdown: StatusBreakdown = {
        status: 'negotiating',
        count: 200,
        percentage: 20,
      };

      expect(breakdown.status).toBe('negotiating');
    });
  });

  describe('ConversionFunnelData', () => {
    it('should create valid funnel data', () => {
      const funnel: ConversionFunnelData = {
        stages: [
          {
            name: 'New',
            count: 1000,
            cumulativeCount: 1000,
            percentage: 100,
            conversionRate: 100,
          },
          {
            name: 'Contacted',
            count: 800,
            cumulativeCount: 800,
            percentage: 80,
            conversionRate: 80,
          },
        ],
        totalLeads: 1000,
        overallConversionRate: 15,
        averageConversionDays: 14,
      };

      expect(funnel.stages).toHaveLength(2);
      expect(funnel.averageConversionDays).toBe(14);
    });
  });


  describe('ResponseTimeData', () => {
    it('should create valid response time data', () => {
      const data: ResponseTimeData = {
        period: '< 1 hour',
        count: 100,
        percentage: 40,
        averageHours: 0.5,
      };

      expect(data.period).toBe('< 1 hour');
      expect(data.averageHours).toBe(0.5);
    });
  });

  describe('AcquisitionCostSummary', () => {
    it('should create a valid acquisition cost summary', () => {
      const summary: AcquisitionCostSummary = {
        leadCount: 10,
        costedLeadCount: 8,
        sqlCount: 2,
        wonCount: 1,
        totalCost: 200000,
        costPerSql: 100000,
        costPerWon: 200000,
        bySource: [],
      };

      expect(summary.costPerSql).toBe(100000);
    });
  });
});
