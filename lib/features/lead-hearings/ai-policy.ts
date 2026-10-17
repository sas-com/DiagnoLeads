/**
 * Whether the customer allows an outside AI service to analyse their source code (Refs #160).
 * The migration plan relies on it, so "not allowed" and "only on conditions" are shown on the
 * lead and told to its assignee when a hearing records them.
 */
import type { HearingFields } from './types/schemas';

export const AI_SOURCE_ANALYSIS_VALUES = [
  'allowed',
  'conditional',
  'not_allowed',
  'unknown',
] as const;
export type AiSourceAnalysis = (typeof AI_SOURCE_ANALYSIS_VALUES)[number];

/** Answers that make the usual plan need a second look */
export const RESTRICTED_AI_SOURCE_ANALYSIS: readonly AiSourceAnalysis[] = [
  'conditional',
  'not_allowed',
];

export interface AiSourceAnalysisPolicy {
  value: AiSourceAnalysis;
  /** What the conditions are (free text), when recorded */
  conditions: string | null;
}

const isValue = (value: unknown): value is AiSourceAnalysis =>
  typeof value === 'string' && (AI_SOURCE_ANALYSIS_VALUES as readonly string[]).includes(value);

/** The recorded answer of a hearing, or null when none */
export function aiSourceAnalysisOf(fields: HearingFields): AiSourceAnalysisPolicy | null {
  const value = fields.aiSourceAnalysis?.value;
  if (!isValue(value)) return null;
  const conditions = fields.aiSourceAnalysisConditions?.value;
  return {
    value,
    conditions: typeof conditions === 'string' && conditions.trim() ? conditions.trim() : null,
  };
}

export const isRestricted = (policy: AiSourceAnalysisPolicy | null): boolean =>
  policy !== null && RESTRICTED_AI_SOURCE_ANALYSIS.includes(policy.value);

/**
 * Whether saving a hearing should tell the assignee: the answer is now a restriction and was not
 * this one before (autosave saves often; an unchanged answer is not told again)
 */
export function shouldNotifyRestriction(
  before: AiSourceAnalysisPolicy | null,
  after: AiSourceAnalysisPolicy | null
): boolean {
  return isRestricted(after) && before?.value !== after?.value;
}

const VALUE_LABELS: Record<AiSourceAnalysis, string> = {
  allowed: '可',
  conditional: '条件付き',
  not_allowed: '不可',
  unknown: '不明',
};

/** Title and body of the in-app notice to the assignee */
export function buildRestrictionNotice(input: {
  policy: AiSourceAnalysisPolicy;
  leadName: string | null;
  company: string | null;
  recordedByName: string | null;
}) {
  const who = [input.company, input.leadName ? `${input.leadName} 様` : null]
    .filter(Boolean)
    .join(' ');
  const lead = who || 'リード';
  const label = VALUE_LABELS[input.policy.value];
  const by = input.recordedByName ? `${input.recordedByName} さんが` : '';
  const conditions = input.policy.conditions ? `条件：${input.policy.conditions}` : '';
  return {
    title: `【要確認】${lead}：AI でのソースコード解析は「${label}」`,
    message: `${by}ヒアリングで、外部の AI サービスでのソースコード解析が「${label}」と記録しました。AI 解析を前提にした進め方を見直してください。${conditions}`,
  };
}
