/**
 * Export Hook
 *
 * React hook for downloading the analytics report as CSV, JSON or PDF. Leads are exported from
 * their list (leads.export, recorded in the audit log), not here (#1003)
 */

import type {
  ConversionFunnelData,
  OverviewStats,
  SourceBreakdown,
  StatusBreakdown,
  TrendDataPoint,
} from '@/lib/features/analytics/types/schemas';
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
import { loadPdfFontInBrowser } from '@/lib/features/reports/pdf-font.client';
import { useCallback, useState } from 'react';
import { usePdfReportLabels } from './use-pdf-report-labels';

interface UseExportOptions {
  organizationName?: string;
  locale?: 'en' | 'ja';
}

/**
 * Hook for exporting analytics data
 */
export function useExport(options: UseExportOptions = {}) {
  const [isExporting, setIsExporting] = useState(false);
  const { organizationName = 'Unknown Organization', locale = 'en' } = options;
  const pdfLabels = usePdfReportLabels();

  /**
   * Export full analytics report
   */
  const exportAnalyticsReport = useCallback(
    (data: {
      overview: OverviewStats;
      trend: TrendDataPoint[];
      sourceBreakdown: SourceBreakdown[];
      statusBreakdown: StatusBreakdown[];
      funnel: ConversionFunnelData;
      dateRange: string;
    }) => {
      setIsExporting(true);
      try {
        const csv = generateFullReportCSV({
          ...data,
          organizationName,
          generatedAt: new Date(),
        });
        const blob = createDownloadBlob(csv, 'csv');
        const filename = generateExportFilename('report', 'csv', data.dateRange);
        triggerDownload(blob, filename);
      } finally {
        setIsExporting(false);
      }
    },
    [organizationName]
  );

  /**
   * Export analytics data as JSON
   */
  const exportAnalyticsJSON = useCallback(
    (data: {
      overview: OverviewStats;
      trend: TrendDataPoint[];
      sourceBreakdown: SourceBreakdown[];
      statusBreakdown: StatusBreakdown[];
      funnel: ConversionFunnelData;
      dateRange: string;
    }) => {
      setIsExporting(true);
      try {
        const exportData = {
          ...data,
          organizationName,
          generatedAt: new Date().toISOString(),
        };
        const json = JSON.stringify(exportData, null, 2);
        const blob = createDownloadBlob(json, 'json');
        const filename = generateExportFilename('analytics', 'json', data.dateRange);
        triggerDownload(blob, filename);
      } finally {
        setIsExporting(false);
      }
    },
    [organizationName]
  );

  /**
   * Export analytics report to PDF
   */
  const exportAnalyticsPDF = useCallback(
    async (data: {
      overview: OverviewStats;
      trend?: TrendDataPoint[];
      sourceBreakdown?: SourceBreakdown[];
      statusBreakdown?: StatusBreakdown[];
      funnel?: ConversionFunnelData;
      dateRange: string;
    }) => {
      setIsExporting(true);
      try {
        const font = await loadPdfFontInBrowser();
        const doc = exportAnalyticsToPDF(
          {
            overview: data.overview,
            trend: data.trend,
            sourceBreakdown: data.sourceBreakdown,
            statusBreakdown: data.statusBreakdown,
            funnel: data.funnel,
          },
          {
            organizationName,
            dateRange: data.dateRange,
            generatedAt: new Date(),
            locale,
            font,
            labels: pdfLabels,
          }
        );
        const filename = generatePDFFilename('analytics', data.dateRange);
        downloadPDF(doc, filename);
      } finally {
        setIsExporting(false);
      }
    },
    [organizationName, locale, pdfLabels]
  );

  return {
    isExporting,
    exportAnalyticsReport,
    exportAnalyticsJSON,
    exportAnalyticsPDF,
  };
}
