/**
 * Recommended way forward for an Access tool (Refs #303, owner decision 2026-10-21 on #158)
 *
 * Three paths: fix it and keep using it (`fix`), move it to the web (`web`), or replace it with
 * an off-the-shelf service (`replace`). The result is a guide only: the path is decided together
 * in the consultation, after looking at the tool itself.
 *
 * Order of the rules:
 * 1. `web` when any web condition holds (many users, company-wide impact, remote use or records
 *    and permissions, a shared file that breaks under several users, data near the size limit,
 *    many tools to bring together).
 * 2. `replace` when the tool is mainly entry, search and printing (no VBA automation, no links
 *    to other data, software or devices), with few screens and reports and no heavy VBA.
 * 3. `fix` otherwise.
 * Too many "I don't know" answers still give a path, with a reason to check it in the
 * consultation. The values live in config.ts (AX_MIGRATION_CONFIG.accessPath).
 */

export const AX_ACCESS_PATHS = ['fix', 'web', 'replace'] as const;
export type AxAccessPath = (typeof AX_ACCESS_PATHS)[number];

/** Keys of axDiagnosis.result.accessPath.reasons (every key needs a message in each locale) */
export const AX_ACCESS_PATH_REASONS = [
  // web
  'many_users',
  'company_impact',
  'remote',
  'audit',
  'shared_stability',
  'data_limit',
  'many_tools',
  // replace
  'simple_features',
  'few_screens',
  'light_vba',
  // fix
  'office_update',
  'support_end',
  'few_users',
  'rules_in_tool',
  'keep_current',
  // any path
  'check_unknowns',
] as const;
export type AxAccessPathReason = (typeof AX_ACCESS_PATH_REASONS)[number];

export interface AxAccessPathResult {
  path: AxAccessPath;
  /** Why, most telling first: two or three keys */
  reasons: AxAccessPathReason[];
}

/** Answer values for each rule; an empty list turns that rule off */
export interface AxAccessPathRules {
  web: {
    /** access_users */
    users: readonly string[];
    /** access_importance */
    importance: readonly string[];
    /** access_challenges: use from home or other sites */
    remoteChallenges: readonly string[];
    /** access_challenges: records of who saw or changed what, and permissions */
    controlChallenges: readonly string[];
    /** A shared file that breaks: the challenge, with this many users, on these locations */
    stability: {
      challenge: string;
      users: readonly string[];
      locations: readonly string[];
    };
    /** access_size */
    sizes: readonly string[];
    /** access_tools */
    tools: readonly string[];
  };
  replace: {
    /** access_features: every chosen value is in this list (mainly entry, search and printing) */
    features: readonly string[];
    /** access_screens_forms */
    screens: readonly string[];
    /** access_vba_amount values that rule replacing out (unanswered does not) */
    blockingVbaAmounts: readonly string[];
  };
  /** Not conditions: the answers that explain why fixing fits */
  fix: {
    /** access_challenges: Microsoft 365, 64-bit or a new PC */
    challenges: readonly string[];
    /** Office support status (see accessSupport in access-support.ts) */
    supports: readonly string[];
    /** access_users */
    users: readonly string[];
    /** access_features that make a replacement change how people work */
    builtFeatures: readonly string[];
    /** access_vba_amount */
    vbaAmounts: readonly string[];
  };
  /** This many "I don't know" answers among the key questions add `check_unknowns` */
  unknownsToCheck: number;
}

export interface AxAccessPathInput {
  tools?: string;
  screens?: string;
  features: readonly string[];
  vbaAmount?: string;
  users?: string;
  importance?: string;
  location?: string;
  size?: string;
  challenges: readonly string[];
  /** Office support status of the versions in use */
  support?: string;
}

const MAX_REASONS = 3;

const among = (list: readonly string[], value: string | undefined) =>
  value !== undefined && list.includes(value);

/** Key answers that are "I don't know" (unanswered follow-ups do not count) */
function countUnknowns(input: AxAccessPathInput): number {
  const singles = [
    input.tools,
    input.screens,
    input.vbaAmount,
    input.users,
    input.importance,
    input.location,
    input.size,
  ].filter((value) => value === 'unknown').length;
  return singles + (input.features.includes('unknown') ? 1 : 0);
}

export function judgeAccessPath(
  input: AxAccessPathInput,
  rules: AxAccessPathRules
): AxAccessPathResult {
  const web: AxAccessPathReason[] = [];
  if (among(rules.web.users, input.users)) web.push('many_users');
  if (among(rules.web.importance, input.importance)) web.push('company_impact');
  const chose = (list: readonly string[]) => input.challenges.some((c) => list.includes(c));
  if (chose(rules.web.remoteChallenges)) web.push('remote');
  if (chose(rules.web.controlChallenges)) web.push('audit');
  const { stability } = rules.web;
  if (
    input.challenges.includes(stability.challenge) &&
    among(stability.users, input.users) &&
    among(stability.locations, input.location)
  ) {
    web.push('shared_stability');
  }
  if (among(rules.web.sizes, input.size)) web.push('data_limit');
  if (among(rules.web.tools, input.tools)) web.push('many_tools');

  let path: AxAccessPath;
  let reasons: AxAccessPathReason[];
  const simple =
    input.features.length > 0 && input.features.every((f) => rules.replace.features.includes(f));
  if (web.length > 0) {
    path = 'web';
    reasons = web;
  } else if (
    simple &&
    among(rules.replace.screens, input.screens) &&
    !among(rules.replace.blockingVbaAmounts, input.vbaAmount)
  ) {
    path = 'replace';
    reasons = ['simple_features', 'few_screens'];
    if (input.vbaAmount !== undefined && input.vbaAmount !== 'unknown') reasons.push('light_vba');
  } else {
    path = 'fix';
    reasons = [];
    if (chose(rules.fix.challenges)) reasons.push('office_update');
    if (among(rules.fix.supports, input.support)) reasons.push('support_end');
    if (among(rules.fix.users, input.users)) reasons.push('few_users');
    if (
      input.features.some((f) => rules.fix.builtFeatures.includes(f)) ||
      among(rules.fix.vbaAmounts, input.vbaAmount)
    ) {
      reasons.push('rules_in_tool');
    }
    if (reasons.length === 0) reasons.push('keep_current');
  }

  if (countUnknowns(input) >= rules.unknownsToCheck) {
    return { path, reasons: [...reasons.slice(0, MAX_REASONS - 1), 'check_unknowns'] };
  }
  return { path, reasons: reasons.slice(0, MAX_REASONS) };
}

/** The stored path, or null for results saved before #303 and for other systems */
export function readAccessPath(value: unknown): AxAccessPath | null {
  const path =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as { path?: unknown }).path
      : value;
  return typeof path === 'string' && (AX_ACCESS_PATHS as readonly string[]).includes(path)
    ? (path as AxAccessPath)
    : null;
}
