/**
 * The CSV format of the agency's appointment report (Refs #152): our column names, the other
 * names each column is recognised by, and how each cell is read. Used in the browser before the
 * rows are sent; the server validates them again (types/schemas.ts).
 */
import { type HandoverRow, isRealDate } from './types/schemas';

export const HANDOVER_COLUMNS = [
  'email',
  'company',
  'agencyName',
  'appointmentOn',
  'contactName',
  'contactTitle',
  'contactPhone',
  'machineModel',
  'machineModelConfirmed',
  'hardwareSupportEnd',
  'retirementPlan',
  'decisionMakerPresent',
  'interestLevel',
  'refusalReason',
  'note',
] as const;
export type HandoverColumn = (typeof HANDOVER_COLUMNS)[number];

/** Column names of our format (the template), then other names recognised as the same column */
export const HANDOVER_HEADERS: Record<HandoverColumn, readonly string[]> = {
  email: ['メールアドレス', 'メール', 'email', 'e-mail'],
  company: ['会社名', '企業名', 'company'],
  agencyName: ['代行会社名', '代行会社', 'agency'],
  appointmentOn: ['アポ日', 'アポイント日', '商談日', 'appointment date'],
  contactName: ['担当者名', '担当者', 'contact name'],
  contactTitle: ['部署・役職', '役職', '部署', 'title'],
  contactPhone: ['直通電話', '電話番号', '電話', 'phone'],
  machineModel: ['機種', '機種名', 'model'],
  machineModelConfirmed: ['機種の確認', '機種確認', 'model confirmed'],
  hardwareSupportEnd: ['保守期限', 'ハード保守期限', 'support end'],
  retirementPlan: ['退職予定', '担当者の退職予定', 'retirement'],
  decisionMakerPresent: ['決裁者の同席', '決裁者同席', 'decision maker present'],
  interestLevel: ['関心度', '温度感', 'interest'],
  refusalReason: ['断られた理由', 'お断り理由', '失注理由', 'refusal reason'],
  note: ['備考', 'メモ', 'note'],
};

/** Mapping: our column → the file's column name (null: not in the file) */
export type HandoverMapping = Record<HandoverColumn, string | null>;

const normalizeHeader = (value: string) => value.replace(/\s+/g, '').toLowerCase();

/** Find each column in the file's header row by our name or a recognised other name */
export function detectHandoverMapping(headers: string[]): HandoverMapping {
  const byName = new Map(headers.map((header) => [normalizeHeader(header), header]));
  return Object.fromEntries(
    HANDOVER_COLUMNS.map((column) => [
      column,
      HANDOVER_HEADERS[column].map((name) => byName.get(normalizeHeader(name))).find(Boolean) ??
        null,
    ])
  ) as HandoverMapping;
}

const cell = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
};
const pad = (value: string) => value.padStart(2, '0');

/**
 * A date cell Excel keeps as a serial number (days since 1899-12-30), as the spreadsheet reader
 * hands it over: 46331 → 2026-11-05. Only the range of 1982-2117, so other numbers stay numbers.
 */
function excelSerialDate(value: string): string | null {
  if (!/^\d{5}(\.\d+)?$/.test(value)) return null;
  const days = Math.floor(Number(value));
  if (days < 30000 || days > 80000) return null;
  return new Date(Date.UTC(1899, 11, 30) + days * 86_400_000).toISOString().slice(0, 10);
}

/** 2026/10/21, 2026-10-21, 2026年10月21日, an Excel date → 2026-10-21 */
export function readDate(value: string): string | null {
  const serial = excelSerialDate(value);
  if (serial) return serial;
  const match = value.match(/^(\d{4})[/\-.年](\d{1,2})[/\-.月](\d{1,2})日?$/);
  const date = match ? `${match[1]}-${pad(match[2])}-${pad(match[3])}` : null;
  return date && isRealDate(date) ? date : null;
}

/** 2026/10, 2026-10, 2026年10月 (or a full date, or an Excel date) → 2026-10 */
export function readYearMonth(value: string): string | null {
  const serial = excelSerialDate(value);
  if (serial) return serial.slice(0, 7);
  const match = value.match(/^(\d{4})[/\-.年](\d{1,2})月?(?:[/\-.](\d{1,2})日?)?$/);
  if (!match) return null;
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? `${match[1]}-${pad(match[2])}` : null;
}

const pick = <T extends string>(value: string, table: Record<string, T>): T | null =>
  table[value.replace(/\s+/g, '').toLowerCase()] ?? null;

const YES_NO: Record<string, 'yes' | 'no' | 'unknown'> = {
  あり: 'yes',
  有: 'yes',
  はい: 'yes',
  同席: 'yes',
  yes: 'yes',
  '○': 'yes',
  なし: 'no',
  無: 'no',
  いいえ: 'no',
  不在: 'no',
  no: 'no',
  '×': 'no',
  不明: 'unknown',
  未確認: 'unknown',
  unknown: 'unknown',
};
const CONFIRMED: Record<string, 'true' | 'false'> = {
  確認済み: 'true',
  確認済: 'true',
  済: 'true',
  はい: 'true',
  yes: 'true',
  '○': 'true',
  未確認: 'false',
  未: 'false',
  いいえ: 'false',
  no: 'false',
  '×': 'false',
};
const INTEREST: Record<string, 'high' | 'medium' | 'low'> = {
  高: 'high',
  高い: 'high',
  a: 'high',
  high: 'high',
  中: 'medium',
  普通: 'medium',
  b: 'medium',
  medium: 'medium',
  低: 'low',
  低い: 'low',
  c: 'low',
  low: 'low',
};

export type HandoverCellProblem = { column: HandoverColumn; value: string };

/**
 * Read one row of the file into a handover row. A cell that cannot be read is left empty and
 * reported, so the rest of the row still goes in.
 */
export function readHandoverRow(
  raw: Record<string, unknown>,
  mapping: HandoverMapping
): { row: Partial<HandoverRow>; problems: HandoverCellProblem[] } {
  const problems: HandoverCellProblem[] = [];
  const value = (column: HandoverColumn) => {
    const header = mapping[column];
    return header ? cell(raw[header]) : '';
  };
  const read = <T>(column: HandoverColumn, parse: (text: string) => T | null): T | null => {
    const text = value(column);
    if (!text) return null;
    const parsed = parse(text);
    if (parsed === null) problems.push({ column, value: text });
    return parsed;
  };
  const textOf = (column: HandoverColumn) => value(column) || null;
  const confirmed = read('machineModelConfirmed', (text) => pick(text, CONFIRMED));
  const row: Partial<HandoverRow> = {
    email: textOf('email')?.toLowerCase() ?? null,
    company: textOf('company'),
    agencyName: textOf('agencyName'),
    appointmentOn: read('appointmentOn', readDate),
    contactName: textOf('contactName'),
    contactTitle: textOf('contactTitle'),
    contactPhone: textOf('contactPhone'),
    machineModel: textOf('machineModel'),
    machineModelConfirmed: confirmed === null ? null : confirmed === 'true',
    hardwareSupportEnd: read('hardwareSupportEnd', readYearMonth),
    retirementPlan: read('retirementPlan', readYearMonth),
    decisionMakerPresent: read('decisionMakerPresent', (text) => pick(text, YES_NO)),
    interestLevel: read('interestLevel', (text) => pick(text, INTEREST)),
    refusalReason: textOf('refusalReason'),
    note: textOf('note'),
  };
  return { row, problems };
}

/** The template: our column names and one made-up example row */
export function handoverTemplateCsv(): string {
  const header = HANDOVER_COLUMNS.map((column) => HANDOVER_HEADERS[column][0]);
  const example = [
    'yamada@example.co.jp',
    '架空商事株式会社',
    '架空テレアポ',
    '2026/11/05',
    '山田 太郎',
    '情報システム部 課長',
    '03-0000-0000',
    'IBM Power 9',
    '確認済み',
    '2028/03',
    '2027/09',
    'あり',
    '高',
    '',
    '来期予算で検討',
  ];
  return `${header.join(',')}\n${example.join(',')}\n`;
}
