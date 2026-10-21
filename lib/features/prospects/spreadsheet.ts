import * as XLSX from 'xlsx';
import {
  type ImportProspectRow,
  PROSPECT_TEXT_MAX,
  SPREADSHEET_LABELS,
  importProspectRowSchema,
  isProspectDate,
} from './types/schemas';

/**
 * Reads the "customer search" spreadsheet (#265) in the browser. Only the mapped rows are sent to
 * the server, which validates them again; the file itself never leaves the browser.
 */

/** Header of the list sheet, matched after removing spaces and line breaks */
const HEADERS = {
  contactedOn: '日付',
  entry: '入口',
  company: '会社名',
  department: '部門',
  jobTitle: '役職',
  surname: '苗字',
  explainedOn: '説明日',
  heard: '聞いた話',
  systemScope: '基幹システムor周辺システム',
  reaction: '反応',
  nextStep: '次の一手',
  nextActionOn: '次回アクション日',
  recorderName: '記入者',
  updatedOn: '更新日',
  stage: '現在の段階',
  meetingOn: '商談日',
  salesName: '営業担当',
  remarks: '備考',
} as const;
type Column = keyof typeof HEADERS;

/** The spreadsheet's own example row */
const EXAMPLE_MARK = '【記入例】';

export interface ParsedSpreadsheet {
  rows: { line: number; row: ImportProspectRow }[];
  /** Rows that cannot be imported */
  errors: { line: number; message: string }[];
  /** Values imported into the remarks because they fit no column */
  notices: { line: number; message: string }[];
  /** Example rows and rows without a company */
  skipped: number;
}

const squash = (value: unknown) => String(value ?? '').replace(/[\s　]/g, '');

/** "聞いた話(システムの種類…)" matches "聞いた話": the header text before a bracket */
const headerKey = (value: unknown) => squash(value).split(/[(（]/)[0] ?? '';

function toIsoDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // Cells read with cellDates are local midnight; keep the calendar date
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    const iso = `${y}-${m}-${d}`;
    return isProspectDate(iso) ? iso : null;
  }
  const text = String(value ?? '').trim();
  const match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (!match) return null;
  const iso = `${match[1]}-${match[2]?.padStart(2, '0')}-${match[3]?.padStart(2, '0')}`;
  // "2026/13/45" looks like a date but is none
  return isProspectDate(iso) ? iso : null;
}

const text = (value: unknown) => {
  // Windows line breaks would fail the check for control characters
  const trimmed = String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .trim();
  // A lone dash means "none" in the spreadsheet
  return trimmed === '' || trimmed === '-' || trimmed === '－' ? null : trimmed;
};

/** Cells of one-line columns sometimes have line breaks: join the lines with a space */
const oneLine = (value: unknown) => text(value)?.replace(/\s+/g, ' ') ?? null;

/** Cut by characters, not UTF-16 units, so an emoji is never split */
const cut = (value: string, max: number) => Array.from(value).slice(0, max).join('');

/** The label's value, ignoring keys every object has ("constructor") */
const lookup = <T extends string>(labels: Record<string, T>, raw: string): T | null =>
  Object.hasOwn(labels, raw) ? (labels[raw] ?? null) : null;

/** The entry must be one of the choices: the row cannot be counted without it */
function labelOf<T extends string>(labels: Record<string, T>, value: unknown): T | null {
  const raw = oneLine(value);
  return raw === null ? null : lookup(labels, raw);
}

/** Rows of the list sheet, from the header row down */
export function parseProspectRows(cells: readonly (readonly unknown[])[]): ParsedSpreadsheet {
  const headerIndex = cells.findIndex((row) => row.some((cell) => headerKey(cell) === '会社名'));
  if (headerIndex < 0) {
    return {
      rows: [],
      errors: [{ line: 0, message: '見出しの行（会社名）が見つかりません' }],
      notices: [],
      skipped: 0,
    };
  }

  const header = cells[headerIndex] ?? [];
  const position = {} as Record<Column, number>;
  for (const [column, name] of Object.entries(HEADERS) as [Column, string][]) {
    position[column] = header.findIndex((cell) => headerKey(cell) === squash(name));
  }
  const missing = (Object.keys(HEADERS) as Column[]).filter(
    (column) => position[column] < 0 && ['contactedOn', 'entry', 'company'].includes(column)
  );
  if (missing.length > 0) {
    return {
      rows: [],
      errors: [
        {
          line: headerIndex + 1,
          message: `見出しが足りません: ${missing.map((c) => HEADERS[c]).join('、')}`,
        },
      ],
      notices: [],
      skipped: 0,
    };
  }

  const result: ParsedSpreadsheet = { rows: [], errors: [], notices: [], skipped: 0 };
  cells.slice(headerIndex + 1).forEach((row, offset) => {
    const line = headerIndex + offset + 2;
    const cell = (column: Column) => (position[column] >= 0 ? row[position[column]] : undefined);
    if (!text(cell('company'))) {
      if (row.some((value) => text(value))) result.skipped += 1;
      return;
    }
    if (String(cell('remarks') ?? '').includes(EXAMPLE_MARK)) {
      result.skipped += 1;
      return;
    }

    const problems: string[] = [];
    // What fits no column is kept in the remarks rather than lost
    const kept: string[] = [];
    const keep = (column: Column, raw: string) => {
      kept.push(`${HEADERS[column]}（元の記入）: ${raw}`);
      result.notices.push({ line, message: `${HEADERS[column]}「${raw}」は備考に残します` });
    };
    const pick = <T extends string>(labels: Record<string, T>, column: Column) => {
      const raw = oneLine(cell(column));
      if (raw === null) return null;
      const found = lookup(labels, raw);
      if (!found) keep(column, raw);
      return found;
    };
    /** Date of the cell, or the text when it is not a date ("mid-November") */
    const dateOrText = (column: Column): { iso: string | null; raw: string | null } => {
      const value = cell(column);
      const raw = oneLine(value);
      if (raw === null && !(value instanceof Date)) return { iso: null, raw: null };
      const iso = toIsoDate(value);
      return iso ? { iso, raw: null } : { iso: null, raw };
    };
    const date = (column: Column) => {
      const { iso, raw } = dateOrText(column);
      if (raw) keep(column, raw);
      return iso;
    };
    const contacted = dateOrText('contactedOn');
    const nextAction = dateOrText('nextActionOn');

    const candidate = {
      contactedOn: contacted.iso,
      entry: labelOf(SPREADSHEET_LABELS.entry, cell('entry')),
      company: oneLine(cell('company')),
      department: oneLine(cell('department')),
      jobTitle: oneLine(cell('jobTitle')),
      surname: oneLine(cell('surname')),
      explainedOn: date('explainedOn'),
      heard: text(cell('heard')),
      systemScope: pick(SPREADSHEET_LABELS.systemScope, 'systemScope'),
      reaction: pick(SPREADSHEET_LABELS.reaction, 'reaction'),
      nextStep: pick(SPREADSHEET_LABELS.nextStep, 'nextStep'),
      nextActionOn: nextAction.iso,
      // The usage sheet allows a rough time instead of a date
      nextActionNote: nextAction.raw ? cut(nextAction.raw, 100) : null,
      recorderName: oneLine(cell('recorderName')),
      updatedOn: date('updatedOn'),
      stage: pick(SPREADSHEET_LABELS.stage, 'stage'),
      meetingOn: date('meetingOn'),
      salesName: oneLine(cell('salesName')),
      remarks: null as string | null,
    };
    if (!candidate.contactedOn) {
      problems.push(
        contacted.raw ? `日付「${contacted.raw}」は日付として読めません` : '日付がありません'
      );
    }
    if (!candidate.entry) {
      const raw = oneLine(cell('entry'));
      problems.push(raw ? `入口「${raw}」は選択肢にありません` : '入口がありません');
    }
    if (problems.length > 0) {
      result.errors.push({ line, message: problems.join(' / ') });
      return;
    }

    candidate.remarks =
      cut([text(cell('remarks')), ...kept].filter(Boolean).join('\n'), PROSPECT_TEXT_MAX) || null;
    const parsed = importProspectRowSchema.safeParse(candidate);
    if (!parsed.success) {
      const fields = parsed.error.issues.map((issue) => String(issue.path[0] ?? ''));
      result.errors.push({
        line,
        message: `読めない値があります（${[...new Set(fields)].join('、')}）`,
      });
      return;
    }
    result.rows.push({ line, row: parsed.data });
  });
  return result;
}

/** Sheet named like the list ("顧客探し一覧"), or the first sheet */
export function parseProspectWorkbook(buffer: ArrayBuffer): ParsedSpreadsheet {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  const name =
    workbook.SheetNames.find((sheet) => sheet.includes('顧客探し一覧')) ?? workbook.SheetNames[0];
  const sheet = name ? workbook.Sheets[name] : undefined;
  if (!sheet) {
    return {
      rows: [],
      errors: [{ line: 0, message: 'シートがありません' }],
      notices: [],
      skipped: 0,
    };
  }
  const cells = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
  return parseProspectRows(cells);
}
