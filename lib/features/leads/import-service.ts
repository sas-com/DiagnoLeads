/**
 * Lead Import Service
 *
 * Handles CSV/Excel import for bulk lead creation
 */
import * as XLSX from 'xlsx';
import { z } from 'zod';
import { leadStatusEnum, normalizeLeadStatus } from './types/pipeline';
import { LEAD_BULK_CREATE_MAX, leadTextSchema } from './types/schemas';

/**
 * Imported lead row schema. The text limits are those of leads.bulkCreate (#575): a row over
 * them is shown as an error and left out, instead of the server refusing every row.
 */
const importLeadRowSchema = z.object({
  email: leadTextSchema('email').email('Invalid email format'),
  name: leadTextSchema('name').optional(),
  company: leadTextSchema('company').optional(),
  phone: leadTextSchema('phone').optional(),
  status: z.preprocess(normalizeLeadStatus, leadStatusEnum).default('new'),
  source: z.enum(['website', 'embed', 'api']).optional(),
  score: z.coerce.number().int().min(0).max(100).optional(),
});

export type ImportLeadRow = z.infer<typeof importLeadRowSchema>;

/**
 * Import result for a single row
 */
export interface ImportRowResult {
  row: number;
  success: boolean;
  data?: ImportLeadRow;
  /** Why the row is left out, starting with the file's column it is about */
  error?: string;
  /**
   * A value over its length limit (#575): the file's column and the limit, so the screen names
   * the column and tells the limit in its own language (`error` has the Japanese message)
   */
  tooLong?: { column: string; max: number };
}

/**
 * Import summary
 */
export interface ImportSummary {
  totalRows: number;
  successCount: number;
  errorCount: number;
  results: ImportRowResult[];
}

/**
 * Column mapping configuration
 */
export interface ColumnMapping {
  email: string;
  name?: string;
  company?: string;
  phone?: string;
  status?: string;
  source?: string;
  score?: string;
}

/**
 * Default column mappings for common CSV formats
 */
export const defaultColumnMappings: ColumnMapping = {
  email: 'email',
  name: 'name',
  company: 'company',
  phone: 'phone',
  status: 'status',
  source: 'source',
  score: 'score',
};

/**
 * Alias mappings for common column name variations
 */
const columnAliases: Record<string, string[]> = {
  email: ['email', 'e-mail', 'mail', 'email_address', 'メールアドレス', 'メール'],
  name: ['name', 'full_name', 'fullname', 'contact_name', '名前', '氏名'],
  company: ['company', 'company_name', 'organization', '会社名', '会社', '企業名'],
  phone: ['phone', 'phone_number', 'tel', 'telephone', '電話番号', '電話'],
  status: ['status', 'lead_status', 'ステータス'],
  source: ['source', 'lead_source', 'channel', 'ソース', '流入元'],
  score: ['score', 'lead_score', 'rating', 'スコア'],
};

/**
 * Find matching column name from headers
 */
function findColumnName(headers: string[], field: string): string | undefined {
  const aliases = columnAliases[field] || [field];
  const normalizedHeaders = headers.map((h) => h.toLowerCase().trim());

  for (const alias of aliases) {
    const index = normalizedHeaders.indexOf(alias.toLowerCase());
    if (index !== -1) {
      return headers[index];
    }
  }
  return undefined;
}

/**
 * Auto-detect column mappings from headers
 */
export function detectColumnMappings(headers: string[]): ColumnMapping {
  return {
    email: findColumnName(headers, 'email') || 'email',
    name: findColumnName(headers, 'name'),
    company: findColumnName(headers, 'company'),
    phone: findColumnName(headers, 'phone'),
    status: findColumnName(headers, 'status'),
    source: findColumnName(headers, 'source'),
    score: findColumnName(headers, 'score'),
  };
}

/**
 * Parse CSV content
 */
export function parseCSV(content: string): { headers: string[]; rows: Record<string, unknown>[] } {
  const workbook = XLSX.read(content, { type: 'string' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: '',
  });

  const headers = jsonData.length > 0 ? Object.keys(jsonData[0]) : [];

  return { headers, rows: jsonData };
}

/**
 * Parse Excel file
 */
export function parseExcel(buffer: ArrayBuffer): {
  headers: string[];
  rows: Record<string, unknown>[];
} {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: '',
  });

  const headers = jsonData.length > 0 ? Object.keys(jsonData[0]) : [];

  return { headers, rows: jsonData };
}

/**
 * Validate and transform a single row
 */
export function validateRow(
  row: Record<string, unknown>,
  mapping: ColumnMapping,
  rowIndex: number
): ImportRowResult {
  try {
    const data: Record<string, unknown> = {
      email: row[mapping.email],
    };

    if (mapping.name && row[mapping.name]) {
      data.name = String(row[mapping.name]).trim();
    }
    if (mapping.company && row[mapping.company]) {
      data.company = String(row[mapping.company]).trim();
    }
    if (mapping.phone && row[mapping.phone]) {
      data.phone = String(row[mapping.phone]).trim();
    }
    if (mapping.status && row[mapping.status]) {
      data.status = String(row[mapping.status]).toLowerCase().trim();
    }
    if (mapping.source && row[mapping.source]) {
      data.source = String(row[mapping.source]).toLowerCase().trim();
    }
    if (mapping.score && row[mapping.score]) {
      data.score = row[mapping.score];
    }

    const validated = importLeadRowSchema.parse(data);

    return {
      row: rowIndex,
      success: true,
      data: validated,
    };
  } catch (error) {
    if (!(error instanceof z.ZodError)) {
      return { row: rowIndex, success: false, error: String(error) || 'Validation failed' };
    }
    const [issue] = error.errors;
    const column = issue ? columnOf(issue, mapping) : undefined;
    const message = issue?.message || 'Validation failed';
    return {
      row: rowIndex,
      success: false,
      error: column ? `${column}: ${message}` : message,
      ...(column && issue?.code === z.ZodIssueCode.too_big && issue.type === 'string'
        ? { tooLong: { column, max: Number(issue.maximum) } }
        : {}),
    };
  }
}

/** The file's column holding the value an issue is about (the lead field when none is mapped) */
function columnOf(issue: z.ZodIssue, mapping: ColumnMapping): string | undefined {
  const [field] = issue.path;
  if (typeof field !== 'string') return undefined;
  return mapping[field as keyof ColumnMapping] ?? field;
}

/**
 * Process import data
 */
export function processImport(
  rows: Record<string, unknown>[],
  mapping: ColumnMapping
): ImportSummary {
  const results: ImportRowResult[] = [];
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const result = validateRow(rows[i], mapping, i + 1);
    results.push(result);

    if (result.success) {
      successCount++;
    } else {
      errorCount++;
    }
  }

  return {
    totalRows: rows.length,
    successCount,
    errorCount,
    results,
  };
}

/**
 * The valid rows of an import, in the file's order, in the parts one leads.bulkCreate takes
 * (LEAD_BULK_CREATE_MAX each, #604). The screen sends them one after another.
 */
export function importBatches(
  summary: ImportSummary,
  size: number = LEAD_BULK_CREATE_MAX
): ImportLeadRow[][] {
  const rows = summary.results.flatMap((result) =>
    result.success && result.data ? [result.data] : []
  );
  const batches: ImportLeadRow[][] = [];
  for (let start = 0; start < rows.length; start += size) {
    batches.push(rows.slice(start, start + size));
  }
  return batches;
}

/**
 * The import left once its first `imported` valid rows are created (the parts sent before one
 * failed, #604): those rows are dropped and the rest kept, the rows with an error too, so that
 * importing again does not create a lead twice
 */
export function withoutImportedRows(summary: ImportSummary, imported: number): ImportSummary {
  let skipped = 0;
  const results = summary.results.filter((result) => {
    if (!(result.success && result.data) || skipped >= imported) return true;
    skipped++;
    return false;
  });
  return {
    totalRows: results.length,
    successCount: summary.successCount - skipped,
    errorCount: summary.errorCount,
    results,
  };
}

/**
 * Generate CSV template for import
 */
export function generateImportTemplate(): string {
  const headers = ['email', 'name', 'company', 'phone', 'status', 'source', 'score'];
  const exampleRow = [
    'example@company.com',
    'John Doe',
    'Acme Corp',
    '+1-555-0100',
    'new',
    'website',
    '75',
  ];

  return [headers.join(','), exampleRow.join(',')].join('\n');
}

/**
 * Download CSV template
 */
export function downloadTemplate(): void {
  const template = generateImportTemplate();
  const blob = new Blob([template], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'leads_import_template.csv';
  link.click();
}
