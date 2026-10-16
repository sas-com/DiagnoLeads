/**
 * Prefill a hearing from the lead's AX Web diagnosis (Refs #84)
 *
 * Pure function: maps the stored answers / result of one diagnostic submission onto hearing
 * fields. A field gets a value only when the answer says it unambiguously; otherwise the
 * diagnosis questions behind it are listed as hints so the screen can show the answer and
 * sales confirm it in the meeting. Prefilled values start as status "not_yet", source
 * "prefilled".
 */

import { HEARING_CHALLENGES, type HearingFieldKey } from './catalog';
import {
  type HearingFieldEntry,
  type HearingFieldValue,
  type HearingFields,
  type HearingPrefillSnapshot,
  parseStoredHearingFields,
} from './types/schemas';

export interface PrefillSubmission {
  id: string;
  diagnosticKey: string;
  diagnosticVersion: number;
  answers: Record<string, string | string[]>;
  result: Record<string, unknown>;
  leadCreated: boolean;
  /** Set when the server checked it came from the same browser as the lead's first answer */
  continuedFromSubmissionId?: string | null;
  createdAt: Date;
}

/**
 * Whether the answers can be taken as the lead's own: the submission created the lead, or it
 * diagnosed another system from that submission's result screen (#67). A submission that only
 * matched the lead's email is unverified.
 */
export function isVerifiedSubmission(
  submission: Pick<PrefillSubmission, 'leadCreated' | 'continuedFromSubmissionId'>
): boolean {
  return submission.leadCreated || Boolean(submission.continuedFromSubmissionId);
}

/** Diagnosis questions the hearing reads (only these are copied into the snapshot) */
export const PREFILL_QUESTION_IDS = [
  'platform',
  'other_system',
  'acos_series',
  'as400_version',
  'as400_programs',
  'acos_programs',
  'other_programs',
  'access_screens_forms',
  'business_areas',
  'maintenance',
  'access_maintainer',
  'support_end',
  'access_version',
  'challenges',
  'access_challenges',
  'timeline',
  'industry',
  'role',
] as const;

/** Diagnosis "other" path answers mapped onto the lead's target system */
const OTHER_SYSTEM_TARGETS: Record<string, string> = {
  vb: 'vb',
  webperformer: 'webperformer',
  office_computer: 'other_legacy',
  mainframe: 'other_legacy',
  package: 'package',
  other_low_code: 'other',
  unknown: 'unknown',
};

const SCALE_QUESTION_BY_PLATFORM: Record<string, string> = {
  as400: 'as400_programs',
  acos: 'acos_programs',
  other: 'other_programs',
  access: 'access_screens_forms',
};

const asString = (value: unknown) => (typeof value === 'string' ? value : undefined);
const asList = (value: unknown) =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

function readChallenges(result: Record<string, unknown>): HearingPrefillSnapshot['challenges'] {
  const challenges = result.challenges;
  if (challenges === null || typeof challenges !== 'object') return null;
  const { primary, selected } = challenges as { primary?: unknown; selected?: unknown };
  return { primary: asString(primary) ?? null, selected: asList(selected) };
}

export function buildHearingPrefill(submission: PrefillSubmission): {
  snapshot: HearingPrefillSnapshot;
  fields: HearingFields;
} {
  const answers: Record<string, string | string[]> = {};
  for (const id of PREFILL_QUESTION_IDS) {
    const value = submission.answers[id];
    if (typeof value === 'string' || Array.isArray(value)) answers[id] = value;
  }
  const one = (id: string) => asString(answers[id]);
  const many = (id: string) => asList(answers[id]);
  const challenges = readChallenges(submission.result);

  const values: Partial<Record<HearingFieldKey, HearingFieldValue>> = {};
  const hints: Partial<Record<HearingFieldKey, string[]>> = {};
  const hint = (key: HearingFieldKey, ...questionIds: string[]) => {
    const answered = questionIds.filter((id) => answers[id] !== undefined);
    if (answered.length > 0) hints[key] = [...(hints[key] ?? []), ...answered];
  };

  // 役職 → 出席者の立場
  const role = one('role');
  if (role) values.attendeeRoles = [role];
  hint('attendeeRoles', 'role');

  // 業種
  const industry = one('industry');
  if (industry) values.industry = industry;
  hint('industry', 'industry');

  // 移行元 (+ other_system) → 対象システム
  const platform = one('platform');
  if (platform === 'as400' || platform === 'acos' || platform === 'access') {
    values.targetSystem = platform;
  } else if (platform === 'other') {
    const target = OTHER_SYSTEM_TARGETS[one('other_system') ?? ''];
    if (target) values.targetSystem = target;
  }
  hint('targetSystem', 'platform', 'other_system');

  // 機種・バージョン: free text, so only a hint
  hint('machineModel', 'acos_series', 'as400_version');

  // 規模: the size question of the chosen path
  const scaleQuestion = platform ? SCALE_QUESTION_BY_PLATFORM[platform] : undefined;
  if (scaleQuestion) {
    const bucket = one(scaleQuestion);
    if (bucket && bucket !== 'unknown') values.scale = { basis: scaleQuestion, bucket };
    hint('scale', scaleQuestion);
  }

  // 対象業務
  const areas = many('business_areas').filter((area) => area !== 'unknown');
  if (areas.length > 0) values.businessAreas = areas;
  hint('businessAreas', 'business_areas');

  // 保守体制 → 中身が分かる人数 / 保守会社の支援
  const maintenance = one('maintenance');
  if (maintenance === 'vendor') {
    values.inHouseExperts = 'none';
    values.vendorSupport = 'yes';
  } else if (maintenance === 'none') {
    values.inHouseExperts = 'none';
    values.vendorSupport = 'no';
  }
  const accessMaintainer = one('access_maintainer');
  if (accessMaintainer === 'one') {
    values.inHouseExperts = 'one';
  } else if (accessMaintainer === 'nobody') {
    values.inHouseExperts = 'none';
    values.vendorSupport = 'no';
  } else if (accessMaintainer === 'vendor') {
    values.vendorSupport = 'yes';
  }
  hint('inHouseExperts', 'maintenance', 'access_maintainer');
  hint('vendorSupport', 'maintenance', 'access_maintainer');
  if (maintenance === 'retiring') hint('earliestRetirement', 'maintenance');

  // 保守期限: the diagnosis asks a range, the hearing a month, so only a hint
  hint('hardwareSupportEnd', 'support_end', 'access_version');

  // 課題
  if (challenges && challenges.selected.length > 0) {
    hints.challengeLevels = ['challenges', 'access_challenges'].filter(
      (id) => answers[id] !== undefined
    );
  }
  const primary = challenges?.primary;
  if (primary && (HEARING_CHALLENGES as readonly string[]).includes(primary)) {
    values.topChallenge = primary;
  }
  hint('topChallenge', 'challenges', 'access_challenges');
  hint('challengeNotes', 'challenges', 'access_challenges');

  // 検討時期 → 方向性を決める時期
  const timeline = one('timeline');
  if (timeline) values.directionTiming = timeline;
  hint('directionTiming', 'timeline');

  const entries: Record<string, HearingFieldEntry> = {};
  for (const [key, value] of Object.entries(values)) {
    entries[key] = { value, status: 'not_yet', source: 'prefilled' };
  }
  // Answers outside the catalog's options (an older diagnosis version) are left out
  const { fields } = parseStoredHearingFields(entries);

  return {
    snapshot: {
      submissionId: submission.id,
      diagnosticKey: submission.diagnosticKey,
      diagnosticVersion: submission.diagnosticVersion,
      submittedAt: submission.createdAt.toISOString(),
      verified: isVerifiedSubmission(submission),
      answers,
      challenges,
      hints,
    },
    fields,
  };
}
