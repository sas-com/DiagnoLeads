/**
 * The fields the glossary may describe (Epic #780 P0b, #800). Editors pick a field from this list
 * rather than typing a key, and the write API refuses any key or value not listed here, so a typo
 * cannot leave an entry no screen reads.
 *
 * Enum fields list their values from the code that defines them, so a new status shows up here
 * without a second list. Value labels stay in locales/ (decision
 * 2026-10-26-field-glossary-site-wide): `valueLabels` names the message namespace whose keys are
 * the values. Free-text candidates (label_ja / label_en) are added with the first field that needs
 * them.
 */

import {
  DEAL_LOST_REASONS,
  DEAL_STAGES,
  FORECAST_OVERRIDES,
} from '@/lib/features/deals/types/pipeline';
import {
  DEAL_PHASES,
  INFLOW_SOURCES,
  LEAD_STATUSES,
  LOST_REASONS,
  SQL_DECISIONS,
} from '@/lib/features/leads/types/pipeline';
import { MQL_LEVEL_FILTERS } from '@/lib/features/leads/types/schemas';

export interface GlossaryField {
  /** The stored field_key, '<feature>.<field>' */
  key: string;
  /** Message key of the field's name under fieldGlossary.fields (next-intl keys cannot hold dots) */
  id: string;
  /** The values that may carry their own help; absent for a field without fixed values */
  values?: readonly string[];
  /** Message namespace whose keys are the values (their display names) */
  valueLabels?: string;
}

export const GLOSSARY_FIELDS = [
  { key: 'leads.status', id: 'leadsStatus', values: LEAD_STATUSES, valueLabels: 'status' },
  {
    key: 'leads.dealPhase',
    id: 'leadsDealPhase',
    values: DEAL_PHASES,
    valueLabels: 'pipeline.dealPhase',
  },
  {
    key: 'leads.mqlLevel',
    id: 'leadsMqlLevel',
    // 'unknown' is the filter for a lead without a diagnosis, not a level a lead has
    values: MQL_LEVEL_FILTERS.filter((level) => level !== 'unknown'),
    valueLabels: 'leadList.mqlLevelOptions',
  },
  {
    key: 'leads.sqlDecision',
    id: 'leadsSqlDecision',
    values: SQL_DECISIONS,
    valueLabels: 'pipeline.sqlDecision',
  },
  {
    key: 'leads.inflowSource',
    id: 'leadsInflowSource',
    values: INFLOW_SOURCES,
    valueLabels: 'pipeline.inflowSource',
  },
  {
    key: 'leads.lostReason',
    id: 'leadsLostReason',
    values: LOST_REASONS,
    valueLabels: 'pipeline.lostReason',
  },
  { key: 'deals.stage', id: 'dealsStage', values: DEAL_STAGES, valueLabels: 'deals.stages' },
  { key: 'deals.probability', id: 'dealsProbability' },
  { key: 'deals.amount', id: 'dealsAmount' },
  {
    key: 'deals.forecastOverride',
    id: 'dealsForecastOverride',
    values: FORECAST_OVERRIDES,
    valueLabels: 'deals.forecast',
  },
  {
    key: 'deals.lostReason',
    id: 'dealsLostReason',
    values: DEAL_LOST_REASONS,
    valueLabels: 'pipeline.lostReason',
  },
] as const satisfies readonly GlossaryField[];

export type GlossaryFieldKey = (typeof GLOSSARY_FIELDS)[number]['key'];

export const GLOSSARY_FIELD_KEYS: readonly string[] = GLOSSARY_FIELDS.map((field) => field.key);

/** The listed field with this key, or undefined */
export function findGlossaryField(key: string): GlossaryField | undefined {
  return (GLOSSARY_FIELDS as readonly GlossaryField[]).find((field) => field.key === key);
}

/**
 * Where an entry for this field and value sits: the field's own entry (value null), or one of its
 * listed values in the listed order. Null when the field or the value is not listed.
 */
export function glossaryEntryPosition(
  key: string,
  value: string | null
): { sortOrder: number } | null {
  const field = findGlossaryField(key);
  if (!field) return null;
  if (value === null) return { sortOrder: 0 };
  const index = field.values?.indexOf(value) ?? -1;
  return index === -1 ? null : { sortOrder: index + 1 };
}
