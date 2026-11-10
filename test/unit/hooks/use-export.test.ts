import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Mock export services
vi.mock('@/lib/features/reports/export-service', () => ({
  createDownloadBlob: vi.fn(() => new Blob(['test'])),
  generateExportFilename: vi.fn(() => 'test-file.csv'),
  generateFullReportCSV: vi.fn(() => 'full-report-csv'),
  triggerDownload: vi.fn(),
}));

vi.mock('@/lib/features/reports/pdf-export-service', () => ({
  exportAnalyticsToPDF: vi.fn(() => ({ save: vi.fn() })),
  generatePDFFilename: vi.fn(() => 'test-file.pdf'),
  downloadPDF: vi.fn(),
}));

// The Japanese font the PDF exports fetch first (#189)
const pdfFont = { binary: '\x00\x01\x00\x00' };
vi.mock('@/lib/features/reports/pdf-font.client', () => ({
  loadPdfFontInBrowser: vi.fn(async () => pdfFont),
}));

// The PDF texts in the screen's language (#189)
const pdfLabels = { text: vi.fn(), status: vi.fn(), source: vi.fn() };
vi.mock('@/hooks/use-pdf-report-labels', () => ({
  usePdfReportLabels: () => pdfLabels,
}));

// Import after mocks
import { useExport } from '@/hooks/use-export';
import {
  createDownloadBlob,
  generateExportFilename,
  generateFullReportCSV,
  triggerDownload,
} from '@/lib/features/reports/export-service';
import {
  downloadPDF,
  exportAnalyticsToPDF,
  generatePDFFilename,
} from '@/lib/features/reports/pdf-export-service';

const mockAnalyticsData: Parameters<ReturnType<typeof useExport>['exportAnalyticsReport']>[0] = {
  overview: {
    totalLeads: 100,
    newLeadsThisMonth: 10,
    leadsByStatus: { new: 30, nurturing: 40, negotiating: 20, won: 5, lost: 5 },
    mqlLevels: { interest: 3, fit: 2, none: 4, unknown: 1 },
    mqlRate: 30,
    conversionRate: 5,
  },
  trend: [{ date: '2024-01-01', count: 5, converted: 1 }],
  sourceBreakdown: [{ source: 'web', count: 50, percentage: 50 }],
  statusBreakdown: [{ status: 'new', count: 30, percentage: 30 }],
  funnel: { stages: [], totalLeads: 100, overallConversionRate: 5, nurturingCount: 0, averageConversionDays: 0 },
  dateRange: '30d',
};

describe('useExport', () => {
  it('should return export methods', () => {
    const { result } = renderHook(() => useExport());

    expect(result.current).toBeDefined();
    expect(result.current.isExporting).toBe(false);
    expect(typeof result.current.exportAnalyticsReport).toBe('function');
    expect(typeof result.current.exportAnalyticsJSON).toBe('function');
    expect(typeof result.current.exportAnalyticsPDF).toBe('function');
  });

  it('exports the analytics only: leads are exported from their list, with the audit log (#1003)', () => {
    const { result } = renderHook(() => useExport());

    expect(Object.keys(result.current).sort()).toEqual([
      'exportAnalyticsJSON',
      'exportAnalyticsPDF',
      'exportAnalyticsReport',
      'isExporting',
    ]);
  });

  it('should accept options', () => {
    const { result } = renderHook(() =>
      useExport({
        organizationName: 'Test Org',
        locale: 'ja',
      })
    );

    expect(result.current).toBeDefined();
  });

  describe('exportAnalyticsReport', () => {
    it('should export analytics report to CSV', () => {
      const { result } = renderHook(() => useExport({ organizationName: 'Test Org' }));

      act(() => {
        result.current.exportAnalyticsReport(mockAnalyticsData);
      });

      expect(generateFullReportCSV).toHaveBeenCalled();
      expect(createDownloadBlob).toHaveBeenCalled();
      expect(triggerDownload).toHaveBeenCalled();
    });
  });

  describe('exportAnalyticsJSON', () => {
    it('should export analytics to JSON', () => {
      const { result } = renderHook(() => useExport({ organizationName: 'Test Org' }));

      act(() => {
        result.current.exportAnalyticsJSON(mockAnalyticsData);
      });

      expect(createDownloadBlob).toHaveBeenCalled();
      expect(generateExportFilename).toHaveBeenCalledWith('analytics', 'json', '30d');
      expect(triggerDownload).toHaveBeenCalled();
    });
  });

  describe('exportAnalyticsPDF', () => {
    it('should export analytics to PDF', async () => {
      const { result } = renderHook(() => useExport({ organizationName: 'Test Org', locale: 'ja' }));

      await act(async () => {
        await result.current.exportAnalyticsPDF(mockAnalyticsData);
      });

      expect(exportAnalyticsToPDF).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ font: pdfFont, labels: pdfLabels, locale: 'ja' })
      );
      expect(generatePDFFilename).toHaveBeenCalledWith('analytics', '30d');
      expect(downloadPDF).toHaveBeenCalled();
    });
  });
});
