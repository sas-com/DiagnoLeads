/**
 * The CSV format of a sales agency's call report (Refs #161): companies the agency called, the
 * result, why a call was turned down and when the company may be called again. Read in the
 * browser like the appointment report (#152); the server validates the rows again.
 */
import { readDate } from '@/lib/features/agency-handovers/columns';
import { TARGET_SYSTEMS } from '@/lib/features/leads/types/pipeline';
import {
  CALL_RESULTS,
  type CallResult,
  type ImportCallRowInput,
  REFUSAL_REASONS,
  type RefusalReason,
} from './types/schemas';

export const CALL_COLUMNS = [
  'company',
  'agencyName',
  'calledOn',
  'callResult',
  'department',
  'jobTitle',
  'contactName',
  'contactPhone',
  'targetSystem',
  'estimatedSystemBasis',
  'challengeHypothesis',
  'refusalReason',
  'refusalNote',
  'nextContact',
  'heard',
] as const;
export type CallColumn = (typeof CALL_COLUMNS)[number];

/** Our column names (the template) first, then other names recognised as the same column */
export const CALL_HEADERS: Record<CallColumn, readonly string[]> = {
  company: ['会社名', '企業名', 'company'],
  agencyName: ['代行会社名', '代行会社', 'agency'],
  calledOn: ['架電日', 'コール日', '日付', 'called on'],
  callResult: ['架電結果', '結果', 'result'],
  department: ['部署', '部門', 'department'],
  jobTitle: ['役職', 'title'],
  contactName: ['担当者名', '担当者', 'contact name'],
  contactPhone: ['直通電話', '電話番号', '電話', 'phone'],
  targetSystem: ['推定システム', '基幹システム', '推定した基幹システム', 'system'],
  estimatedSystemBasis: ['推定の根拠', '根拠', 'basis'],
  challengeHypothesis: ['課題の仮説', '仮説', 'hypothesis'],
  refusalReason: ['断られた理由', 'お断り理由', 'refusal reason'],
  refusalNote: ['断られた理由の詳細', '詳細', 'refusal note'],
  nextContact: ['次の連絡可能時期', '再架電時期', '次回連絡', 'next contact'],
  heard: ['備考', 'メモ', 'note'],
};

export type CallMapping = Record<CallColumn, string | null>;

const normalizeHeader = (value: string) => value.replace(/\s+/g, '').toLowerCase();

export function detectCallMapping(headers: string[]): CallMapping {
  const byName = new Map(headers.map((header) => [normalizeHeader(header), header]));
  return Object.fromEntries(
    CALL_COLUMNS.map((column) => [
      column,
      CALL_HEADERS[column].map((name) => byName.get(normalizeHeader(name))).find(Boolean) ?? null,
    ])
  ) as CallMapping;
}

const key = (value: string) => value.replace(/\s+/g, '').toLowerCase();

const CALL_RESULT_WORDS: Record<string, CallResult> = {
  アポ: 'appointment',
  アポ獲得: 'appointment',
  アポイント: 'appointment',
  appointment: 'appointment',
  断り: 'refused',
  お断り: 'refused',
  ng: 'refused',
  拒否: 'refused',
  refused: 'refused',
  不在: 'absent',
  担当不在: 'absent',
  absent: 'absent',
  再架電: 'callback',
  折り返し: 'callback',
  再コール: 'callback',
  callback: 'callback',
};
const REFUSAL_WORDS: Record<string, RefusalReason> = {
  予算: 'budget',
  予算がない: 'budget',
  費用: 'budget',
  budget: 'budget',
  人手: 'staffing',
  人手不足: 'staffing',
  体制: 'staffing',
  staffing: 'staffing',
  リスク: 'risk',
  移行のリスク: 'risk',
  不安: 'risk',
  risk: 'risk',
  優先度: 'priority',
  時期: 'priority',
  今は不要: 'priority',
  priority: 'priority',
  依頼先: 'vendor',
  既存ベンダー: 'vendor',
  他社: 'vendor',
  vendor: 'vendor',
  その他: 'other',
  other: 'other',
};
const SYSTEM_WORDS: Record<string, (typeof TARGET_SYSTEMS)[number]> = {
  as400: 'as400',
  'as/400': 'as400',
  ibmi: 'as400',
  'ibm i': 'as400',
  acos: 'acos',
  'nec acos': 'acos',
  オフコン: 'other_legacy',
  汎用機: 'other_legacy',
  メインフレーム: 'other_legacy',
  vb: 'vb',
  'visual basic': 'vb',
  access: 'access',
  webperformer: 'webperformer',
  パッケージ: 'package',
  不明: 'unknown',
};

const pick = <T extends string>(text: string, table: Record<string, T>, values: readonly T[]) =>
  table[key(text)] ?? (values as readonly string[]).find((value) => value === key(text)) ?? null;

export type CallCellProblem = { column: CallColumn; value: string };

/** Text limits of the server (importCallRowSchema): longer cells are cut, not refused */
const LIMITS: Partial<Record<CallColumn, number>> = {
  company: 200,
  agencyName: 100,
  department: 100,
  jobTitle: 100,
  contactName: 100,
  estimatedSystemBasis: 500,
  challengeHypothesis: 500,
  refusalNote: 500,
  heard: 2000,
};

/** 全角 digits and dashes to ASCII; an extension or anything else makes it unreadable */
export function readPhone(value: string): string | null {
  const ascii = value
    .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
    .replace(/[－ー―‐−（）＋]/g, (mark) => ({ '（': '(', '）': ')', '＋': '+' })[mark] ?? '-')
    .trim();
  return /^[0-9+\-() ]{1,30}$/.test(ascii) ? ascii : null;
}

const cell = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
};

/**
 * Read one row of the report. A cell that cannot be read is left empty and reported. The next
 * contact may be a date or a rough time ("来年4月", "半年後"): a date goes to the next action
 * date, anything else to its note.
 */
export function readCallRow(
  raw: Record<string, unknown>,
  mapping: CallMapping
): { row: ImportCallRowInput | null; problems: CallCellProblem[] } {
  const problems: CallCellProblem[] = [];
  const value = (column: CallColumn) => {
    const header = mapping[column];
    return header ? cell(raw[header]) : '';
  };
  const text = (column: CallColumn) => {
    const input = value(column);
    if (!input) return null;
    const max = LIMITS[column];
    if (max && input.length > max) {
      problems.push({ column, value: input.slice(0, 20) });
      return input.slice(0, max);
    }
    return input;
  };
  const read = <T>(column: CallColumn, parse: (input: string) => T | null): T | null => {
    const input = value(column);
    if (!input) return null;
    const parsed = parse(input);
    if (parsed === null) problems.push({ column, value: input });
    return parsed;
  };
  const company = text('company');
  if (!company) return { row: null, problems };
  const nextContact = value('nextContact');
  const nextDate = nextContact ? readDate(nextContact) : null;
  return {
    row: {
      company,
      agencyName: text('agencyName'),
      calledOn: read('calledOn', readDate),
      callResult: read('callResult', (input) => pick(input, CALL_RESULT_WORDS, CALL_RESULTS)),
      department: text('department'),
      jobTitle: text('jobTitle'),
      contactName: text('contactName'),
      contactPhone: read('contactPhone', readPhone),
      targetSystem: read('targetSystem', (input) => pick(input, SYSTEM_WORDS, TARGET_SYSTEMS)),
      estimatedSystemBasis: text('estimatedSystemBasis'),
      challengeHypothesis: text('challengeHypothesis'),
      refusalReason: read('refusalReason', (input) => pick(input, REFUSAL_WORDS, REFUSAL_REASONS)),
      refusalNote: text('refusalNote'),
      nextActionOn: nextDate,
      nextActionNote: nextContact && !nextDate ? nextContact.slice(0, 100) : null,
      heard: text('heard'),
    },
    problems,
  };
}

/** The template: our column names and one made-up example row */
export function callTemplateCsv(): string {
  const header = CALL_COLUMNS.map((column) => CALL_HEADERS[column][0]);
  const example = [
    '架空工業株式会社',
    '架空テレアポ',
    '2026/11/05',
    '断り',
    '情報システム部',
    '課長',
    '山田 太郎',
    '03-0000-0000',
    'AS/400',
    '求人に RPG の記載',
    '保守できる人が減っている',
    '予算',
    '今期は予算が取れない',
    '2027/04/01',
    '',
  ];
  return `${header.join(',')}\n${example.join(',')}\n`;
}
