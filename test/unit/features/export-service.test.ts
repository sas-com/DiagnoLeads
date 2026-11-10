/**
 * Export Service Tests
 */
import {
  createDownloadBlob,
  funnelToCSV,
  generateExportFilename,
  generateFullReportCSV,
  overviewToCSV,
  sourceBreakdownToCSV,
  statusBreakdownToCSV,
  trendToCSV,
} from '@/lib/features/reports/export-service';
import { readCsv } from '@/test/fixtures/read-csv';
import { describe, expect, it } from 'vitest';

describe('Export Service', () => {
  describe('overviewToCSV', () => {
    const mockOverview = {
      totalLeads: 100,
      newLeadsThisMonth: 25,
      conversionRate: 15.5,
      mqlLevels: { interest: 3, fit: 2, none: 4, unknown: 1 },
      mqlRate: 30,
      leadsByStatus: {
        new: 40,
        nurturing: 30,
        negotiating: 20,
        won: 10,
        lost: 0,
      },
    };

    it('should convert overview to CSV', () => {
      const csv = overviewToCSV(mockOverview, '2024-01');
      expect(csv).toContain('Metric,Value');
      expect(csv).toContain('Total Leads,100');
      expect(csv).toContain('Conversion Rate (%),15.50');
      expect(csv).toContain('New Status,40');
      expect(csv).toContain('Nurturing Status,30');
      expect(csv).toContain('Lost Status,0');
    });

    it('exports the MQL level instead of the average score, as on the page (#605)', () => {
      const csv = overviewToCSV(mockOverview, '2024-01');
      expect(csv).toContain('MQL Rate (%),30.00');
      expect(csv).toContain('MQL Interested,3');
      expect(csv).toContain('MQL Fit,2');
      expect(csv).toContain('MQL Not a Target,4');
      expect(csv).toContain('MQL No Diagnosis,1');
      expect(csv).not.toContain('Average Score');
    });
  });

  describe('trendToCSV', () => {
    const mockTrend = [
      { date: '2024-01-01', count: 10, converted: 2 },
      { date: '2024-01-02', count: 15, converted: 3 },
    ];

    it('should convert trend data to CSV', () => {
      const csv = trendToCSV(mockTrend);
      expect(csv).toContain('Date,Total Leads,Converted Leads');
      expect(csv).toContain('2024-01-01,10,2');
      expect(csv).toContain('2024-01-02,15,3');
    });

    it('should handle empty trend array', () => {
      const csv = trendToCSV([]);
      expect(csv).toContain('Date,Total Leads,Converted Leads');
    });
  });

  describe('sourceBreakdownToCSV', () => {
    const mockSources = [
      { source: 'website', count: 50, percentage: 50 },
      { source: 'api', count: 30, percentage: 30 },
    ];

    it('should convert source breakdown to CSV', () => {
      const csv = sourceBreakdownToCSV(mockSources);
      expect(csv).toContain('Source,Count,Percentage (%)');
      expect(csv).toContain('website,50,50.00');
      expect(csv).toContain('api,30,30.00');
    });

    it('writes a source as a text cell, kept from running as a formula (#1020)', () => {
      expect(sourceBreakdownToCSV([{ source: '=1+1', count: 1, percentage: 100 }])).toContain(
        "'=1+1,1,100.00"
      );
    });
  });

  describe('statusBreakdownToCSV', () => {
    const mockStatuses = [
      { status: 'new', count: 40, percentage: 40 },
      { status: 'won', count: 10, percentage: 10 },
    ];

    it('should convert status breakdown to CSV', () => {
      const csv = statusBreakdownToCSV(mockStatuses);
      expect(csv).toContain('Status,Count,Percentage (%)');
      expect(csv).toContain('new,40,40.00');
      expect(csv).toContain('won,10,10.00');
    });
  });

  describe('funnelToCSV', () => {
    const mockFunnel = {
      stages: [
        { name: 'lead' as const, count: 100, cumulativeCount: 100, percentage: 100, conversionRate: 100 },
        { name: 'mql' as const, count: 60, cumulativeCount: 60, percentage: 60, conversionRate: 60 },
      ],
      totalLeads: 100,
      overallConversionRate: 10, nurturingCount: 0,
      averageConversionDays: 14.5,
    };

    it('should convert funnel data to CSV', () => {
      const csv = funnelToCSV(mockFunnel);
      expect(csv).toContain('Stage,Count,Cumulative Count,Percentage (%),Conversion Rate (%)');
      expect(csv).toContain('lead,100,100,100.00,100.00');
      expect(csv).toContain('Overall Conversion Rate');
      expect(csv).toContain('Average Conversion Days');
      // 再育成 beside the stages (#802)
      expect(csv).toContain('Nurturing Now,0');
    });
  });

  describe('generateFullReportCSV', () => {
    const mockData = {
      overview: {
        totalLeads: 100,
        newLeadsThisMonth: 25,
        conversionRate: 15.5,
        mqlLevels: { interest: 3, fit: 2, none: 4, unknown: 1 },
        mqlRate: 30,
        leadsByStatus: {
          new: 40,
          nurturing: 30,
          negotiating: 20,
          won: 10,
          lost: 0,
        },
      },
      trend: [{ date: '2024-01-01', count: 10, converted: 2 }],
      sourceBreakdown: [{ source: 'website', count: 50, percentage: 50 }],
      statusBreakdown: [{ status: 'new', count: 40, percentage: 40 }],
      funnel: {
        stages: [
          { name: 'lead' as const, count: 100, cumulativeCount: 100, percentage: 100, conversionRate: 100 },
        ],
        totalLeads: 100,
        overallConversionRate: 10, nurturingCount: 0,
        averageConversionDays: 14.5,
      },
      dateRange: '2024-01',
      organizationName: 'Test Org',
      generatedAt: new Date('2024-01-15T10:00:00Z'),
    };

    it('should generate full report CSV', () => {
      const csv = generateFullReportCSV(mockData);
      expect(csv).toContain('DiagnoLeads Analytics Report');
      expect(csv).toContain('Test Org');
      expect(csv).toContain('=== Overview Statistics ===');
      expect(csv).toContain('=== Source Breakdown ===');
      expect(csv).toContain('=== Status Breakdown ===');
      expect(csv).toContain('=== Conversion Funnel ===');
      expect(csv).toContain('=== Lead Trend ===');
    });

    it("keeps the organization's name from running as a formula or breaking the row (#1020)", () => {
      const formula = generateFullReportCSV({
        ...mockData,
        organizationName: '=HYPERLINK("https://example.com","架空商事")',
      });
      expect(formula.split('\n')).toContain(
        `Organization,"'=HYPERLINK(""https://example.com"",""架空商事"")"`
      );
      const comma = generateFullReportCSV({ ...mockData, organizationName: '架空, 商事' });
      expect(comma.split('\n')).toContain('Organization,"架空, 商事"');
    });

    it('keeps every text cell from running as a formula or breaking its row (#1020)', () => {
      // Quotes, line breaks and a formula: the old escapeCSV left a CR and the formulas as they were
      const evil = '=1+1"\r\n=2+2';
      const rows = readCsv(
        generateFullReportCSV({
          ...mockData,
          organizationName: evil,
          dateRange: evil,
          trend: [{ date: evil, count: 1, converted: 0 }],
          sourceBreakdown: [{ source: evil, count: 1, percentage: 100 }],
          statusBreakdown: [{ status: evil, count: 1, percentage: 100 }],
        })
      );
      expect(rows.find((row) => row[0] === 'Organization')).toEqual(['Organization', `'${evil}`]);
      expect(rows.find((row) => row[0] === 'Date Range')).toEqual(['Date Range', `'${evil}`]);
      expect(rows.flat().some((cell) => /^[=+\-@\t\r]/.test(cell))).toBe(false);
    });

    it('writes the section titles as text and the numbers as they are (#1020)', () => {
      const lines = generateFullReportCSV(mockData).split('\n');
      expect(lines).toContain("'=== Overview Statistics ===");
      expect(lines).toContain("'=== Lead Trend ===");
      expect(lines).toContain('Average Conversion Days,,,,14.5');
      expect(lines).toContain('Conversion Rate (%),15.50');
    });
  });

  describe('generateExportFilename', () => {
    it('should generate leads filename', () => {
      const filename = generateExportFilename('leads', 'csv');
      expect(filename).toMatch(/^diagnoleads_leads_\d{4}-\d{2}-\d{2}\.csv$/);
    });

    it('should generate analytics filename', () => {
      const filename = generateExportFilename('analytics', 'json');
      expect(filename).toMatch(/^diagnoleads_analytics_\d{4}-\d{2}-\d{2}\.json$/);
    });

    it('should include date range in filename', () => {
      const filename = generateExportFilename('report', 'csv', '2024-01');
      expect(filename).toContain('2024-01');
    });
  });

  describe('createDownloadBlob', () => {
    it('should create CSV blob', () => {
      const blob = createDownloadBlob('test,data', 'csv');
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('text/csv;charset=utf-8;');
    });

    it('should create JSON blob', () => {
      const blob = createDownloadBlob('{"test":"data"}', 'json');
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('application/json;charset=utf-8;');
    });

    /** The bytes of a blob (jsdom's Blob has no arrayBuffer) */
    const bytesOf = (blob: Blob) =>
      new Promise<Uint8Array>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(blob);
      });

    it('starts a CSV with a BOM, so that Excel reads its Japanese as UTF-8 (#1034)', async () => {
      const bytes = await bytesOf(createDownloadBlob('流入元,件数', 'csv'));
      expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      expect(new TextDecoder().decode(bytes.slice(3))).toBe('流入元,件数');
    });

    it('writes one BOM only before a CSV that has one already (#1034)', async () => {
      const bytes = await bytesOf(createDownloadBlob('\uFEFFa,b', 'csv'));
      expect([...bytes.slice(0, 4)]).toEqual([0xef, 0xbb, 0xbf, 'a'.charCodeAt(0)]);
    });

    it('writes no BOM before JSON (#1034)', async () => {
      const bytes = await bytesOf(createDownloadBlob('{"test":"data"}', 'json'));
      expect(new TextDecoder().decode(bytes)).toBe('{"test":"data"}');
      expect(bytes[0]).toBe('{'.charCodeAt(0));
    });
  });
});
