/**
 * MQL level of a lead (適合 / 関心あり（MQL）, #139), read from the diagnosis summaries stored on
 * the lead (#196). The lead page (diagnosis-view.ts) and the lead list read the level with the
 * same rules; the list does it in SQL (leadMqlLevel in api/list-sql.ts), which mirrors this file.
 *
 * - AX migration diagnosis (`responses.axMigration`): `mql.level`. Leads judged before
 *   2026-10-16 (#139) have only `mqlCandidate`: true reads as 適合 (legacy), else 対象外.
 * - Builder diagnosis (`responses.diagnosis`, #121): `mqlLevel`. Summaries without it have only
 *   `mqlQualified`: true reads as 関心あり（MQL）, else 対象外.
 *
 * No browser or database imports: the lead page uses it on the client.
 */
import { AX_MQL_LEVELS, type AxMqlLevel } from '@/lib/features/diagnostics/ax-migration/mql';

/** Key of the AX migration summary in `leads.responses` */
export const AX_RESPONSES_KEY = 'axMigration';
/** Same as DIAGNOSIS_LEAD_RESPONSES_KEY in diagnosis-builder/submission-service.ts */
export const BUILDER_RESPONSES_KEY = 'diagnosis';

/** Highest first: the level a lead with several diagnoses shows */
const LEVEL_RANK: readonly AxMqlLevel[] = ['interest', 'fit', 'none'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isMqlLevel(value: unknown): value is AxMqlLevel {
  return typeof value === 'string' && (AX_MQL_LEVELS as readonly string[]).includes(value);
}

/** Level of an AX migration summary; `legacy` when it was judged before #139 */
export function axSummaryMqlLevel(summary: Record<string, unknown>): {
  level: AxMqlLevel;
  legacy: boolean;
} {
  const mql = summary.mql;
  if (isPlainObject(mql) && isMqlLevel(mql.level)) return { level: mql.level, legacy: false };
  return { level: summary.mqlCandidate === true ? 'fit' : 'none', legacy: true };
}

/** Level of a builder diagnosis summary */
export function builderSummaryMqlLevel(summary: Record<string, unknown>): AxMqlLevel {
  if (isMqlLevel(summary.mqlLevel)) return summary.mqlLevel;
  return summary.mqlQualified === true ? 'interest' : 'none';
}

/**
 * Level of a lead from its stored `responses`: the higher of the AX and the builder diagnosis
 * levels. Null when the lead has neither summary (e.g. a lead added by hand).
 */
export function leadMqlLevel(responses: unknown): AxMqlLevel | null {
  if (!isPlainObject(responses)) return null;
  const levels: AxMqlLevel[] = [];
  const ax = responses[AX_RESPONSES_KEY];
  if (isPlainObject(ax)) levels.push(axSummaryMqlLevel(ax).level);
  const builder = responses[BUILDER_RESPONSES_KEY];
  if (isPlainObject(builder)) levels.push(builderSummaryMqlLevel(builder));
  return LEVEL_RANK.find((level) => levels.includes(level)) ?? null;
}
