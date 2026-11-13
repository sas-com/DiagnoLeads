/** What can be customized about an AI employee (#1134): the catalog, reading and writing */
import {
  AI_STATS,
  AI_STAT_MAX,
  AI_STAT_MIN,
  AI_STAT_POINTS,
  DEFAULT_AI_EMPLOYEE_PROFILE,
  DEFAULT_AI_STATS,
  DEFAULT_ROBOT_LOOK,
  ROBOT_LOOK_PARTS,
  ROBOT_LOOK_PART_NAMES,
  aiEmployeeProfilePatchSchema,
  aiStatPointsUsed,
  randomRobotLook,
  resolveAiEmployeeProfile,
  stepAiStat,
} from '@/lib/features/ai-employees/types/profile';
import { updateAiEmployeeSchema } from '@/lib/features/ai-employees/types/schemas';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const look = {
  head: 'dome',
  eyes: 'wide',
  antenna: 'ring',
  gear: 'bow_tie',
  shell: 'mint',
  accent: 'pink',
} as const;

describe('resolveAiEmployeeProfile', () => {
  it('is the default for an employee that was never customized', () => {
    expect(resolveAiEmployeeProfile({})).toEqual(DEFAULT_AI_EMPLOYEE_PROFILE);
    expect(resolveAiEmployeeProfile(null)).toEqual(DEFAULT_AI_EMPLOYEE_PROFILE);
    expect(resolveAiEmployeeProfile('x')).toEqual(DEFAULT_AI_EMPLOYEE_PROFILE);
  });

  it('keeps the parts that are stored and fills the others', () => {
    expect(resolveAiEmployeeProfile({ look, tone: 'spirited' })).toEqual({
      ...DEFAULT_AI_EMPLOYEE_PROFILE,
      look,
      tone: 'spirited',
    });
  });

  it('falls back part by part when a stored part is no longer valid', () => {
    const resolved = resolveAiEmployeeProfile({
      look: { ...look, head: 'cube' },
      tone: 'rude',
      stats: { speed: 6, care: 6, insight: 6, grit: 6 },
      workStyle: { autonomy: 'report', reporting: 'brief' },
    });
    expect(resolved.look).toEqual(DEFAULT_ROBOT_LOOK);
    expect(resolved.tone).toBe('polite');
    expect(resolved.stats).toEqual(DEFAULT_AI_STATS);
    expect(resolved.workStyle).toEqual({ autonomy: 'report', reporting: 'brief' });
  });
});

describe('the defaults', () => {
  it('spend exactly the points there are, within the range of an ability', () => {
    expect(aiStatPointsUsed(DEFAULT_AI_STATS)).toBe(AI_STAT_POINTS);
    for (const stat of AI_STATS) {
      expect(DEFAULT_AI_STATS[stat]).toBeGreaterThanOrEqual(AI_STAT_MIN);
      expect(DEFAULT_AI_STATS[stat]).toBeLessThanOrEqual(AI_STAT_MAX);
    }
  });

  it('are the careful work style: nothing without a person', () => {
    expect(DEFAULT_AI_EMPLOYEE_PROFILE.workStyle.autonomy).toBe('ask');
  });

  it('are options of the catalog', () => {
    for (const part of ROBOT_LOOK_PART_NAMES) {
      expect(ROBOT_LOOK_PARTS[part]).toContain(DEFAULT_ROBOT_LOOK[part]);
    }
  });
});

describe('aiEmployeeProfilePatchSchema', () => {
  it('takes any of the parts, each one whole', () => {
    expect(aiEmployeeProfilePatchSchema.safeParse({ look }).success).toBe(true);
    expect(aiEmployeeProfilePatchSchema.safeParse({ tone: 'brisk' }).success).toBe(true);
    expect(aiEmployeeProfilePatchSchema.safeParse(DEFAULT_AI_EMPLOYEE_PROFILE).success).toBe(true);
    expect(
      aiEmployeeProfilePatchSchema.safeParse({ look: { head: 'dome' } }).success
    ).toBe(false);
  });

  it('refuses nothing to change, unknown parts and unknown options', () => {
    expect(aiEmployeeProfilePatchSchema.safeParse({}).success).toBe(false);
    expect(aiEmployeeProfilePatchSchema.safeParse({ script: 'x' }).success).toBe(false);
    expect(aiEmployeeProfilePatchSchema.safeParse({ tone: 'rude' }).success).toBe(false);
    expect(
      aiEmployeeProfilePatchSchema.safeParse({ look: { ...look, extra: 1 } }).success
    ).toBe(false);
    expect(
      aiEmployeeProfilePatchSchema.safeParse({ look: { ...look, shell: '#ff0000' } }).success
    ).toBe(false);
  });

  it('refuses more ability points than there are, and values outside the range', () => {
    const stats = (speed: number, care: number, insight: number, grit: number) =>
      aiEmployeeProfilePatchSchema.safeParse({ stats: { speed, care, insight, grit } }).success;
    expect(stats(6, 4, 1, 1)).toBe(true);
    expect(stats(1, 1, 1, 1)).toBe(true); // spending fewer is allowed
    expect(stats(6, 4, 2, 1)).toBe(false);
    expect(stats(7, 1, 1, 1)).toBe(false);
    expect(stats(0, 4, 4, 4)).toBe(false);
    expect(stats(2.5, 3, 3, 3)).toBe(false);
  });

  it('is part of the update of an AI employee', () => {
    const scope = {
      organizationId: '660e8400-e29b-41d4-a716-446655440000',
      employeeId: '770e8400-e29b-41d4-a716-446655440001',
    };
    expect(updateAiEmployeeSchema.safeParse({ ...scope, profile: { look } }).success).toBe(true);
    expect(updateAiEmployeeSchema.safeParse({ ...scope, profile: {} }).success).toBe(false);
  });
});

describe('stepAiStat', () => {
  it('moves a point when there is one to spend', () => {
    const lowered = stepAiStat(DEFAULT_AI_STATS, 'grit', -1);
    expect(lowered.grit).toBe(2);
    expect(stepAiStat(lowered, 'speed', 1).speed).toBe(4);
  });

  it('changes nothing without a point left, or outside the range', () => {
    expect(stepAiStat(DEFAULT_AI_STATS, 'speed', 1)).toBe(DEFAULT_AI_STATS);
    const low = { speed: AI_STAT_MIN, care: 3, insight: 3, grit: 3 };
    expect(stepAiStat(low, 'speed', -1)).toBe(low);
    const high = { speed: AI_STAT_MAX, care: 1, insight: 1, grit: 1 };
    expect(stepAiStat(high, 'speed', 1)).toBe(high);
  });
});

describe('randomRobotLook', () => {
  it('picks a valid look, the first and the last options included', () => {
    const first = randomRobotLook(() => 0);
    const last = randomRobotLook(() => 0.999999);
    for (const part of ROBOT_LOOK_PART_NAMES) {
      expect(first[part]).toBe(ROBOT_LOOK_PARTS[part][0]);
      expect(last[part]).toBe(ROBOT_LOOK_PARTS[part].at(-1));
    }
    expect(aiEmployeeProfilePatchSchema.safeParse({ look: randomRobotLook() }).success).toBe(true);
  });
});

describe('the migration of the AI employee tables', () => {
  const sql = readFileSync(resolve(__dirname, '../../../../drizzle/0039_ai_employees.sql'), 'utf8');

  it('adds the profile with a default, so rows written without it stay valid', () => {
    expect(sql).toContain(`"profile" jsonb DEFAULT '{}'::jsonb NOT NULL`);
  });

  it('turns row level security on for both tables, like the other tables of an organization', () => {
    // No policies: the app connects as the owner. This keeps other database roles out (the
    // Supabase Data API roles lose their grants in scripts/supabase/prepare.sql as well)
    expect(sql).toContain('ALTER TABLE "ai_employees" ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('ALTER TABLE "ai_employee_runs" ENABLE ROW LEVEL SECURITY;');
  });
});
