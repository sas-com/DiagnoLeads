/**
 * PDF of the lead export (#173), made on the server with the report layout of
 * lib/features/reports/pdf-export-service.ts. Returned as base64 for the tRPC response.
 * Texts follow the user's language; when the Japanese font could not be loaded the labels are
 * English so the PDF stays readable (#189).
 */
import { exportLeadsToPDF } from '@/lib/features/reports/pdf-export-service';
import { loadPdfFontOnServer } from '@/lib/features/reports/pdf-font.server';
import { pdfReportLabelsFor } from '@/lib/features/reports/pdf-labels.messages';
import type { LeadExportRow } from './export';

export function leadExportPdfBase64(
  rows: LeadExportRow[],
  options: { generatedAt: Date; locale: 'ja' | 'en' }
): string {
  const font = loadPdfFontOnServer();
  const doc = exportLeadsToPDF(
    rows.map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      company: row.company,
      phone: row.phone,
      position: null,
      source: row.source,
      status: row.status,
      score: row.score,
      notes: null,
      createdAt: row.createdAt,
      updatedAt: row.createdAt,
    })),
    { ...options, font, labels: pdfReportLabelsFor(font ? options.locale : 'en') }
  );
  return Buffer.from(doc.output('arraybuffer')).toString('base64');
}
