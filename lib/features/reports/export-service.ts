/**
 * Report Export Service
 *
 * Phase 6.3: CSV/JSON export of the analytics report, and the lead the PDF of leads takes. The
 * CSV of leads is lib/features/leads/export.ts. The text cells of both go through csvCell, so
 * that a text such as the organization's name, which its owner gives, neither runs as a
 * formula nor breaks the row (#996, #1003, #1020); the numbers are written as they are.
 */

import { csvCell } from '@/lib/utils/csv-cell';
import type {
  ConversionFunnelData,
  OverviewStats,
  SourceBreakdown,
  StatusBreakdown,
  TrendDataPoint,
} from '../analytics/types/schemas';

/**
 * Lead data for export
 */
export interface ExportLead {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  phone: string | null;
  position: string | null;
  source: string | null;
  status: string;
  score: number | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Report export options
 */
export interface ExportOptions {
  format: 'csv' | 'json';
  dateRange?: string;
  includeHeaders?: boolean;
}

/**
 * Convert analytics overview to CSV
 */
export function overviewToCSV(overview: OverviewStats, dateRange: string): string {
  const headers = ['Metric', 'Value'];
  const rows = [
    ['Date Range', csvCell(dateRange)],
    ['Total Leads', overview.totalLeads.toString()],
    ['New Leads This Month', overview.newLeadsThisMonth.toString()],
    ['Conversion Rate (%)', overview.conversionRate.toFixed(2)],
    // The MQL level, not the average score, as on the analytics page (#447, #605)
    ['MQL Rate (%)', overview.mqlRate.toFixed(2)],
    ['MQL Interested', overview.mqlLevels.interest.toString()],
    ['MQL Fit', overview.mqlLevels.fit.toString()],
    ['MQL Not a Target', overview.mqlLevels.none.toString()],
    ['MQL No Diagnosis', overview.mqlLevels.unknown.toString()],
    ['New Status', overview.leadsByStatus.new.toString()],
    ['Nurturing Status', overview.leadsByStatus.nurturing.toString()],
    ['Negotiating Status', overview.leadsByStatus.negotiating.toString()],
    ['Won Status', overview.leadsByStatus.won.toString()],
    ['Lost Status', overview.leadsByStatus.lost.toString()],
  ];

  return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
}

/**
 * Convert lead trend to CSV
 */
export function trendToCSV(trend: TrendDataPoint[]): string {
  const headers = ['Date', 'Total Leads', 'Converted Leads'];
  const rows = trend.map((point) => [
    csvCell(point.date),
    point.count.toString(),
    point.converted.toString(),
  ]);

  return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
}

/**
 * Convert source breakdown to CSV
 */
export function sourceBreakdownToCSV(sources: SourceBreakdown[]): string {
  const headers = ['Source', 'Count', 'Percentage (%)'];
  const rows = sources.map((source) => [
    csvCell(source.source),
    source.count.toString(),
    source.percentage.toFixed(2),
  ]);

  return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
}

/**
 * Convert status breakdown to CSV
 */
export function statusBreakdownToCSV(statuses: StatusBreakdown[]): string {
  const headers = ['Status', 'Count', 'Percentage (%)'];
  const rows = statuses.map((status) => [
    csvCell(status.status),
    status.count.toString(),
    status.percentage.toFixed(2),
  ]);

  return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
}

/**
 * Convert conversion funnel to CSV
 */
export function funnelToCSV(funnel: ConversionFunnelData): string {
  const headers = ['Stage', 'Count', 'Cumulative Count', 'Percentage (%)', 'Conversion Rate (%)'];
  const rows = funnel.stages.map((stage) => [
    csvCell(stage.name),
    stage.count.toString(),
    stage.cumulativeCount.toString(),
    stage.percentage.toFixed(2),
    stage.conversionRate.toFixed(2),
  ]);

  // Add summary row
  rows.push(['', '', '', '', '']);
  rows.push(['Overall Conversion Rate', '', '', '', funnel.overallConversionRate.toFixed(2)]);
  // 再育成: beside the stages, not one of them (#802)
  rows.push(['Nurturing Now', funnel.nurturingCount.toString(), '', '', '']);
  rows.push(['Average Conversion Days', '', '', '', funnel.averageConversionDays.toFixed(1)]);

  return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
}

/** A section's title line: text, not a formula, though it starts with = */
const section = (title: string) => csvCell(`=== ${title} ===`);

/**
 * Generate full analytics report CSV
 */
export function generateFullReportCSV(data: {
  overview: OverviewStats;
  trend: TrendDataPoint[];
  sourceBreakdown: SourceBreakdown[];
  statusBreakdown: StatusBreakdown[];
  funnel: ConversionFunnelData;
  dateRange: string;
  organizationName: string;
  generatedAt: Date;
}): string {
  const sections: string[] = [];

  // Header section
  sections.push('DiagnoLeads Analytics Report');
  sections.push(`Organization,${csvCell(data.organizationName)}`);
  sections.push(`Date Range,${csvCell(data.dateRange)}`);
  sections.push(`Generated At,${data.generatedAt.toISOString()}`);
  sections.push('');

  // Overview section
  sections.push(section('Overview Statistics'));
  sections.push(overviewToCSV(data.overview, data.dateRange));
  sections.push('');

  // Source breakdown section
  sections.push(section('Source Breakdown'));
  sections.push(sourceBreakdownToCSV(data.sourceBreakdown));
  sections.push('');

  // Status breakdown section
  sections.push(section('Status Breakdown'));
  sections.push(statusBreakdownToCSV(data.statusBreakdown));
  sections.push('');

  // Funnel section
  sections.push(section('Conversion Funnel'));
  sections.push(funnelToCSV(data.funnel));
  sections.push('');

  // Trend section
  sections.push(section('Lead Trend'));
  sections.push(trendToCSV(data.trend));

  return sections.join('\n');
}

/**
 * Generate filename for export
 */
export function generateExportFilename(
  type: 'leads' | 'analytics' | 'report',
  format: 'csv' | 'json',
  dateRange?: string
): string {
  const timestamp = new Date().toISOString().split('T')[0];
  const rangeStr = dateRange ? `_${dateRange}` : '';
  return `diagnoleads_${type}${rangeStr}_${timestamp}.${format}`;
}

/**
 * Create downloadable blob from content
 */
export function createDownloadBlob(content: string, format: 'csv' | 'json'): Blob {
  const mimeType = format === 'csv' ? 'text/csv;charset=utf-8;' : 'application/json;charset=utf-8;';
  return new Blob([content], { type: mimeType });
}

/**
 * Trigger browser download
 */
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
