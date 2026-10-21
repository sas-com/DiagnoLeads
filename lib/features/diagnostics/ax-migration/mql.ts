/**
 * MQL judgement of the AX migration diagnosis (Refs #139)
 *
 * Two levels, decided 2026-10-16 (owner):
 * - 適合 (`fit`): the required conditions (target industry × target system) are met.
 * - 関心あり（MQL） (`interest`): fit, plus at least one strong signal (an action such as a
 *   consultation request, or an answer such as a near support deadline or a decision-making
 *   role), or a lead score at or above `minScore`.
 *
 * The words follow the diagnosis builder's MQL rules (lib/features/diagnosis-builder:
 * `required` + `strongSignals` + `minScore`): every required condition must hold, then a strong
 * signal or the minimum score qualifies. Only `interest` sets the lead's MQL date.
 * The rules themselves live in config.ts (AX_MIGRATION_CONFIG.mql).
 *
 * Company size (#150) is a required condition too, but only an answer outside the
 * organization's target ranges fails it: an unanswered size, or no ranges set, never does.
 *
 * Some migration paths do not require every condition (#292, owner 2026-10-21: Access deals are
 * taken from any industry and size). `criteria` keeps what the answers say; the conditions the
 * path does not require are listed in `waived`, count as met, and never appear in `unmet`.
 */

import type { AxCompanySizeFit } from './company-size';

export const AX_MQL_LEVELS = ['interest', 'fit', 'none'] as const;
export type AxMqlLevel = (typeof AX_MQL_LEVELS)[number];

/** Required conditions (必須条件) */
export const AX_MQL_REQUIRED = ['industry', 'system', 'company_size'] as const;
export type AxMqlRequired = (typeof AX_MQL_REQUIRED)[number];

/** Strong signals (強いシグナル), in the order they are shown */
export const AX_MQL_SIGNALS = [
  'consultation',
  'support_deadline',
  'decision_role',
  'timeline_soon',
  'min_score',
  /** Old rule (countWebDiagnosisAsMqlAction): completing the diagnosis counted as the action */
  'web_diagnosis',
] as const;
export type AxMqlSignal = (typeof AX_MQL_SIGNALS)[number];

export interface AxMqlRules {
  /** Migration paths that take any industry: 業種 counts as met (#292) */
  anyIndustryPlatforms: readonly string[];
  /** Migration paths that take any company size: 企業規模 counts as met (#292) */
  anySizePlatforms: readonly string[];
  /**
   * 強いシグナル: answers that count as interest. Each list holds answer values; an empty list
   * turns that signal off. 要確認（営業と決める）
   */
  strongSignals: {
    /** 相談申込 counts as interest */
    consultation: boolean;
    /** support_end: the server / OS / lease support ends soon or has ended */
    supportEnd: readonly string[];
    /**
     * Access: the Access / Office version is out of support or ends within a year. Counts only
     * together with one of `accessSupportWith` (#292)
     */
    accessSupport: readonly string[];
    /**
     * Answers that make the Access support end a strong signal; any one of them is enough.
     * An empty list turns that condition off (all empty: the support end never counts)
     */
    accessSupportWith: {
      /** access_importance: how much it matters if the tool stops */
      importance: readonly string[];
      /** access_users: how many people use it */
      users: readonly string[];
      /** access_features: any of these is chosen */
      features: readonly string[];
      /** access_location: where the data is stored */
      locations: readonly string[];
    };
    /** role: the respondent decides, or is close to who decides */
    roles: readonly string[];
    /** timeline: the respondent wants to switch soon */
    timelines: readonly string[];
  };
  /** 最低スコア: a lead score at or above this counts as interest; null = not used */
  minScore: number | null;
}

/** What the evaluation found, before the rules are applied */
export interface AxMqlFacts {
  /** Migration path chosen in the first question; decides the waived conditions (#292) */
  platform?: string | null;
  industry: boolean;
  system: boolean;
  /** Company size against the target ranges (#150); omitted = no ranges set */
  companySize?: AxCompanySizeFit;
  consultationRequested: boolean;
  supportEnd?: string;
  /** Worst support status of the Access / Office versions (ended / ending / ...) */
  accessSupport?: string;
  /** Access answers that qualify the support end (#292) */
  access?: {
    importance?: string;
    users?: string;
    features?: readonly string[];
    location?: string;
  };
  role?: string;
  timeline?: string;
  leadScore: number;
}

export interface AxMqlJudgement {
  level: AxMqlLevel;
  /** 関心あり（MQL）: the lead's MQL date is set from this */
  qualified: boolean;
  /** 適合: the required conditions are met (kept as `candidate` for older readers) */
  candidate: boolean;
  criteria: {
    industry: boolean;
    system: boolean;
    action: boolean;
    /** Company size against the target ranges (#150) */
    companySize: AxCompanySizeFit;
  };
  /** Strong signals found (also when the required conditions are not met) */
  signals: AxMqlSignal[];
  /** Required conditions that are not met */
  unmet: AxMqlRequired[];
  /**
   * Required conditions this migration path does not require (#292): met whatever `criteria`
   * says. Results saved before #292 have none
   */
  waived: AxMqlRequired[];
}

const includes = (list: readonly string[], value: string | null | undefined) =>
  value !== undefined && value !== null && list.includes(value);

/** Required conditions the migration path does not require (#292) */
export function waivedConditions(
  platform: string | null | undefined,
  rules: Pick<AxMqlRules, 'anyIndustryPlatforms' | 'anySizePlatforms'>
): AxMqlRequired[] {
  return AX_MQL_REQUIRED.filter((key) =>
    key === 'industry'
      ? includes(rules.anyIndustryPlatforms, platform)
      : key === 'company_size'
        ? includes(rules.anySizePlatforms, platform)
        : false
  );
}

/** The Access support end counts only with an impact answer (#292) */
function accessSupportQualified(facts: AxMqlFacts, rules: AxMqlRules): boolean {
  const s = rules.strongSignals;
  if (!includes(s.accessSupport, facts.accessSupport)) return false;
  const access = facts.access ?? {};
  const w = s.accessSupportWith;
  return (
    includes(w.importance, access.importance) ||
    includes(w.users, access.users) ||
    (access.features ?? []).some((feature) => w.features.includes(feature)) ||
    includes(w.locations, access.location)
  );
}

/**
 * Judge MQL from the facts. Pure function.
 * `countWebDiagnosisAsMqlAction` is the rule before 2026-10-16 (fit alone made an MQL); it is
 * kept only to switch back.
 */
export function judgeAxMql(
  facts: AxMqlFacts,
  rules: AxMqlRules,
  countWebDiagnosisAsMqlAction = false
): AxMqlJudgement {
  const companySize = facts.companySize ?? 'not_configured';
  const waived = waivedConditions(facts.platform, rules);
  const met: Record<AxMqlRequired, boolean> = {
    industry: facts.industry,
    system: facts.system,
    company_size: companySize !== 'not_fit',
  };
  const unmet = AX_MQL_REQUIRED.filter((key) => !met[key] && !waived.includes(key));
  const fit = unmet.length === 0;
  const s = rules.strongSignals;
  const found: Record<AxMqlSignal, boolean> = {
    consultation: s.consultation && facts.consultationRequested,
    support_deadline:
      includes(s.supportEnd, facts.supportEnd) || accessSupportQualified(facts, rules),
    decision_role: includes(s.roles, facts.role),
    timeline_soon: includes(s.timelines, facts.timeline),
    min_score: rules.minScore !== null && facts.leadScore >= rules.minScore,
    web_diagnosis: countWebDiagnosisAsMqlAction,
  };
  const signals = AX_MQL_SIGNALS.filter((signal) => found[signal]);
  const action = signals.length > 0;
  const qualified = fit && action;
  return {
    level: qualified ? 'interest' : fit ? 'fit' : 'none',
    qualified,
    candidate: fit,
    criteria: { industry: facts.industry, system: facts.system, action, companySize },
    signals,
    unmet,
    waived,
  };
}

const COMPANY_SIZE_FITS: readonly AxCompanySizeFit[] = [
  'fit',
  'not_fit',
  'unknown',
  'not_configured',
];

const LEVEL_RANK: Record<AxMqlLevel, number> = { none: 0, fit: 1, interest: 2 };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const signalsOf = (value: unknown): AxMqlSignal[] =>
  Array.isArray(value) ? AX_MQL_SIGNALS.filter((signal) => value.includes(signal)) : [];

/**
 * Read a stored judgement (a submission's `result.mql`). Results saved before 2026-10-16 have
 * no `level`: their `qualified` meant fit only, so they read as `fit` / `none`.
 */
export function readAxMql(stored: unknown): AxMqlJudgement {
  const mql = isRecord(stored) ? stored : {};
  const criteria = isRecord(mql.criteria) ? mql.criteria : {};
  const industry = criteria.industry === true;
  const system = criteria.system === true;
  // Results saved before #150 have no company size: no ranges were set
  const companySize =
    COMPANY_SIZE_FITS.find((value) => value === criteria.companySize) ?? 'not_configured';
  const waived = Array.isArray(mql.waived)
    ? AX_MQL_REQUIRED.filter((key) => (mql.waived as unknown[]).includes(key))
    : [];
  const sizeMet = companySize !== 'not_fit' || waived.includes('company_size');
  const fit = sizeMet && (mql.candidate === true || (industry && system));
  const signals = signalsOf(mql.signals);
  const level: AxMqlLevel =
    typeof mql.level === 'string' && (AX_MQL_LEVELS as readonly string[]).includes(mql.level)
      ? (mql.level as AxMqlLevel)
      : fit
        ? 'fit'
        : 'none';
  return {
    level,
    qualified: level === 'interest',
    candidate: fit,
    criteria: { industry, system, action: signals.length > 0, companySize },
    signals,
    unmet: AX_MQL_REQUIRED.filter((key) =>
      key === 'company_size' ? !sizeMet : !(fit || criteria[key] === true || waived.includes(key))
    ),
    waived,
  };
}

/** The judgement with a consultation request added (相談申込 made after the result) */
export function withConsultationSignal(stored: unknown, rules: AxMqlRules): AxMqlJudgement {
  const mql = readAxMql(stored);
  if (!rules.strongSignals.consultation || mql.signals.includes('consultation')) return mql;
  const signals = AX_MQL_SIGNALS.filter((s) => s === 'consultation' || mql.signals.includes(s));
  const qualified = mql.candidate;
  return {
    ...mql,
    level: qualified ? 'interest' : 'none',
    qualified,
    criteria: { ...mql.criteria, action: true },
    signals,
  };
}

/** What a lead keeps of the judgement (in responses.axMigration.mql) */
export interface AxLeadMql {
  level: AxMqlLevel;
  signals: AxMqlSignal[];
  unmet: AxMqlRequired[];
}

export const toLeadMql = (mql: AxMqlJudgement): AxLeadMql => ({
  level: mql.level,
  signals: mql.signals,
  unmet: mql.unmet,
});

/**
 * The lead's judgement after another judgement for it (another system, a consultation request,
 * follow-up answers): the higher level wins, signals of the same level add up. A lead never
 * goes down a level here; sales and marketing change the MQL on the lead itself.
 */
export function mergeLeadMql(previous: unknown, next: AxLeadMql): AxLeadMql {
  if (!isRecord(previous) || typeof previous.level !== 'string') return next;
  const before: AxLeadMql = {
    level: (AX_MQL_LEVELS as readonly string[]).includes(previous.level)
      ? (previous.level as AxMqlLevel)
      : 'none',
    signals: signalsOf(previous.signals),
    unmet: Array.isArray(previous.unmet)
      ? AX_MQL_REQUIRED.filter((key) => (previous.unmet as unknown[]).includes(key))
      : [],
  };
  if (LEVEL_RANK[next.level] > LEVEL_RANK[before.level]) return next;
  if (LEVEL_RANK[next.level] < LEVEL_RANK[before.level]) return before;
  return {
    level: before.level,
    signals: AX_MQL_SIGNALS.filter((s) => before.signals.includes(s) || next.signals.includes(s)),
    unmet: AX_MQL_REQUIRED.filter((key) => before.unmet.includes(key) && next.unmet.includes(key)),
  };
}
