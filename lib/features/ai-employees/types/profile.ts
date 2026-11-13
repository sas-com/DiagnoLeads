/**
 * What can be customized about an AI employee (#1134): how its robot looks, how it talks, how its
 * ability points are spread, and how it is meant to work.
 *
 * Stored as one JSON value per employee (ai_employees.profile). Reading is tolerant: a part that
 * is missing or no longer valid falls back to its default, so the catalog below can change
 * without a migration. Writing is strict (aiEmployeeProfilePatchSchema).
 *
 * The look and the tone show at once. The ability points and the work style are settings for
 * when the work runs (#1102, #1103, #1110, #1114): nothing reads them yet, and the screens say so.
 */
import { z } from 'zod';

// --- The look of the robot -------------------------------------------------------------------

export const ROBOT_HEADS = ['helmet', 'round', 'square', 'dome'] as const;
export const ROBOT_EYES = ['led', 'bar', 'wide'] as const;
export const ROBOT_ANTENNAS = ['single', 'double', 'ring', 'none'] as const;
/** 'role' keeps the equipment of the employee's role */
export const ROBOT_GEARS = [
  'role',
  'headset',
  'scanner',
  'goggles',
  'eyeshade',
  'bow_tie',
  'none',
] as const;
export const ROBOT_SHELLS = ['white', 'silver', 'graphite', 'sand', 'mint', 'sky', 'rose'] as const;
/** 'role' keeps the colour of the employee's role */
export const ROBOT_ACCENTS = [
  'role',
  'violet',
  'teal',
  'blue',
  'orange',
  'pink',
  'lime',
  'gold',
  'red',
] as const;

export type RobotHead = (typeof ROBOT_HEADS)[number];
export type RobotEyes = (typeof ROBOT_EYES)[number];
export type RobotAntenna = (typeof ROBOT_ANTENNAS)[number];
export type RobotGear = (typeof ROBOT_GEARS)[number];
export type RobotShell = (typeof ROBOT_SHELLS)[number];
export type RobotAccent = (typeof ROBOT_ACCENTS)[number];

export interface RobotLook {
  head: RobotHead;
  eyes: RobotEyes;
  antenna: RobotAntenna;
  gear: RobotGear;
  shell: RobotShell;
  accent: RobotAccent;
}

/** The parts of a look and what each can be, in the order the screen offers them */
export const ROBOT_LOOK_PARTS = {
  head: ROBOT_HEADS,
  eyes: ROBOT_EYES,
  antenna: ROBOT_ANTENNAS,
  gear: ROBOT_GEARS,
  shell: ROBOT_SHELLS,
  accent: ROBOT_ACCENTS,
} as const satisfies { [Part in keyof RobotLook]: readonly RobotLook[Part][] };
export type RobotLookPart = keyof RobotLook;
export const ROBOT_LOOK_PART_NAMES = Object.keys(ROBOT_LOOK_PARTS) as RobotLookPart[];

/** The robot as it was before it could be customized */
export const DEFAULT_ROBOT_LOOK: RobotLook = {
  head: 'helmet',
  eyes: 'led',
  antenna: 'single',
  gear: 'role',
  shell: 'white',
  accent: 'role',
};

const robotLookSchema = z
  .object({
    head: z.enum(ROBOT_HEADS),
    eyes: z.enum(ROBOT_EYES),
    antenna: z.enum(ROBOT_ANTENNAS),
    gear: z.enum(ROBOT_GEARS),
    shell: z.enum(ROBOT_SHELLS),
    accent: z.enum(ROBOT_ACCENTS),
  })
  .strict();

/**
 * A look picked at random ("leave it to me"). `random` returns numbers in [0, 1) like
 * Math.random, so tests can fix what is picked.
 */
export function randomRobotLook(random: () => number = Math.random): RobotLook {
  const pick = <T>(options: readonly T[]): T =>
    options[Math.min(options.length - 1, Math.floor(random() * options.length))] as T;
  return {
    head: pick(ROBOT_HEADS),
    eyes: pick(ROBOT_EYES),
    antenna: pick(ROBOT_ANTENNAS),
    gear: pick(ROBOT_GEARS),
    shell: pick(ROBOT_SHELLS),
    accent: pick(ROBOT_ACCENTS),
  };
}

// --- How it talks ----------------------------------------------------------------------------

/** 'polite' is how the AI employees talked before the tone could be chosen */
export const AI_TONES = ['polite', 'brisk', 'friendly', 'spirited'] as const;
export type AiTone = (typeof AI_TONES)[number];
export const DEFAULT_AI_TONE: AiTone = 'polite';

// --- Ability points --------------------------------------------------------------------------

export const AI_STATS = ['speed', 'care', 'insight', 'grit'] as const;
export type AiStat = (typeof AI_STATS)[number];
export type AiStats = Record<AiStat, number>;

export const AI_STAT_MIN = 1;
export const AI_STAT_MAX = 6;
/** The points to spread over the abilities; spending fewer is allowed */
export const AI_STAT_POINTS = 12;
export const DEFAULT_AI_STATS: AiStats = { speed: 3, care: 3, insight: 3, grit: 3 };

const statSchema = z.number().int().min(AI_STAT_MIN).max(AI_STAT_MAX);
const aiStatsSchema = z
  .object({ speed: statSchema, care: statSchema, insight: statSchema, grit: statSchema })
  .strict()
  .refine((stats) => aiStatPointsUsed(stats) <= AI_STAT_POINTS, {
    message: `The ability points must not add up to more than ${AI_STAT_POINTS}`,
  });

export function aiStatPointsUsed(stats: AiStats): number {
  return AI_STATS.reduce((sum, stat) => sum + stats[stat], 0);
}

/**
 * The stats after one ability is raised or lowered by a point; unchanged when that would leave
 * the range of an ability or spend more points than there are.
 */
export function stepAiStat(stats: AiStats, stat: AiStat, delta: 1 | -1): AiStats {
  const value = stats[stat] + delta;
  if (value < AI_STAT_MIN || value > AI_STAT_MAX) return stats;
  const next = { ...stats, [stat]: value };
  return aiStatPointsUsed(next) > AI_STAT_POINTS ? stats : next;
}

// --- How it is meant to work -----------------------------------------------------------------

/** 'ask': checks with a person before acting; 'report': acts within its work, then reports */
export const AI_AUTONOMIES = ['ask', 'report'] as const;
export type AiAutonomy = (typeof AI_AUTONOMIES)[number];
export const AI_REPORTINGS = ['brief', 'standard', 'detailed'] as const;
export type AiReporting = (typeof AI_REPORTINGS)[number];

export interface AiWorkStyle {
  autonomy: AiAutonomy;
  reporting: AiReporting;
}
/** The careful choice by default: nothing is done without a person */
export const DEFAULT_AI_WORK_STYLE: AiWorkStyle = { autonomy: 'ask', reporting: 'standard' };

const aiWorkStyleSchema = z
  .object({ autonomy: z.enum(AI_AUTONOMIES), reporting: z.enum(AI_REPORTINGS) })
  .strict();

// --- The whole profile -----------------------------------------------------------------------

export interface AiEmployeeProfile {
  look: RobotLook;
  tone: AiTone;
  stats: AiStats;
  workStyle: AiWorkStyle;
}

export const DEFAULT_AI_EMPLOYEE_PROFILE: AiEmployeeProfile = {
  look: DEFAULT_ROBOT_LOOK,
  tone: DEFAULT_AI_TONE,
  stats: DEFAULT_AI_STATS,
  workStyle: DEFAULT_AI_WORK_STYLE,
};

/**
 * What a save sends: any of the four parts, each one whole (a part replaces what was stored; the
 * parts left out stay as they are). Unknown keys and values are refused.
 */
export const aiEmployeeProfilePatchSchema = z
  .object({
    look: robotLookSchema.optional(),
    tone: z.enum(AI_TONES).optional(),
    stats: aiStatsSchema.optional(),
    workStyle: aiWorkStyleSchema.optional(),
  })
  .strict()
  .refine((patch) => Object.values(patch).some((part) => part !== undefined), {
    message: 'Nothing to change',
  });
export type AiEmployeeProfilePatch = z.infer<typeof aiEmployeeProfilePatchSchema>;

/** The stored value as a full profile: each part that is missing or not valid is the default */
export function resolveAiEmployeeProfile(stored: unknown): AiEmployeeProfile {
  const raw = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
  const look = robotLookSchema.safeParse(raw.look);
  const tone = z.enum(AI_TONES).safeParse(raw.tone);
  const stats = aiStatsSchema.safeParse(raw.stats);
  const workStyle = aiWorkStyleSchema.safeParse(raw.workStyle);
  return {
    look: look.success ? look.data : DEFAULT_ROBOT_LOOK,
    tone: tone.success ? tone.data : DEFAULT_AI_TONE,
    stats: stats.success ? stats.data : DEFAULT_AI_STATS,
    workStyle: workStyle.success ? workStyle.data : DEFAULT_AI_WORK_STYLE,
  };
}
