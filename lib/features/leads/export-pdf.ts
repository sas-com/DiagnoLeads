/**
 * PDF of the lead export (#173), made on the server with the report layout of
 * lib/features/reports/pdf-export-service.ts. Returned as base64 for the tRPC response.
 */
import { exportLeadsToPDF } from '@/lib/features/reports/pdf-export-service';
import type { LeadExportRow } from './export';

export function leadExportPdfBase64(
  rows: LeadExportRow[],
  options: { generatedAt: Date; locale: 'ja' | 'en' }
): string {
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
    options
  );
  return Buffer.from(doc.output('arraybuffer')).toString('base64');
}
