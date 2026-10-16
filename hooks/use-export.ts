/**
 * Export Hook
 *
 * React hook for downloading analytics reports and lead exports
 * Supports CSV, JSON, and PDF formats
 */

import type {
  ConversionFunnelData,
  OverviewStats,
  SourceBreakdown,
  StatusBreakdown,
  TrendDataPoint,
} from '@/lib/features/analytics/types/schemas';
import {
  type ExportLead,
  createDownloadBlob,
  generateExportFilename,
  generateFullReportCSV,
  leadsToCSV,
  triggerDownload,
} from '@/lib/features/reports/export-service';
import {
  downloadPDF,
  exportAnalyticsToPDF,
  exportLeadsToPDF,
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
 * Hook for exporting leads and analytics data
 */
export function useExport(options: UseExportOptions = {}) {
  const [isExporting, setIsExporting] = useState(false);
  const { organizationName = 'Unknown Organization', locale = 'en' } = options;
  const pdfLabels = usePdfReportLabels();

  /**
   * Export leads to CSV
   */
  const exportLeadsCSV = useCallback((leads: ExportLead[]) => {
    setIsExporting(true);
    try {
      const csv = leadsToCSV(leads);
      const blob = createDownloadBlob(csv, 'csv');
      const filename = generateExportFilename('leads', 'csv');
      triggerDownload(blob, filename);
    } finally {
      setIsExporting(false);
    }
  }, []);

  /**
   * Export leads to JSON
   */
  const exportLeadsJSON = useCallback((leads: ExportLead[]) => {
    setIsExporting(true);
    try {
      const json = JSON.stringify(leads, null, 2);
      const blob = createDownloadBlob(json, 'json');
      const filename = generateExportFilename('leads', 'json');
      triggerDownload(blob, filename);
    } finally {
      setIsExporting(false);
    }
  }, []);

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
   * Export leads to PDF
   */
  const exportLeadsPDF = useCallback(
    async (leads: ExportLead[], dateRange?: string) => {
      setIsExporting(true);
      try {
        const doc = exportLeadsToPDF(leads, {
          organizationName,
          dateRange,
          generatedAt: new Date(),
          locale,
          font: await loadPdfFontInBrowser(),
          labels: pdfLabels,
        });
        const filename = generatePDFFilename('leads', dateRange);
        downloadPDF(doc, filename);
      } finally {
        setIsExporting(false);
      }
    },
    [organizationName, locale, pdfLabels]
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
    exportLeadsCSV,
    exportLeadsJSON,
    exportLeadsPDF,
    exportAnalyticsReport,
    exportAnalyticsJSON,
    exportAnalyticsPDF,
  };
}
