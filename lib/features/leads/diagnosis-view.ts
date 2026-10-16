/**
 * Readable view of the diagnosis data stored on a lead (Refs #107)
 *
 * `leads.responses.axMigration` is the summary the AX migration diagnosis writes on the lead it
 * created (lib/features/diagnostics/ax-migration/submission-service.ts). This turns it into
 * typed values the UI labels with the AX wording, and keeps everything it does not know (other
 * keys, older data, custom fields) as flat key / value text so raw JSON is never shown.
 */

import {
  AX_MQL_LEVELS,
  AX_MQL_REQUIRED,
  AX_MQL_SIGNALS,
  type AxMqlLevel,
  type AxMqlRequired,
  type AxMqlSignal,
} from '@/lib/features/diagnostics/ax-migration/mql';

export const AX_LEVELS = ['low', 'medium', 'high'] as const;
export type AxLevel = (typeof AX_LEVELS)[number];

/** One diagnosed system (the first one, or another system diagnosed from the result screen) */
export interface AxSystemView {
  /** Internal id, used only to link to the submission's answers */
  submissionId: string | null;
  platform: string | null;
  targetSystem: string | null;
  difficulty: AxLevel | null;
  urgency: AxLevel | null;
  primaryChallenge: string | null;
  needsHearing: boolean;
  /** ISO date time */
  diagnosedAt: string | null;
  detailsAnsweredAt: string | null;
}

/** 適合 / 関心あり（MQL） and why (#139) */
export interface AxMqlView {
  level: AxMqlLevel;
  signals: AxMqlSignal[];
  unmet: AxMqlRequired[];
  /**
   * Judged before #139 (no level stored): only the required conditions were checked, so the
   * level reads as 適合 / 対象外 and the lead's MQL date may come from the old rule
   */
  legacy: boolean;
}

export interface AxDiagnosisView extends AxSystemView {
  challenges: string[];
  department: string | null;
  /** 適合 (the required conditions are met) */
  mqlCandidate: boolean;
  mql: AxMqlView;
  sqlSignals: boolean;
  consultationRequested: boolean;
  otherSystems: AxSystemView[];
}

/** A value the view does not know, as plain text parts */
export interface ExtraDataEntry {
  key: string;
  value: string | number | boolean;
}

export interface LeadDiagnosisView {
  ax: AxDiagnosisView | null;
  /** Unknown keys of responses (incl. unknown keys of the AX summary) and custom fields */
  extra: ExtraDataEntry[];
}

const AX_KEY = 'axMigration';

/** Keys of the AX summary read into the view */
const AX_SYSTEM_KEYS = [
  'submissionId',
  'platform',
  'targetSystem',
  'difficulty',
  'urgency',
  'primaryChallenge',
  'needsHearing',
  'diagnosedAt',
  'detailsAnsweredAt',
] as const;
const AX_MAIN_KEYS = new Set<string>([
  ...AX_SYSTEM_KEYS,
  'challenges',
  'department',
  'mqlCandidate',
  'mql',
  'sqlSignals',
  'consultationRequested',
  'otherSystems',
]);

const MAX_DEPTH = 4;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const stringOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

const levelOrNull = (value: unknown): AxLevel | null =>
  typeof value === 'string' && (AX_LEVELS as readonly string[]).includes(value)
    ? (value as AxLevel)
    : null;

const isoOrNull = (value: unknown): string | null => {
  const text = stringOrNull(value);
  return text && !Number.isNaN(Date.parse(text)) ? text : null;
};

/**
 * Flatten a value into key / value entries: nested objects as `a.b`, arrays of plain values
 * joined, arrays of objects as `a[1].b`. Null, undefined and empty values are left out.
 */
export function flattenExtraData(value: unknown, key: string, depth = 0): ExtraDataEntry[] {
  if (value === null || value === undefined) return [];
  if (typeof value === 'string') return value.trim() === '' ? [] : [{ key, value }];
  if (typeof value === 'number' || typeof value === 'boolean') return [{ key, value }];
  if (Array.isArray(value)) {
    if (value.every((item) => ['string', 'number', 'boolean'].includes(typeof item))) {
      const parts = value.map(String).filter((part) => part.trim() !== '');
      return parts.length > 0 ? [{ key, value: parts.join(', ') }] : [];
    }
    if (depth >= MAX_DEPTH) return [{ key, value: `(${value.length})` }];
    return value.flatMap((item, index) =>
      flattenExtraData(item, `${key}[${index + 1}]`, depth + 1)
    );
  }
  if (isPlainObject(value)) {
    if (depth >= MAX_DEPTH) return [{ key, value: `(${Object.keys(value).length})` }];
    return Object.entries(value).flatMap(([child, childValue]) =>
      flattenExtraData(childValue, key ? `${key}.${child}` : child, depth + 1)
    );
  }
  return [];
}

function readMql(stored: unknown, mqlCandidate: boolean): AxMqlView {
  if (
    isPlainObject(stored) &&
    typeof stored.level === 'string' &&
    (AX_MQL_LEVELS as readonly string[]).includes(stored.level)
  ) {
    const listed = (value: unknown) => (Array.isArray(value) ? value : []);
    return {
      level: stored.level as AxMqlLevel,
      signals: AX_MQL_SIGNALS.filter((signal) => listed(stored.signals).includes(signal)),
      unmet: AX_MQL_REQUIRED.filter((key) => listed(stored.unmet).includes(key)),
      legacy: false,
    };
  }
  return { level: mqlCandidate ? 'fit' : 'none', signals: [], unmet: [], legacy: true };
}

function readSystem(source: Record<string, unknown>): AxSystemView {
  return {
    submissionId: stringOrNull(source.submissionId),
    platform: stringOrNull(source.platform),
    targetSystem: stringOrNull(source.targetSystem),
    difficulty: levelOrNull(source.difficulty),
    urgency: levelOrNull(source.urgency),
    primaryChallenge: stringOrNull(source.primaryChallenge),
    needsHearing: source.needsHearing === true,
    diagnosedAt: isoOrNull(source.diagnosedAt),
    detailsAnsweredAt: isoOrNull(source.detailsAnsweredAt),
  };
}

/** Values of a known key that the view could not read (wrong type) stay visible as extra data */
function unreadSystemValues(
  source: Record<string, unknown>,
  read: AxSystemView,
  prefix: string
): ExtraDataEntry[] {
  return AX_SYSTEM_KEYS.flatMap((key) => {
    const raw = source[key];
    if (raw === null || raw === undefined || raw === false) return [];
    const readValue = read[key];
    return readValue === null ? flattenExtraData(raw, `${prefix}.${key}`) : [];
  });
}

/** Read the diagnosis data of a lead (`responses` and `customFields` as stored) */
export function readLeadDiagnosis(responses: unknown, customFields?: unknown): LeadDiagnosisView {
  const extra: ExtraDataEntry[] = [];
  let ax: AxDiagnosisView | null = null;

  if (isPlainObject(responses)) {
    for (const [key, value] of Object.entries(responses)) {
      if (key === AX_KEY && isPlainObject(value)) continue;
      extra.push(...flattenExtraData(value, key));
    }

    const summary = responses[AX_KEY];
    if (isPlainObject(summary)) {
      const main = readSystem(summary);
      const challenges = Array.isArray(summary.challenges)
        ? summary.challenges.filter((item): item is string => typeof item === 'string')
        : [];
      const otherSystems = Array.isArray(summary.otherSystems)
        ? summary.otherSystems.filter(isPlainObject)
        : [];
      const mqlCandidate = summary.mqlCandidate === true;
      ax = {
        ...main,
        challenges,
        department: stringOrNull(summary.department),
        mqlCandidate,
        mql: readMql(summary.mql, mqlCandidate),
        sqlSignals: summary.sqlSignals === true,
        consultationRequested: summary.consultationRequested === true,
        otherSystems: otherSystems.map(readSystem),
      };

      extra.push(...unreadSystemValues(summary, main, AX_KEY));
      otherSystems.forEach((system, index) => {
        const prefix = `${AX_KEY}.otherSystems[${index + 1}]`;
        extra.push(...unreadSystemValues(system, readSystem(system), prefix));
        for (const [key, value] of Object.entries(system)) {
          if (!(AX_SYSTEM_KEYS as readonly string[]).includes(key)) {
            extra.push(...flattenExtraData(value, `${prefix}.${key}`));
          }
        }
      });
      for (const [key, value] of Object.entries(summary)) {
        if (!AX_MAIN_KEYS.has(key)) extra.push(...flattenExtraData(value, `${AX_KEY}.${key}`));
      }
    }
  } else {
    extra.push(...flattenExtraData(responses, 'responses'));
  }

  if (isPlainObject(customFields)) {
    for (const [key, value] of Object.entries(customFields)) {
      extra.push(...flattenExtraData(value, key));
    }
  }

  return { ax, extra };
}
