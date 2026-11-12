/**
 * The office of the AI employees (Refs #1101): what a desk shows. Pure, shared by the service
 * and the screen.
 */
import type { AiEmployeeRunStatus, AiEmployeeStatus } from './types/schemas';

/**
 * What a desk shows:
 * - vacant: nobody hired for the role
 * - paused: hired and paused by an admin
 * - training: hired, but the role has no work yet (its issue is not done)
 * - working: a run started less than RUN_STALE_MS ago and has not finished
 * - attention: the last run failed, or it has run for too long to still be working
 * - idle: waiting for the next run
 */
export const DESK_STATUSES = [
  'working',
  'attention',
  'idle',
  'training',
  'paused',
  'vacant',
] as const;
export type DeskStatus = (typeof DESK_STATUSES)[number];

/** A run still "running" after this long is taken as stuck (the functions stop at 30 s) */
export const RUN_STALE_MS = 15 * 60 * 1000;

export interface DeskRun {
  status: AiEmployeeRunStatus;
  startedAt: Date;
}

export function deskStatus(input: {
  /** Whether the role has work yet (roleHasWork) */
  hasWork: boolean;
  employee: { status: AiEmployeeStatus } | null;
  lastRun: DeskRun | null;
  now: Date;
}): DeskStatus {
  const { hasWork, employee, lastRun, now } = input;
  if (!employee) return 'vacant';
  if (employee.status === 'paused') return 'paused';
  if (!hasWork) return 'training';
  if (!lastRun) return 'idle';
  if (lastRun.status === 'failed') return 'attention';
  if (lastRun.status === 'running') {
    return now.getTime() - lastRun.startedAt.getTime() < RUN_STALE_MS ? 'working' : 'attention';
  }
  return 'idle';
}

export interface OfficeSummary {
  hired: number;
  working: number;
  attention: number;
  processedToday: number;
}

/** The figures over the floor */
export function summarizeOffice(
  desks: readonly { deskStatus: DeskStatus; processedToday: number }[]
): OfficeSummary {
  let hired = 0;
  let working = 0;
  let attention = 0;
  let processedToday = 0;
  for (const desk of desks) {
    if (desk.deskStatus === 'vacant') continue;
    hired += 1;
    if (desk.deskStatus === 'working') working += 1;
    if (desk.deskStatus === 'attention') attention += 1;
    processedToday += desk.processedToday;
  }
  return { hired, working, attention, processedToday };
}
