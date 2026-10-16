/**
 * Lead export (#173): every lead matching the list's filters and sort, written on the server.
 *
 * - At most LEAD_EXPORT_MAX_ROWS rows; the result says when the list had more.
 * - CSV (UTF-8 with BOM, so Excel reads Japanese), JSON and PDF.
 * - Each export leaves one audit row: who, when, the format, the row count and the filters.
 *   The audit metadata holds no personal data: the search text (a name, an email...) is
 *   recorded only as "a search was used".
 *
 * Pure functions only; the procedure is `leads.export` in ./api/router.ts.
 */
import type { LeadExportFormat, ListLeadsInput } from './types/schemas';

/** Most rows one export writes */
export const LEAD_EXPORT_MAX_ROWS = 5000;

/** One exported lead */
export interface LeadExportRow {
  id: string;
  name: string | null;
  email: string;
  company: string | null;
  phone: string | null;
  status: string;
  dealPhase: string | null;
  score: number | null;
  source: string | null;
  inflowSource: string | null;
  /** Name (or email) of the assignee */
  assignee: string | null;
  /** From the latest hearing ('YYYY-MM-DD') */
  nextMeetingDate: string | null;
  /** From the latest hearing (a / b / c) */
  dealRating: string | null;
  createdAt: Date;
}

const CSV_COLUMNS: { header: string; value: (row: LeadExportRow) => string }[] = [
  { header: 'ID', value: (r) => r.id },
  { header: 'Name', value: (r) => r.name ?? '' },
  { header: 'Email', value: (r) => r.email },
  { header: 'Company', value: (r) => r.company ?? '' },
  { header: 'Phone', value: (r) => r.phone ?? '' },
  { header: 'Status', value: (r) => r.status },
  { header: 'Deal Phase', value: (r) => r.dealPhase ?? '' },
  { header: 'Score', value: (r) => (r.score === null ? '' : String(r.score)) },
  { header: 'Source', value: (r) => r.source ?? '' },
  { header: 'Inflow Source', value: (r) => r.inflowSource ?? '' },
  { header: 'Assignee', value: (r) => r.assignee ?? '' },
  { header: 'Next Meeting', value: (r) => r.nextMeetingDate ?? '' },
  { header: 'Deal Rating', value: (r) => r.dealRating?.toUpperCase() ?? '' },
  { header: 'Created At', value: (r) => r.createdAt.toISOString() },
];

/**
 * One CSV cell: quoted when needed, and a leading = + - @ (or tab / CR) is prefixed with ' so
 * a spreadsheet does not run it as a formula (CSV injection)
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

const BOM = '﻿';

export function leadExportCsv(rows: LeadExportRow[]): string {
  const lines = [
    CSV_COLUMNS.map((column) => csvCell(column.header)).join(','),
    ...rows.map((row) => CSV_COLUMNS.map((column) => csvCell(column.value(row))).join(',')),
  ];
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

export function leadExportJson(rows: LeadExportRow[]): string {
  return JSON.stringify(
    rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    null,
    2
  );
}

export const LEAD_EXPORT_MIME_TYPES: Record<LeadExportFormat, string> = {
  csv: 'text/csv;charset=utf-8',
  json: 'application/json',
  pdf: 'application/pdf',
};

/** 'leads_2026-10-16.csv' (Japan day) */
export function leadExportFilename(format: LeadExportFormat, today: string): string {
  return `leads_${today}.${format}`;
}

/**
 * Filters of an export as written to the audit log: which conditions were used, never the
 * search text. Ids (tags, assignee) are internal, not personal data of the leads.
 */
export function exportAuditFilters(input: Omit<ListLeadsInput, 'limit' | 'offset'>) {
  const filters: Record<string, unknown> = {};
  const keys = [
    'status',
    'dealPhase',
    'inflowSource',
    'targetSystem',
    'source',
    'createdFrom',
    'createdTo',
    'createdFromDay',
    'createdToDay',
    'scoreMin',
    'scoreMax',
    'consultationRequested',
    'mql',
    'sqlDecision',
    'assignee',
    'nextMeeting',
    'dealRating',
    'tagIds',
  ] as const;
  for (const key of keys) {
    const value = input[key];
    if (value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    filters[key] = value;
  }
  if (input.search?.trim()) filters.search = true;
  if (input.advancedFilter) filters.advancedFilter = true;
  return filters;
}
