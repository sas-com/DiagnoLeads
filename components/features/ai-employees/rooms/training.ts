/**
 * The training room of the full-screen office (#1191, decision
 * 2026-11-14-training-room-grows-employees): where the president brings the AI employees up. Pure
 * functions: which board shows, where an employee stands in its onboarding and its reviews, and
 * when the screen asks for the next step of a running session.
 */
import type { AiEmployeeLevel } from '@/lib/features/ai-employees/types/levels';
import type {
  AiEmployeeSessionKind,
  AiEmployeeSessionStatus,
} from '@/lib/features/ai-employees/types/training';

/** The boards of the room, on the keys 1 to 4 */
export const TRAINING_BOARDS = ['report', 'notes', 'review', 'policy'] as const;
export type TrainingBoard = (typeof TRAINING_BOARDS)[number];

export const BOARD_KEYS: Readonly<Record<TrainingBoard, string>> = {
  report: '1',
  notes: '2',
  review: '3',
  policy: '4',
};

export function boardOfKey(key: string): TrainingBoard | null {
  return TRAINING_BOARDS.find((board) => BOARD_KEYS[board] === key) ?? null;
}

export interface TrainingSessionView {
  id: string;
  kind: AiEmployeeSessionKind;
  status: AiEmployeeSessionStatus;
  resultCode: string | null;
}

export interface TrainingEmployeeView {
  status: 'active' | 'paused';
  level: AiEmployeeLevel;
  session: TrainingSessionView | null;
  review: { status: 'open' | 'decided'; sessionId: string | null } | null;
  nextReviewAt: Date | string | null;
}

/**
 * Where an employee stands in its onboarding:
 * - disabled: the agents are switched off (the room says it is being prepared)
 * - paused: the employee is paused and does not work
 * - start: in training, nothing running (never started, or the last one ended without approval)
 * - running: the employee is writing its notes
 * - waiting: its report waits for the president
 * - onboarded: the president approved it
 */
export type OnboardingStep = 'disabled' | 'paused' | 'start' | 'running' | 'waiting' | 'onboarded';

export function onboardingStep(
  employee: TrainingEmployeeView,
  agentEnabled: boolean
): OnboardingStep {
  if (employee.level > 0) return 'onboarded';
  const session = employee.session?.kind === 'onboarding' ? employee.session : null;
  if (session?.status === 'waiting') return 'waiting';
  if (!agentEnabled) return 'disabled';
  if (employee.status === 'paused') return 'paused';
  if (session?.status === 'running') return 'running';
  return 'start';
}

/**
 * Where an employee stands in its reviews:
 * - training: no review before the onboarding is approved
 * - running / waiting: the self-review is being written / was handed in
 * - open: the facts are counted and the president decides
 * - due: a review may be held now
 * - not_due: the next one is later
 * - disabled / paused: as for the onboarding
 */
export type ReviewStep =
  | 'training'
  | 'disabled'
  | 'paused'
  | 'running'
  | 'waiting'
  | 'open'
  | 'due'
  | 'not_due';

export function reviewStep(
  employee: TrainingEmployeeView,
  agentEnabled: boolean,
  now: Date
): ReviewStep {
  if (employee.level === 0) return 'training';
  const session = employee.session?.kind === 'review' ? employee.session : null;
  if (session?.status === 'running') return 'running';
  if (employee.review?.status === 'open') {
    return session?.status === 'waiting' ? 'waiting' : 'open';
  }
  if (!agentEnabled) return 'disabled';
  if (employee.status === 'paused') return 'paused';
  const due = employee.nextReviewAt ? new Date(employee.nextReviewAt) : null;
  if (employee.session && ['running', 'waiting'].includes(employee.session.status))
    return 'not_due';
  return due && due.getTime() <= now.getTime() ? 'due' : 'not_due';
}

/** The session the screen moves on while the room is open, if any */
export function runningSession(employee: TrainingEmployeeView): string | null {
  return employee.session?.status === 'running' ? employee.session.id : null;
}

/** What a step answered */
export type StepState =
  | 'running'
  | 'waiting'
  | 'failed'
  | 'busy'
  | 'retry'
  | 'paused'
  | 'disabled'
  | 'closed';

/**
 * How long the screen waits before it asks for the next step: at once while the session runs, a
 * moment when another step holds it or the call should be tried again, never once it is over
 */
export function nextStepDelay(state: StepState): number | null {
  if (state === 'running') return 0;
  if (state === 'busy' || state === 'retry') return 3_000;
  return null;
}
