import type { TargetSystem } from '@/lib/features/leads/types/pipeline';
import { multiple, single, toPercent } from '../engine';
import type { DiagnosticAnswers } from '../types';
import {
  type AxCompanySizeResult,
  type AxTargetCompany,
  evaluateCompanySize,
} from './company-size';
import { AX_MIGRATION_CONFIG, type AxMigrationConfig } from './config';
import { AX_PLATFORMS, type AxPlatform, axMigrationDefinition } from './definition';
import { type AxMqlJudgement, judgeAxMql } from './mql';
import { technicalQuestions, unknownTechnicalQuestions } from './technical';

export type Level = 'low' | 'medium' | 'high';
export type ChallengeType = 'people' | 'cost' | 'agility' | 'data';

/** Keys of axDiagnosis.result.reasons (every key needs a message in each locale) */
export const AX_REASON_KEYS = [
  // difficulty
  'programs_large',
  'as400_tool',
  'rpg3',
  'source_missing',
  'source_vendor_held',
  'docs_outdated',
  'integrations_many',
  'acos_assembler',
  'access_many_screens',
  'access_vba',
  'access_many_tools',
  'access_compiled',
  'other_host',
  'small_scale',
  // urgency
  'support_passed',
  'support_within_1y',
  'support_1_3y',
  'maintenance_none',
  'maintenance_retiring',
  'maintenance_few',
  'maintenance_vendor',
  'access_no_maintainer',
  'access_single_maintainer',
  'access_support_ended',
  'access_support_ending',
  'access_company_impact',
  'access_cloud',
  'no_deadline',
] as const;
export type AxReasonKey = (typeof AX_REASON_KEYS)[number];

/** Keys of axDiagnosis.result.checkpoints (every key needs a message in each locale) */
export const AX_CHECKPOINT_KEYS = [
  'source_missing',
  'source_vendor_held',
  'support_deadline',
  'as400_tool',
  'as400_package',
  'as400_version',
  'rpg3',
  'docs_outdated',
  'integrations_many',
  'legacy_edi',
  'as400_devices',
  'as400_query',
  'gaiji',
  'as400_screens',
  'acos_assembler',
  'acos_charset',
  'acos_network_db',
  'acos_simple_language',
  'acos_online',
  'acos_batch',
  'access_no_maintainer',
  'access_support',
  'access_compiled',
  'access_inventory',
  'access_cloud',
  'access_vba',
  'access_external',
  'access_devices',
  'access_size',
  'access_excel',
  'access_web',
  'other_vb',
  'other_webperformer',
  'other_host',
  'other_inventory',
] as const;
export type AxCheckpointKey = (typeof AX_CHECKPOINT_KEYS)[number];

export interface AxMigrationResult {
  diagnosticVersion: number;
  /** Migration path chosen in the first question */
  platform: AxPlatform | null;
  /** 移行難易度の目安 */
  difficulty: { score: number; level: Level };
  /**
   * 刷新の緊急度: risks of keeping the system (deadlines, people). The respondent's own
   * timeline is not part of it, so "later" never reads as "not urgent" (2026-10-11 review)
   */
  urgency: { score: number; level: Level };
  /**
   * ヒト／カネ／モノ／情報 — the primary one drives the result message.
   * `selected` holds the categories the respondent chose (Access answers mapped onto them);
   * for hypothesis H1 use `selected`, not `primary` (ties favour people).
   * `primary` is null when the respondent sees no particular challenge.
   */
  challenges: {
    primary: ChallengeType | null;
    selected: string[];
    scores: Record<ChallengeType, number>;
  };
  /** What drove the levels (message keys), at most two each */
  reasons: { difficulty: AxReasonKey[]; urgency: AxReasonKey[] };
  /** What to check for this migration (message keys), at most four */
  checkpoints: AxCheckpointKey[];
  /** Lead score stored on leads.score (0-100) */
  leadScore: number;
  targetSystem: TargetSystem | null;
  /**
   * MQL (#139): `candidate` = 適合 (industry × system, and a company size not outside the
   * organization's target ranges, #150), `qualified` = 関心あり（MQL）
   * (fit + a strong signal or the minimum score). See mql.ts; rules in config.ts.
   */
  mql: AxMqlJudgement;
  /** Company size against the organization's target ranges (internal, never shown to the respondent) */
  companySize: AxCompanySizeResult;
  /** Hints for sales. SQL is decided by sales after the hearing: ①② required + ③ or ④ */
  sqlSignals: {
    candidate: boolean;
    systemKnown: boolean;
    problemAware: boolean;
    timelineVisible: boolean;
    decisionAccess: boolean;
  };
  /** Half or more of the technical answers are "I don't know": the estimate needs a hearing */
  needsHearing: boolean;
  /** Next step suggested to the respondent */
  recommendation: 'consultation' | 'information';
}

type Points = Record<string, number>;

/** Points for an answer; values a table does not list (and unanswered questions) count 0 */
function points(table: Points, value: string | undefined): number {
  return value !== undefined && value in table ? table[value] : 0;
}

/** Highest points a table can give (the denominator of a score) */
function tableMax(table: Points): number {
  return Math.max(...Object.values(table));
}

function sumCapped(table: Points, values: string[], cap: number): number {
  return Math.min(
    cap,
    values.reduce((sum, value) => sum + points(table, value), 0)
  );
}

function toLevel(score: number, mediumFrom: number, highFrom: number): Level {
  if (score >= highFrom) return 'high';
  if (score >= mediumFrom) return 'medium';
  return 'low';
}

const DIFFICULTY_MEDIUM = 35;
const DIFFICULTY_HIGH = 65;
const URGENCY_MEDIUM = 30;
const URGENCY_HIGH = 60;

// ── Shared by the server-based paths (AS/400, ACOS, other) ───────────────────────
// Weights from the AS/400 and ACOS specialist reviews (2026-10-11)
const SOURCE_DOCS: Points = {
  complete: 0,
  no_docs: 10,
  vendor_held: 14,
  source_missing: 20,
  unknown: 10,
};
const INTEGRATIONS: Points = { few: 0, some: 7, many: 15, unknown: 7 };
/** Who can change the system weighs most: a deadline can be extended, people cannot */
const MAINTENANCE: Points = { none: 40, retiring: 35, few: 25, vendor: 22, team: 5, unknown: 15 };
const SUPPORT_END: Points = {
  passed: 35,
  within_1y: 32,
  '1_3y': 22,
  beyond_3y: 5,
  no_hardware: 5,
  unknown: 15,
};
/** Self-reported challenges repeat what the questions above measure, so they add little */
const SERVER_CHALLENGES: Points = {
  people: 3,
  deadline: 3,
  blackbox: 2,
  cost: 2,
  agility: 0,
  data: 0,
  remote: 0,
  none: 0,
};
const SERVER_CHALLENGES_CAP = 5;
/** Phone-line EDI (INS Net) ends in December 2028 (NTT East) */
const LEGACY_EDI_URGENCY = 5;
/** Optional follow-ups: "I don't know" and skipping are neutral, answers move the score both ways */
const GAIJI: Points = { none: -2, few: 0, many: 3, unknown: 0 };
/** Business areas stand in for the size when the number of programs is unknown */
const BUSINESS_AREAS = ['sales', 'purchasing', 'inventory', 'production', 'accounting', 'hr'];

/** Size points from the number of business areas (1-2 / 3-4 / 5 or more) */
function businessAreaPoints(areas: string[]): number | undefined {
  const count = areas.filter((area) => BUSINESS_AREAS.includes(area)).length;
  if (count === 0) return undefined;
  if (count <= 2) return 6;
  return count <= 4 ? 18 : 28;
}

/** Several answers count as the hardest one */
function maxPoints(table: Points, values: string[]): number {
  return values.reduce((max, value) => Math.max(max, points(table, value)), 0);
}

// ── AS/400 (weights from the AS/400 specialist review, 2026-10-11) ──────────────────
const AS400 = {
  programs: { lt500: 0, '500_1999': 12, '2000_4999': 24, gte5000: 35, unknown: 18 },
  /** A package is a different approach (customizations first), not a size */
  languages: { rpg3: 10, rpg4: 3, cobol: 8, tool: 15, package: 0, other: 5, unknown: 8 },
  screensForms: { lt300: -4, '300_999': 0, gte1000: 5, unknown: 0 },
  devices: { special_paper: 2, labels: 1, handheld: 2, none: -1, unknown: 0 },
  devicesCap: 4,
  query: { few: -1, some: 1, many: 3, unknown: 0 },
  /** IBM i 7.5 / 7.6 are under standard support; 7.4 standard support ended 2026-09-30 */
  version: { le72: 5, v73_74: 2, v75_76: -5, unknown: 0 },
};

// ── NEC ACOS (weights from the ACOS specialist review, 2026-10-11) ─────────────────
const ACOS = {
  /** Character codes (JIPS), packed decimals, MFDL screens and JCL always need converting */
  base: 15,
  programs: { lt1000: 4, '1000_2999': 14, '3000_9999': 24, gte10000: 30 },
  /** An unknown number of programs is estimated from the series */
  programsBySeries: { acos2: 10, acos4: 19, unknown: 15 },
  languages: { cobol_only: 0, assembler: 15, simple: 8, other: 6, unknown: 6 },
  exchanges: { internal: 1, edi: 2, legacy_edi: 2, web: 1, few: -2, unknown: 0 },
  exchangesCap: 5,
  screensForms: { lt300: -3, '300_999': 0, '1000_2999': 2, gte3000: 4, unknown: 0 },
  jobs: { lt300: -2, '300_999': 0, '1000_2999': 2, gte3000: 4, unknown: 0 },
  database: { adbs: 5, riqs: 1, files: 0, unknown: 0 },
  /** NEC keeps ACOS going (new models, cloud), so a contract boundary forces less than elsewhere */
  supportEnd: { passed: 25, within_1y: 22, '1_3y': 14, beyond_3y: 4, no_hardware: 3, unknown: 10 },
};

// ── Microsoft Access (weights from the Access specialist review, 2026-10-11) ────────
const ACCESS = {
  screensForms: { lt20: 5, '20_50': 12, '51_100': 19, gte101: 25, unknown: 14 },
  features: {
    vba: 12,
    external_data: 6,
    devices: 5,
    excel: 4,
    other_apps: 3,
    unknown: 5,
    none: 0,
  },
  featuresCap: 30,
  tools: { '1': 0, '2_5': 4, '6_20': 8, '21_50': 12, gte51: 15, unknown: 8 },
  maintainerDifficulty: { nobody: 5, unknown: 2 },
  vbaAmount: { few: -3, light: 2, heavy: 10, unknown: 0 },
  sources: { complete: -2, no_docs: 4, compiled: 10, unknown: 0 },
  sizeDifficulty: { lt1gb: 0, gte1gb: 5, split: 5, unknown: 0 },
  difficultyMax: 25 + 30 + 15 + 5,
  maintainerUrgency: { nobody: 30, individual: 20, one: 18, vendor: 8, team: 3, unknown: 15 },
  support: { ended: 25, ending: 20, v2024: 8, m365: 3, unknown: 12 },
  challenges: { support: 6, people: 4, stability: 4, manual: 2, remote: 2, data: 2, none: 0 },
  challengesCap: 10,
  importance: { support: 4, main: 12, company: 20, unknown: 0 },
  /** Shared folders work for a few people; OneDrive / SharePoint is advised against by Microsoft */
  location: { cloud: 15, shared_folder: 5, local_pc: 6, database: 2, unknown: 0 },
  locationManyUsers: 10,
  sizeUrgency: { lt1gb: 0, gte1gb: 5, split: 5, unknown: 0 },
  operationCap: 15,
  urgencyMax: 30 + 25 + 10,
};

/**
 * End of support of the Access / Office versions (Microsoft lifecycle, checked 2026-10-11).
 * Statuses are computed from these dates, so the result never goes stale.
 */
const ACCESS_SUPPORT_END: Record<string, string | null> = {
  le2013: '2023-04-11',
  v2016_2019: '2025-10-14',
  v2021: '2026-10-13',
  v2024: '2029-10-09',
  m365: null,
};
const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_MS = 365 * DAY_MS;

type AccessSupport = 'ended' | 'ending' | 'v2024' | 'm365' | 'unknown';

/** The weakest support among the versions in use */
function accessSupport(versions: string[], now: Date): AccessSupport | undefined {
  if (versions.length === 0) return undefined;
  if (versions.includes('unknown')) return 'unknown';
  let worst: AccessSupport = 'm365';
  const rank: Record<AccessSupport, number> = {
    ended: 4,
    ending: 3,
    v2024: 2,
    unknown: 1,
    m365: 0,
  };
  for (const version of versions) {
    const end = ACCESS_SUPPORT_END[version];
    let status: AccessSupport = version === 'v2024' ? 'v2024' : 'm365';
    if (end) {
      // Microsoft still ships updates on the end date, so support ends when that day is over
      const remaining = new Date(`${end}T00:00:00+09:00`).getTime() + DAY_MS - now.getTime();
      if (remaining <= 0) status = 'ended';
      else if (remaining <= YEAR_MS) status = 'ending';
    }
    if (rank[status] > rank[worst]) worst = status;
  }
  return worst;
}

// ── Other / not sure ──────────────────────────────────────────────────────────────
const OTHER = {
  system: {
    vb: 12,
    webperformer: 12,
    other_low_code: 15,
    office_computer: 20,
    mainframe: 24,
    package: 10,
    unknown: 15,
  },
  programs: { lt300: 8, '300_999': 18, gte1000: 30, unknown: 18 },
};

const LEAD_SCORE_POINTS = {
  timeline: { within_1y: 20, '1_2y': 15, '2_3y': 8, beyond_3y: 2, undecided: 3 },
  role: {
    executive: 10,
    it_manager: 10,
    it_staff: 6,
    business_manager: 8,
    business_staff: 4,
    other: 2,
  },
} as const;

/** Challenge answers of the server-based paths map onto the four result categories */
const SERVER_CHALLENGE_CATEGORY: Record<string, ChallengeType> = {
  people: 'people',
  blackbox: 'people',
  cost: 'cost',
  deadline: 'agility',
  agility: 'agility',
  remote: 'agility',
  data: 'data',
};

/** Access challenge answers map onto the four result categories */
const ACCESS_CHALLENGE_CATEGORY: Record<string, ChallengeType> = {
  people: 'people',
  manual: 'cost',
  stability: 'agility',
  remote: 'agility',
  support: 'agility',
  data: 'data',
};

const CHALLENGE_ORDER: ChallengeType[] = ['people', 'cost', 'agility', 'data'];
/** Share of "I don't know" among the technical required answers that triggers needsHearing */
const NEEDS_HEARING_RATIO = 0.5;
/** A reason is shown when its answer contributed at least this many points */
const REASON_MIN_POINTS = 10;
const MAX_REASONS = 2;
const MAX_CHECKPOINTS = 4;

interface Weighted {
  key: AxReasonKey;
  points: number;
}

function topReasons(candidates: Weighted[]): AxReasonKey[] {
  return candidates
    .filter((c) => c.points >= REASON_MIN_POINTS)
    .sort((a, b) => b.points - a.points)
    .slice(0, MAX_REASONS)
    .map((c) => c.key);
}

/**
 * Points tables by question. Tests check that every option has a weight (0 when it is meant
 * to add nothing), so a new or renamed option cannot drop out of the score unnoticed.
 */
export const AX_POINT_TABLES: Record<string, { tables: Points[]; except?: string[] }> = {
  maintenance: { tables: [MAINTENANCE] },
  support_end: { tables: [SUPPORT_END, ACOS.supportEnd] },
  integrations: { tables: [INTEGRATIONS] },
  source_docs: { tables: [SOURCE_DOCS] },
  gaiji: { tables: [GAIJI] },
  challenges: { tables: [SERVER_CHALLENGES] },
  as400_programs: { tables: [AS400.programs] },
  as400_languages: { tables: [AS400.languages] },
  as400_screens_forms: { tables: [AS400.screensForms] },
  as400_devices: { tables: [AS400.devices] },
  as400_query: { tables: [AS400.query] },
  as400_version: { tables: [AS400.version] },
  acos_series: { tables: [ACOS.programsBySeries] },
  // An unknown number of programs is estimated from the series or the business areas
  acos_programs: { tables: [ACOS.programs], except: ['unknown'] },
  acos_languages: { tables: [ACOS.languages] },
  acos_integrations: { tables: [ACOS.exchanges] },
  acos_screens_forms: { tables: [ACOS.screensForms] },
  acos_jobs: { tables: [ACOS.jobs] },
  acos_database: { tables: [ACOS.database] },
  access_tools: { tables: [ACCESS.tools] },
  access_screens_forms: { tables: [ACCESS.screensForms] },
  access_features: { tables: [ACCESS.features] },
  access_maintainer: { tables: [ACCESS.maintainerUrgency] },
  access_location: { tables: [ACCESS.location] },
  access_importance: { tables: [ACCESS.importance] },
  access_vba_amount: { tables: [ACCESS.vbaAmount] },
  access_sources: { tables: [ACCESS.sources] },
  access_size: { tables: [ACCESS.sizeDifficulty, ACCESS.sizeUrgency] },
  access_challenges: { tables: [ACCESS.challenges] },
  other_system: { tables: [OTHER.system] },
  other_programs: { tables: [OTHER.programs] },
  timeline: { tables: [LEAD_SCORE_POINTS.timeline] },
  role: { tables: [LEAD_SCORE_POINTS.role] },
};

function platformOf(answers: DiagnosticAnswers): AxPlatform | null {
  const value = single(answers, 'platform');
  return (AX_PLATFORMS as readonly string[]).includes(value ?? '') ? (value as AxPlatform) : null;
}

function deriveTargetSystem(
  platform: AxPlatform | null,
  otherSystem: string | undefined
): TargetSystem | null {
  if (platform === 'as400' || platform === 'acos' || platform === 'access') return platform;
  if (platform !== 'other') return null;
  if (otherSystem === 'vb' || otherSystem === 'webperformer') return otherSystem;
  if (otherSystem === 'office_computer' || otherSystem === 'mainframe') return 'other_legacy';
  if (otherSystem === 'other_low_code' || otherSystem === 'package') return 'other';
  return null;
}

/**
 * Evaluate validated answers. Pure function: no I/O, deterministic for a given `now`
 * (used for the Access / Office support dates).
 */
export function evaluateAxMigration(
  answers: DiagnosticAnswers,
  config: AxMigrationConfig = AX_MIGRATION_CONFIG,
  now: Date = new Date(),
  /** What the respondent did besides answering (the consultation request is not an answer) */
  actions: { consultationRequested?: boolean } = {},
  /** Target company size ranges of the organization (sales playbook); null when not set */
  targetCompany: AxTargetCompany | null = null
): AxMigrationResult {
  const platform = platformOf(answers);
  const challenges = multiple(answers, 'challenges');
  const accessChallenges = multiple(answers, 'access_challenges');
  const timeline = single(answers, 'timeline');
  const industry = single(answers, 'industry');
  const role = single(answers, 'role');
  const maintenance = single(answers, 'maintenance');
  const supportEnd = single(answers, 'support_end');
  const integrations = single(answers, 'integrations');
  const sourceDocs = single(answers, 'source_docs');
  const gaiji = single(answers, 'gaiji');
  const otherSystem = single(answers, 'other_system');
  const accessMaintainer = single(answers, 'access_maintainer');
  const accessFeatures = multiple(answers, 'access_features');
  const support = accessSupport(multiple(answers, 'access_version'), now);

  const difficultyReasons: Weighted[] = [];
  const urgencyReasons: Weighted[] = [];
  const checkpoints: AxCheckpointKey[] = [];

  let difficultyRaw = 0;
  let difficultyMax = 1;
  let urgencyRaw = 0;
  let urgencyMax = 1;
  /** Combinations that must not read lower than this, whatever the sum */
  let difficultyFloor = 0;
  let urgencyFloor = 0;

  const sharedDifficulty = ({ withIntegrations }: { withIntegrations: boolean }) => {
    const docs = points(SOURCE_DOCS, sourceDocs);
    if (sourceDocs === 'source_missing') {
      difficultyReasons.push({ key: 'source_missing', points: docs });
    }
    if (sourceDocs === 'vendor_held') {
      difficultyReasons.push({ key: 'source_vendor_held', points: docs });
    }
    if (sourceDocs === 'no_docs') difficultyReasons.push({ key: 'docs_outdated', points: docs });
    // Missing source, or no documents and nobody to ask, is never an easy migration
    if (sourceDocs === 'source_missing' || (sourceDocs === 'no_docs' && maintenance === 'none')) {
      difficultyFloor = DIFFICULTY_MEDIUM;
    }
    if (!withIntegrations) return docs;
    const links = points(INTEGRATIONS, integrations);
    if (integrations === 'many') {
      difficultyReasons.push({ key: 'integrations_many', points: links });
    }
    return docs + links;
  };

  const serverUrgency = (supportTable: Points, legacyEdi: boolean) => {
    const deadline = points(supportTable, supportEnd);
    const upkeep = points(MAINTENANCE, maintenance);
    if (supportEnd === 'passed') urgencyReasons.push({ key: 'support_passed', points: deadline });
    if (supportEnd === 'within_1y') {
      urgencyReasons.push({ key: 'support_within_1y', points: deadline });
    }
    if (supportEnd === '1_3y') urgencyReasons.push({ key: 'support_1_3y', points: deadline });
    if (maintenance === 'none') urgencyReasons.push({ key: 'maintenance_none', points: upkeep });
    if (maintenance === 'retiring') {
      urgencyReasons.push({ key: 'maintenance_retiring', points: upkeep });
    }
    if (maintenance === 'few') urgencyReasons.push({ key: 'maintenance_few', points: upkeep });
    if (maintenance === 'vendor')
      urgencyReasons.push({ key: 'maintenance_vendor', points: upkeep });
    urgencyMax = tableMax(MAINTENANCE) + tableMax(supportTable) + SERVER_CHALLENGES_CAP;
    const deadlineWithin3y =
      supportEnd === 'passed' || supportEnd === 'within_1y' || supportEnd === '1_3y';
    // Nobody can change it, or the last people leave before the deadline
    if (maintenance === 'none' || (maintenance === 'retiring' && deadlineWithin3y)) {
      urgencyFloor = URGENCY_HIGH;
    } else if (supportEnd === 'passed' || supportEnd === 'within_1y') {
      urgencyFloor = URGENCY_MEDIUM;
    }
    return (
      deadline +
      upkeep +
      sumCapped(SERVER_CHALLENGES, challenges, SERVER_CHALLENGES_CAP) +
      (legacyEdi ? LEGACY_EDI_URGENCY : 0)
    );
  };

  // Checkpoints shared by the server-based paths, in order of importance
  const serverCheckpoints = () => {
    if (sourceDocs === 'source_missing') checkpoints.push('source_missing');
    if (sourceDocs === 'vendor_held') checkpoints.push('source_vendor_held');
    if (supportEnd === 'passed' || supportEnd === 'within_1y') checkpoints.push('support_deadline');
  };

  /** Points for the size, or the estimate from the business areas when it is unknown */
  const sizePoints = (table: Points, programs: string | undefined, fallback?: number) => {
    if (programs !== 'unknown') return points(table, programs);
    return (
      businessAreaPoints(multiple(answers, 'business_areas')) ?? fallback ?? points(table, programs)
    );
  };

  if (platform === 'as400') {
    const programs = single(answers, 'as400_programs');
    const languages = multiple(answers, 'as400_languages');
    const devices = multiple(answers, 'as400_devices');
    const query = single(answers, 'as400_query');
    const legacyEdi = single(answers, 'legacy_edi') === 'yes';
    const programPoints = sizePoints(AS400.programs, programs);
    if (programs === '2000_4999' || programs === 'gte5000') {
      difficultyReasons.push({ key: 'programs_large', points: programPoints });
    }
    if (languages.includes('tool')) {
      difficultyReasons.push({ key: 'as400_tool', points: AS400.languages.tool });
    }
    if (languages.includes('rpg3')) {
      difficultyReasons.push({ key: 'rpg3', points: AS400.languages.rpg3 });
    }
    difficultyRaw =
      programPoints +
      maxPoints(AS400.languages, languages) +
      sharedDifficulty({ withIntegrations: true }) +
      points(AS400.screensForms, single(answers, 'as400_screens_forms')) +
      sumCapped(AS400.devices, devices, AS400.devicesCap) +
      points(AS400.query, query) +
      points(GAIJI, gaiji);
    difficultyMax =
      tableMax(AS400.programs) +
      tableMax(AS400.languages) +
      tableMax(SOURCE_DOCS) +
      tableMax(INTEGRATIONS);

    const version = single(answers, 'as400_version');
    urgencyRaw = serverUrgency(SUPPORT_END, legacyEdi) + points(AS400.version, version);

    serverCheckpoints();
    if (languages.includes('tool')) checkpoints.push('as400_tool');
    if (languages.includes('package')) checkpoints.push('as400_package');
    if (version === 'le72' || version === 'v73_74') checkpoints.push('as400_version');
    if (languages.includes('rpg3')) checkpoints.push('rpg3');
    if (sourceDocs === 'no_docs') checkpoints.push('docs_outdated');
    if (integrations === 'many') checkpoints.push('integrations_many');
    if (legacyEdi) checkpoints.push('legacy_edi');
    if (devices.some((device) => device !== 'none' && device !== 'unknown')) {
      checkpoints.push('as400_devices');
    }
    if (query === 'some' || query === 'many') checkpoints.push('as400_query');
    if (gaiji === 'few' || gaiji === 'many') checkpoints.push('gaiji');
    checkpoints.push('as400_screens');
  } else if (platform === 'acos') {
    const series = single(answers, 'acos_series');
    const programs = single(answers, 'acos_programs');
    const languages = multiple(answers, 'acos_languages');
    const exchanges = multiple(answers, 'acos_integrations');
    const database = multiple(answers, 'acos_database');
    const legacyEdi = exchanges.includes('legacy_edi');
    const programPoints = sizePoints(
      ACOS.programs,
      programs,
      points(ACOS.programsBySeries, series ?? 'unknown')
    );
    if (programs === '3000_9999' || programs === 'gte10000') {
      difficultyReasons.push({ key: 'programs_large', points: programPoints });
    }
    if (languages.includes('assembler')) {
      difficultyReasons.push({ key: 'acos_assembler', points: ACOS.languages.assembler });
    }
    difficultyRaw =
      ACOS.base +
      programPoints +
      maxPoints(ACOS.languages, languages) +
      sharedDifficulty({ withIntegrations: false }) +
      sumCapped(ACOS.exchanges, exchanges, ACOS.exchangesCap) +
      points(ACOS.screensForms, single(answers, 'acos_screens_forms')) +
      points(ACOS.jobs, single(answers, 'acos_jobs')) +
      maxPoints(ACOS.database, database) +
      points(GAIJI, gaiji);
    difficultyMax =
      ACOS.base + tableMax(ACOS.programs) + tableMax(ACOS.languages) + tableMax(SOURCE_DOCS);
    urgencyRaw = serverUrgency(ACOS.supportEnd, legacyEdi);

    serverCheckpoints();
    if (languages.includes('assembler')) checkpoints.push('acos_assembler');
    checkpoints.push('acos_charset');
    if (database.includes('adbs')) checkpoints.push('acos_network_db');
    if (languages.includes('simple')) checkpoints.push('acos_simple_language');
    if (sourceDocs === 'no_docs') checkpoints.push('docs_outdated');
    const exchangeKinds = exchanges.filter((e) => e !== 'few' && e !== 'unknown');
    if (exchanges.includes('edi') || exchangeKinds.length >= 2) {
      checkpoints.push('integrations_many');
    }
    if (legacyEdi) checkpoints.push('legacy_edi');
    checkpoints.push('acos_online', 'acos_batch');
  } else if (platform === 'access') {
    const tools = single(answers, 'access_tools');
    const screens = single(answers, 'access_screens_forms');
    const sources = single(answers, 'access_sources');
    const size = single(answers, 'access_size');
    const location = single(answers, 'access_location');
    const users = single(answers, 'access_users');
    const importance = single(answers, 'access_importance');

    const screenPoints = points(ACCESS.screensForms, screens);
    const toolPoints = points(ACCESS.tools, tools);
    const sourcePoints = points(ACCESS.sources, sources);
    if (screens === '51_100' || screens === 'gte101') {
      difficultyReasons.push({ key: 'access_many_screens', points: screenPoints });
    }
    if (accessFeatures.includes('vba')) {
      difficultyReasons.push({ key: 'access_vba', points: ACCESS.features.vba });
    }
    if (tools === '21_50' || tools === 'gte51') {
      difficultyReasons.push({ key: 'access_many_tools', points: toolPoints });
    }
    if (sources === 'compiled')
      difficultyReasons.push({ key: 'access_compiled', points: sourcePoints });
    difficultyRaw =
      screenPoints +
      sumCapped(ACCESS.features, accessFeatures, ACCESS.featuresCap) +
      toolPoints +
      points(ACCESS.maintainerDifficulty, accessMaintainer) +
      points(ACCESS.vbaAmount, single(answers, 'access_vba_amount')) +
      sourcePoints +
      points(ACCESS.sizeDifficulty, size);
    difficultyMax = ACCESS.difficultyMax;

    const maintainerPoints = points(ACCESS.maintainerUrgency, accessMaintainer);
    // Only entry / search / printing: updating Office may be enough, so support weighs half
    const supportPoints =
      points(ACCESS.support, support) * (accessFeatures.includes('none') ? 0.5 : 1);
    const importancePoints = points(ACCESS.importance, importance);
    const manyUsers = users === '11_30' || users === 'gte31';
    const locationPoints =
      location === 'shared_folder' && manyUsers
        ? ACCESS.locationManyUsers
        : points(ACCESS.location, location);
    const operationPoints = Math.min(
      ACCESS.operationCap,
      locationPoints + points(ACCESS.sizeUrgency, size)
    );
    if (accessMaintainer === 'nobody') {
      urgencyReasons.push({ key: 'access_no_maintainer', points: maintainerPoints });
    }
    if (accessMaintainer === 'one' || accessMaintainer === 'individual') {
      urgencyReasons.push({ key: 'access_single_maintainer', points: maintainerPoints });
    }
    if (support === 'ended')
      urgencyReasons.push({ key: 'access_support_ended', points: supportPoints });
    if (support === 'ending')
      urgencyReasons.push({ key: 'access_support_ending', points: supportPoints });
    if (importance === 'company') {
      urgencyReasons.push({ key: 'access_company_impact', points: importancePoints });
    }
    if (location === 'cloud') urgencyReasons.push({ key: 'access_cloud', points: locationPoints });
    urgencyRaw =
      maintainerPoints +
      supportPoints +
      sumCapped(ACCESS.challenges, accessChallenges, ACCESS.challengesCap) +
      importancePoints +
      operationPoints;
    urgencyMax = ACCESS.urgencyMax;
    if (accessMaintainer === 'nobody' && importance === 'company') urgencyFloor = URGENCY_HIGH;
    else if (location === 'cloud' && users !== undefined && users !== '1_2') {
      urgencyFloor = URGENCY_MEDIUM;
    } else if (
      support === 'ended' &&
      (accessFeatures.includes('vba') || accessFeatures.includes('devices'))
    ) {
      urgencyFloor = URGENCY_MEDIUM;
    }

    if (accessMaintainer === 'nobody') checkpoints.push('access_no_maintainer');
    if (support === 'ended' || support === 'ending') checkpoints.push('access_support');
    if (sources === 'compiled') checkpoints.push('access_compiled');
    if (tools === '6_20' || tools === '21_50' || tools === 'gte51') {
      checkpoints.push('access_inventory');
    }
    if (location === 'cloud') checkpoints.push('access_cloud');
    if (accessFeatures.includes('vba')) checkpoints.push('access_vba');
    if (accessFeatures.includes('external_data')) checkpoints.push('access_external');
    if (accessFeatures.includes('devices')) checkpoints.push('access_devices');
    if (size === 'gte1gb' || size === 'split') checkpoints.push('access_size');
    if (accessFeatures.includes('excel')) checkpoints.push('access_excel');
    checkpoints.push('access_web');
  } else if (platform === 'other') {
    const programs = single(answers, 'other_programs');
    const legacyEdi = single(answers, 'legacy_edi') === 'yes';
    const systemPoints = points(OTHER.system, otherSystem);
    const programPoints = sizePoints(OTHER.programs, programs);
    if (otherSystem === 'mainframe' || otherSystem === 'office_computer') {
      difficultyReasons.push({ key: 'other_host', points: systemPoints });
    }
    if (programs === 'gte1000') {
      difficultyReasons.push({ key: 'programs_large', points: programPoints });
    }
    difficultyRaw = systemPoints + programPoints + sharedDifficulty({ withIntegrations: true });
    difficultyMax =
      tableMax(OTHER.system) +
      tableMax(OTHER.programs) +
      tableMax(SOURCE_DOCS) +
      tableMax(INTEGRATIONS);
    urgencyRaw = serverUrgency(SUPPORT_END, legacyEdi);

    serverCheckpoints();
    if (otherSystem === 'vb') checkpoints.push('other_vb');
    if (otherSystem === 'webperformer') checkpoints.push('other_webperformer');
    if (otherSystem === 'office_computer' || otherSystem === 'mainframe') {
      checkpoints.push('other_host');
    }
    if (sourceDocs === 'no_docs') checkpoints.push('docs_outdated');
    if (integrations === 'many') checkpoints.push('integrations_many');
    if (legacyEdi) checkpoints.push('legacy_edi');
    checkpoints.push('other_inventory');
  }

  const sizeQuestion =
    platform === 'access'
      ? 'access_screens_forms'
      : platform === 'other'
        ? 'other_programs'
        : `${platform}_programs`;
  const sizeKnown = single(answers, sizeQuestion) !== 'unknown';
  const difficultyScore = Math.max(difficultyFloor, toPercent(difficultyRaw, difficultyMax));
  const urgencyScore = Math.max(urgencyFloor, toPercent(urgencyRaw, urgencyMax));
  const difficultyLevel = toLevel(difficultyScore, DIFFICULTY_MEDIUM, DIFFICULTY_HIGH);
  const urgencyLevel = toLevel(urgencyScore, URGENCY_MEDIUM, URGENCY_HIGH);

  const reasons = {
    difficulty: topReasons(difficultyReasons),
    urgency: topReasons(urgencyReasons),
  };
  // "Small" is said only when the size itself was answered
  if (reasons.difficulty.length === 0 && difficultyLevel === 'low' && sizeKnown) {
    reasons.difficulty = ['small_scale'];
  }
  if (reasons.urgency.length === 0 && urgencyLevel === 'low') reasons.urgency = ['no_deadline'];

  // 主な課題（ヒト／カネ／モノ／情報）: every path's answers map onto the same four categories
  const felt = new Set<ChallengeType>([
    ...challenges.flatMap((c) =>
      SERVER_CHALLENGE_CATEGORY[c] ? [SERVER_CHALLENGE_CATEGORY[c]] : []
    ),
    ...accessChallenges.flatMap((c) =>
      ACCESS_CHALLENGE_CATEGORY[c] ? [ACCESS_CHALLENGE_CATEGORY[c]] : []
    ),
  ]);
  const upkeepAtRisk =
    maintenance === 'few' ||
    maintenance === 'retiring' ||
    maintenance === 'none' ||
    accessMaintainer === 'nobody' ||
    accessMaintainer === 'one' ||
    accessMaintainer === 'individual';
  const challengeScores: Record<ChallengeType, number> = {
    people: (felt.has('people') ? 3 : 0) + (upkeepAtRisk ? 2 : 0),
    cost:
      (felt.has('cost') ? 3 : 0) +
      (supportEnd === 'passed' ? 1 : 0) +
      (maintenance === 'vendor' ? 1 : 0),
    agility: felt.has('agility') ? 3 : 0,
    data: felt.has('data') ? 3 : 0,
  };
  const best = CHALLENGE_ORDER.reduce((top, type) =>
    challengeScores[type] > challengeScores[top] ? type : top
  );
  // "No particular challenges" with nothing else pointing at one: no primary challenge
  const primary = challengeScores[best] > 0 ? best : null;

  // MQL の必須条件（業種 × システム × 企業規模）。シグナルとの判定はリードスコアの後で行う
  const companySize = evaluateCompanySize(answers, targetCompany);
  const mqlCriteria = {
    industry: industry !== undefined && config.targetIndustries.includes(industry),
    system:
      (platform !== null && config.legacyPlatforms.includes(platform)) ||
      (platform === 'other' &&
        otherSystem !== undefined &&
        config.legacyOtherSystems.includes(otherSystem)),
  };
  // The respondent's next step uses industry × system only, never the confidential size ranges
  const mqlCandidate = mqlCriteria.industry && mqlCriteria.system;

  // SQL の手がかり（①②必須＋③④のいずれか）: ① machine, language and rough size are known
  const known = (value: string | undefined) => value !== undefined && value !== 'unknown';
  const knownAll = (values: string[]) => values.length > 0 && !values.includes('unknown');
  const systemKnown =
    platform === 'as400'
      ? known(single(answers, 'as400_programs')) && knownAll(multiple(answers, 'as400_languages'))
      : platform === 'acos'
        ? known(single(answers, 'acos_series')) &&
          known(single(answers, 'acos_programs')) &&
          knownAll(multiple(answers, 'acos_languages'))
        : platform === 'access'
          ? known(single(answers, 'access_tools')) && known(single(answers, 'access_screens_forms'))
          : platform === 'other'
            ? known(otherSystem) && known(single(answers, 'other_programs'))
            : false;
  const problemAware =
    challenges.some(
      (c) => c === 'people' || c === 'blackbox' || c === 'cost' || c === 'deadline'
    ) ||
    accessChallenges.some((c) => c === 'people' || c === 'manual' || c === 'support') ||
    supportEnd === 'passed' ||
    supportEnd === 'within_1y' ||
    support === 'ended' ||
    support === 'ending';
  const timelineVisible = timeline !== undefined && config.sqlTimelines.includes(timeline);
  const decisionAccess = role !== undefined && config.decisionAccessRoles.includes(role);

  // Lead score (fit + intent)
  const systemFit = mqlCriteria.system
    ? 20
    : platform === 'other' && otherSystem === 'unknown'
      ? 8
      : 3;
  const leadScore = Math.min(
    100,
    (mqlCriteria.industry ? 20 : 5) +
      systemFit +
      Math.round(urgencyScore * 0.2) +
      points(LEAD_SCORE_POINTS.timeline, timeline) +
      points(LEAD_SCORE_POINTS.role, role)
  );

  // 適合 / 関心あり（MQL）
  const mql = judgeAxMql(
    {
      ...mqlCriteria,
      companySize: companySize.fit,
      consultationRequested: actions.consultationRequested === true,
      supportEnd,
      accessSupport: support,
      role,
      timeline,
      leadScore,
    },
    config.mql,
    config.countWebDiagnosisAsMqlAction
  );

  // "I don't know" on the technical required questions of the chosen path
  const technical = technicalQuestions(answers);
  const unknowns = unknownTechnicalQuestions(answers).length;
  const needsHearing = technical.length > 0 && unknowns / technical.length >= NEEDS_HEARING_RATIO;

  return {
    diagnosticVersion: axMigrationDefinition.version,
    platform,
    difficulty: { score: difficultyScore, level: difficultyLevel },
    urgency: { score: urgencyScore, level: urgencyLevel },
    challenges: {
      primary,
      selected: [...felt],
      scores: challengeScores,
    },
    reasons,
    checkpoints: [...new Set(checkpoints)].slice(0, MAX_CHECKPOINTS),
    leadScore,
    targetSystem: deriveTargetSystem(platform, otherSystem),
    mql,
    companySize,
    sqlSignals: {
      candidate: systemKnown && problemAware && (timelineVisible || decisionAccess),
      systemKnown,
      problemAware,
      timelineVisible,
      decisionAccess,
    },
    needsHearing,
    recommendation:
      mqlCandidate || difficultyLevel === 'high' || urgencyLevel === 'high'
        ? 'consultation'
        : 'information',
  };
}

/** Part of the result shown to the respondent (no lead score or MQL/SQL judgement) */
export type AxMigrationPublicResult = Pick<
  AxMigrationResult,
  | 'platform'
  | 'difficulty'
  | 'urgency'
  | 'challenges'
  | 'reasons'
  | 'checkpoints'
  | 'needsHearing'
  | 'recommendation'
>;

export function toPublicResult(result: AxMigrationResult): AxMigrationPublicResult {
  return {
    platform: result.platform,
    difficulty: result.difficulty,
    urgency: result.urgency,
    challenges: result.challenges,
    reasons: result.reasons,
    checkpoints: result.checkpoints,
    needsHearing: result.needsHearing,
    recommendation: result.recommendation,
  };
}
