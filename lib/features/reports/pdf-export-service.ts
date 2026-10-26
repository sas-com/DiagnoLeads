/**
 * PDF Export Service
 *
 * Phase 9: PDF export functionality for analytics and leads
 * Uses jsPDF and jspdf-autotable for professional PDF generation
 *
 * Japanese text needs options.font (./pdf-font.ts, #189): loadPdfFontOnServer() on the server,
 * await loadPdfFontInBrowser() in the browser. Without it jsPDF's built-in font is used.
 * Texts come from options.labels (./pdf-labels.ts); Japanese when not given.
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type {
  ConversionFunnelData,
  FunnelStageName,
  OverviewStats,
  SourceBreakdown,
  StatusBreakdown,
  TrendDataPoint,
} from '../analytics/types/schemas';
import type { ExportLead } from './export-service';
import { PDF_FONT_FAMILY, type PdfFont, registerPdfFont } from './pdf-font';
import {
  DEFAULT_PDF_REPORT_LABELS,
  type PdfReportLabels,
  type PdfReportTextKey,
} from './pdf-labels';

/** Labels of the funnel stages (#802) */
const FUNNEL_STAGE_LABELS: Record<FunnelStageName, PdfReportTextKey> = {
  lead: 'analytics.stageLead',
  mql: 'analytics.stageMql',
  deal: 'analytics.stageDeal',
  sql: 'analytics.stageSql',
  won: 'analytics.stageWon',
};

/**
 * PDF export options
 */
export interface PDFExportOptions {
  title?: string;
  organizationName?: string;
  dateRange?: string;
  generatedAt?: Date;
  locale?: 'en' | 'ja';
  /** Embedded font for Japanese text (#189) */
  font?: PdfFont | null;
  /** Report texts in the user's language (#189); Japanese when not given */
  labels?: PdfReportLabels;
}

function labelsOf(options: PDFExportOptions): PdfReportLabels {
  return options.labels ?? DEFAULT_PDF_REPORT_LABELS;
}

/** Dates in the reports are shown in Japan time */
const REPORT_TIME_ZONE = 'Asia/Tokyo';

function intlLocale(options: PDFExportOptions): string {
  return options.locale === 'en' ? 'en-US' : 'ja-JP';
}

/**
 * New document: compressed streams, and the Japanese font as the current font when given.
 * autoTable takes the document's current font as its default.
 */
function createDocument(orientation: 'portrait' | 'landscape', options: PDFExportOptions): jsPDF {
  const doc = new jsPDF({ orientation, compress: true });
  if (options.font) registerPdfFont(doc, options.font);
  return doc;
}

/**
 * Font and style for table headings. The embedded font has one weight, so headings stay
 * 'normal' with it (asking jsPDF for a bold style it does not have would drop the font).
 */
function headingStyles(options: PDFExportOptions): { font?: string; fontStyle: 'normal' | 'bold' } {
  return options.font ? { font: PDF_FONT_FAMILY, fontStyle: 'normal' } : { fontStyle: 'bold' };
}

/** Font for table cells (the embedded one when given) */
function bodyFont(options: PDFExportOptions): { font?: string } {
  return options.font ? { font: PDF_FONT_FAMILY } : {};
}

/**
 * Color scheme for PDF
 */
const colors = {
  primary: [59, 130, 246] as [number, number, number], // Blue
  secondary: [107, 114, 128] as [number, number, number], // Gray
  success: [34, 197, 94] as [number, number, number], // Green
  warning: [234, 179, 8] as [number, number, number], // Yellow
  danger: [239, 68, 68] as [number, number, number], // Red
  text: [31, 41, 55] as [number, number, number], // Dark gray
  lightGray: [243, 244, 246] as [number, number, number],
};

/**
 * Add header to PDF
 */
function addHeader(doc: jsPDF, options: PDFExportOptions): number {
  const labels = labelsOf(options);
  const pageWidth = doc.internal.pageSize.getWidth();
  let yPos = 20;

  // Title
  doc.setFontSize(24);
  doc.setTextColor(...colors.primary);
  doc.text(options.title || 'DiagnoLeads', pageWidth / 2, yPos, { align: 'center' });
  yPos += 12;

  // Organization name
  if (options.organizationName) {
    doc.setFontSize(14);
    doc.setTextColor(...colors.text);
    doc.text(options.organizationName, pageWidth / 2, yPos, { align: 'center' });
    yPos += 8;
  }

  // Date range and generation time
  doc.setFontSize(10);
  doc.setTextColor(...colors.secondary);
  const dateInfo = [
    options.dateRange ? labels.text('period', { range: options.dateRange }) : '',
    labels.text('generatedAt', {
      date: (options.generatedAt || new Date()).toLocaleString(intlLocale(options), {
        timeZone: REPORT_TIME_ZONE,
      }),
    }),
  ]
    .filter(Boolean)
    .join(' | ');
  doc.text(dateInfo, pageWidth / 2, yPos, { align: 'center' });
  yPos += 15;

  // Horizontal line
  doc.setDrawColor(...colors.primary);
  doc.setLineWidth(0.5);
  doc.line(20, yPos, pageWidth - 20, yPos);

  return yPos + 10;
}

/**
 * Add section title
 */
function addSectionTitle(doc: jsPDF, title: string, yPos: number): number {
  doc.setFontSize(14);
  doc.setTextColor(...colors.primary);
  doc.text(title, 20, yPos);
  return yPos + 8;
}

/**
 * Add KPI cards row
 */
function addKPICards(
  doc: jsPDF,
  kpis: { label: string; value: string | number; color?: [number, number, number] }[],
  yPos: number
): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const cardWidth = (pageWidth - 50) / kpis.length;
  const cardHeight = 25;

  kpis.forEach((kpi, index) => {
    const x = 20 + index * (cardWidth + 5);

    // Card background
    doc.setFillColor(...colors.lightGray);
    doc.roundedRect(x, yPos, cardWidth, cardHeight, 3, 3, 'F');

    // Value
    doc.setFontSize(16);
    doc.setTextColor(...(kpi.color || colors.text));
    doc.text(String(kpi.value), x + cardWidth / 2, yPos + 10, { align: 'center' });

    // Label
    doc.setFontSize(9);
    doc.setTextColor(...colors.secondary);
    doc.text(kpi.label, x + cardWidth / 2, yPos + 19, { align: 'center' });
  });

  return yPos + cardHeight + 10;
}

/**
 * Export leads to PDF
 */
export function exportLeadsToPDF(leads: ExportLead[], options: PDFExportOptions = {}): jsPDF {
  const doc = createDocument('landscape', options);
  const labels = labelsOf(options);
  let yPos = addHeader(doc, { title: labels.text('title.leads'), ...options });

  // Summary KPIs
  const totalLeads = leads.length;
  const newLeads = leads.filter((l) => l.status === 'new').length;
  const convertedLeads = leads.filter((l) => l.status === 'won').length;
  const avgScore = leads.reduce((sum, l) => sum + (l.score || 0), 0) / totalLeads || 0;

  yPos = addSectionTitle(doc, labels.text('leads.summary'), yPos);
  yPos = addKPICards(
    doc,
    [
      { label: labels.text('leads.total'), value: totalLeads, color: colors.primary },
      { label: labels.text('leads.new'), value: newLeads, color: colors.success },
      { label: labels.text('leads.won'), value: convertedLeads, color: colors.primary },
      {
        label: labels.text('leads.averageScore'),
        value: avgScore.toFixed(1),
        color: colors.warning,
      },
    ],
    yPos
  );

  // Leads table
  yPos = addSectionTitle(doc, labels.text('leads.details'), yPos);

  // One formatter for every row (creating one per row is slow for thousands of leads)
  const dateFormat = new Intl.DateTimeFormat(intlLocale(options), {
    timeZone: REPORT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const tableData = leads.map((lead) => [
    lead.email,
    lead.name || '-',
    lead.company || '-',
    labels.status(lead.status),
    lead.score?.toString() || '-',
    lead.source ? labels.source(lead.source) : '-',
    dateFormat.format(new Date(lead.createdAt)),
  ]);

  autoTable(doc, {
    startY: yPos,
    head: [
      (['email', 'name', 'company', 'status', 'score', 'source', 'createdAt'] as const).map(
        (column) => labels.text(`columns.${column}`)
      ),
    ],
    body: tableData,
    theme: 'striped',
    // The column headings repeat on every page; rows are not split across pages
    showHead: 'everyPage',
    rowPageBreak: 'avoid',
    // Lined up with the header rule; room for the page footer
    margin: { left: 20, right: 20, bottom: 18 },
    headStyles: {
      fillColor: colors.primary,
      textColor: [255, 255, 255],
      ...headingStyles(options),
    },
    alternateRowStyles: {
      fillColor: colors.lightGray,
    },
    styles: {
      ...bodyFont(options),
      fontSize: 9,
      cellPadding: { top: 1.6, bottom: 1.6, left: 2, right: 2 },
      // Long names and companies wrap inside the cell (character by character for Japanese)
      overflow: 'linebreak',
      valign: 'middle',
    },
    // Company takes the remaining width (about 74 mm on landscape A4); Status fits ナーチャリング
    columnStyles: {
      0: { cellWidth: 52 },
      1: { cellWidth: 38 },
      3: { cellWidth: 26 },
      4: { cellWidth: 14, halign: 'center' },
      5: { cellWidth: 30 },
      6: { cellWidth: 24, halign: 'center' },
    },
  });

  // Footer
  addFooter(doc, options);

  return doc;
}

/**
 * Export analytics report to PDF
 */
export function exportAnalyticsToPDF(
  data: {
    overview: OverviewStats;
    trend?: TrendDataPoint[];
    sourceBreakdown?: SourceBreakdown[];
    statusBreakdown?: StatusBreakdown[];
    funnel?: ConversionFunnelData;
  },
  options: PDFExportOptions = {}
): jsPDF {
  const doc = createDocument('portrait', options);
  const labels = labelsOf(options);
  let yPos = addHeader(doc, { title: labels.text('title.analytics'), ...options });

  // Overview KPIs
  yPos = addSectionTitle(doc, labels.text('analytics.overview'), yPos);
  yPos = addKPICards(
    doc,
    [
      {
        label: labels.text('analytics.totalLeads'),
        value: data.overview.totalLeads,
        color: colors.primary,
      },
      {
        label: labels.text('analytics.newThisMonth'),
        value: data.overview.newLeadsThisMonth,
        color: colors.success,
      },
      {
        label: labels.text('analytics.conversionRate'),
        value: `${data.overview.conversionRate.toFixed(1)}%`,
        color: colors.primary,
      },
      {
        label: labels.text('analytics.mqlRate'),
        value: `${data.overview.mqlRate.toFixed(1)}%`,
        color: colors.warning,
      },
    ],
    yPos
  );

  // Status breakdown table
  if (data.statusBreakdown && data.statusBreakdown.length > 0) {
    yPos = addSectionTitle(doc, labels.text('analytics.statusDistribution'), yPos);

    autoTable(doc, {
      startY: yPos,
      head: [
        [
          labels.text('analytics.status'),
          labels.text('analytics.count'),
          labels.text('analytics.percentage'),
        ],
      ],
      body: data.statusBreakdown.map((s) => [
        labels.status(s.status),
        s.count,
        `${s.percentage.toFixed(1)}%`,
      ]),
      theme: 'striped',
      headStyles: {
        fillColor: colors.primary,
        textColor: [255, 255, 255],
        ...headingStyles(options),
      },
      styles: { ...bodyFont(options), fontSize: 10 },
      columnStyles: {
        1: { halign: 'right' },
        2: { halign: 'right' },
      },
    });

    yPos =
      (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? yPos + 50;
    yPos += 10;
  }

  // Source breakdown table
  if (data.sourceBreakdown && data.sourceBreakdown.length > 0) {
    yPos = addSectionTitle(doc, labels.text('analytics.sourceDistribution'), yPos);

    autoTable(doc, {
      startY: yPos,
      head: [
        [
          labels.text('analytics.source'),
          labels.text('analytics.count'),
          labels.text('analytics.percentage'),
        ],
      ],
      body: data.sourceBreakdown.map((s) => [
        labels.source(s.source),
        s.count,
        `${s.percentage.toFixed(1)}%`,
      ]),
      theme: 'striped',
      headStyles: {
        fillColor: colors.primary,
        textColor: [255, 255, 255],
        ...headingStyles(options),
      },
      styles: { ...bodyFont(options), fontSize: 10 },
      columnStyles: {
        1: { halign: 'right' },
        2: { halign: 'right' },
      },
    });

    yPos =
      (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? yPos + 50;
    yPos += 10;
  }

  // Conversion funnel
  if (data.funnel) {
    // Check if we need a new page
    if (yPos > 220) {
      doc.addPage();
      yPos = 20;
    }

    yPos = addSectionTitle(doc, labels.text('analytics.funnel'), yPos);

    autoTable(doc, {
      startY: yPos,
      head: [
        (['stage', 'count', 'cumulative', 'percentage', 'stageConversionRate'] as const).map(
          (column) => labels.text(`analytics.${column}`)
        ),
      ],
      body: data.funnel.stages.map((s) => [
        labels.text(FUNNEL_STAGE_LABELS[s.name]),
        s.count,
        s.cumulativeCount,
        `${s.percentage.toFixed(1)}%`,
        `${s.conversionRate.toFixed(1)}%`,
      ]),
      theme: 'striped',
      headStyles: {
        fillColor: colors.primary,
        textColor: [255, 255, 255],
        ...headingStyles(options),
      },
      styles: { ...bodyFont(options), fontSize: 10 },
      columnStyles: {
        1: { halign: 'right' },
        2: { halign: 'right' },
        3: { halign: 'right' },
        4: { halign: 'right' },
      },
    });

    yPos =
      (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? yPos + 50;
    yPos += 10;

    // Funnel summary
    doc.setFontSize(11);
    doc.setTextColor(...colors.text);
    doc.text(
      labels.text('analytics.overallConversionRate', {
        rate: data.funnel.overallConversionRate.toFixed(1),
      }),
      20,
      yPos
    );
    yPos += 6;
    doc.text(
      labels.text('analytics.averageConversionDays', {
        days: data.funnel.averageConversionDays.toFixed(1),
      }),
      20,
      yPos
    );
  }

  // Footer
  addFooter(doc, options);

  return doc;
}

/**
 * Export diagnostic result to PDF
 */
export function exportDiagnosticResultToPDF(
  result: {
    score: number;
    company: string;
    name: string;
    email: string;
    industry: string;
    employeeCount: string;
    timeline: string;
    budget: string;
    challenge: string;
    goal: string;
    submittedAt: Date;
  },
  options: PDFExportOptions = {}
): jsPDF {
  const doc = createDocument('portrait', options);
  const labels = labelsOf(options);
  let yPos = addHeader(doc, { title: labels.text('title.diagnostic'), ...options });

  // Score display
  const scoreColor =
    result.score >= 70 ? colors.success : result.score >= 40 ? colors.warning : colors.danger;

  doc.setFillColor(...colors.lightGray);
  doc.roundedRect(60, yPos, 90, 50, 5, 5, 'F');

  doc.setFontSize(48);
  doc.setTextColor(...scoreColor);
  doc.text(result.score.toString(), 105, yPos + 32, { align: 'center' });

  doc.setFontSize(12);
  doc.setTextColor(...colors.secondary);
  doc.text(labels.text('diagnostic.leadScore'), 105, yPos + 45, { align: 'center' });

  yPos += 65;

  // Contact information
  yPos = addSectionTitle(doc, labels.text('diagnostic.contact'), yPos);

  const contactInfo = [
    [labels.text('diagnostic.name'), result.name],
    [labels.text('diagnostic.email'), result.email],
    [labels.text('diagnostic.company'), result.company],
  ];

  autoTable(doc, {
    startY: yPos,
    body: contactInfo,
    theme: 'plain',
    styles: { ...bodyFont(options), fontSize: 11 },
    columnStyles: {
      0: { ...headingStyles(options), cellWidth: 50 },
    },
  });

  yPos = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? yPos + 30;
  yPos += 10;

  // Business profile
  yPos = addSectionTitle(doc, labels.text('diagnostic.business'), yPos);

  const businessInfo = [
    [labels.text('diagnostic.industry'), result.industry],
    [labels.text('diagnostic.companySize'), result.employeeCount],
    [labels.text('diagnostic.timeline'), result.timeline],
    [labels.text('diagnostic.budget'), result.budget],
    [labels.text('diagnostic.challenge'), result.challenge],
    [labels.text('diagnostic.goal'), result.goal],
  ];

  autoTable(doc, {
    startY: yPos,
    body: businessInfo,
    theme: 'plain',
    styles: { ...bodyFont(options), fontSize: 11 },
    columnStyles: {
      0: { ...headingStyles(options), cellWidth: 50 },
    },
  });

  yPos = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? yPos + 50;
  yPos += 10;

  // Submission info
  doc.setFontSize(10);
  doc.setTextColor(...colors.secondary);
  doc.text(
    labels.text('diagnostic.submittedAt', {
      date: result.submittedAt.toLocaleString(intlLocale(options), { timeZone: REPORT_TIME_ZONE }),
    }),
    20,
    yPos
  );

  // Footer
  addFooter(doc, options);

  return doc;
}

/**
 * Add footer to PDF
 */
function addFooter(doc: jsPDF, options: PDFExportOptions): void {
  const labels = labelsOf(options);
  const pageCount = doc.getNumberOfPages();
  // Japan date (YYYY-MM-DD) of the generation time
  const generatedOn = new Intl.DateTimeFormat('sv-SE', { timeZone: REPORT_TIME_ZONE }).format(
    options.generatedAt ?? new Date()
  );
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(9);
    doc.setTextColor(...colors.secondary);

    // Page number
    doc.text(labels.text('page', { page: i, total: pageCount }), pageWidth / 2, pageHeight - 10, {
      align: 'center',
    });

    // Branding
    doc.text(labels.text('footerBrand'), 20, pageHeight - 10);

    // Timestamp
    doc.text(generatedOn, pageWidth - 20, pageHeight - 10, {
      align: 'right',
    });
  }
}

/**
 * Download PDF
 */
export function downloadPDF(doc: jsPDF, filename: string): void {
  doc.save(filename);
}

/**
 * Generate filename for PDF export
 */
export function generatePDFFilename(
  type: 'leads' | 'analytics' | 'diagnostic',
  dateRange?: string
): string {
  const timestamp = new Date().toISOString().split('T')[0];
  const rangeStr = dateRange ? `_${dateRange.replace(/\s/g, '-')}` : '';
  return `diagnoleads_${type}${rangeStr}_${timestamp}.pdf`;
}
