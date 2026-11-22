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

/** The boards of the room, on the keys 1 to 5 (the training first, #1280) */
export const TRAINING_BOARDS = ['curriculum', 'report', 'notes', 'review', 'policy'] as const;
export type TrainingBoard = (typeof TRAINING_BOARDS)[number];

export const BOARD_KEYS: Readonly<Record<TrainingBoard, string>> = {
  curriculum: '1',
  report: '2',
  notes: '3',
  review: '4',
  policy: '5',
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
  /** The latest onboarding or review session */
  session: TrainingSessionView | null;
  /** The latest refresher (#1281), apart from the onboarding and the reviews */
  refresher?: TrainingSessionView | null;
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
  // One open session per employee: a refresher running holds the review back too
  if ([employee.session, employee.refresher].some((open) => open && isOpen(open.status))) {
    return 'not_due';
  }
  return due && due.getTime() <= now.getTime() ? 'due' : 'not_due';
}

/** The session the screen moves on while the room is open, if any */
export function runningSession(employee: TrainingEmployeeView): string | null {
  // A paused employee does not work: its session waits until it is resumed
  if (employee.status === 'paused') return null;
  if (employee.session?.status === 'running') return employee.session.id;
  return employee.refresher?.status === 'running' ? employee.refresher.id : null;
}

const isOpen = (status: AiEmployeeSessionStatus) => status === 'running' || status === 'waiting';

/**
 * Where an employee stands with an update of its training (#1281):
 * - running: the employee reads the change and fixes its notes
 * - done: the latest refresher is over (its report is shown)
 * - failed: it stopped (cancelled, refused, ...); the update itself stays
 * - none: no refresher yet
 */
export type RefresherStep = 'none' | 'running' | 'done' | 'failed';

export function refresherStep(employee: TrainingEmployeeView): RefresherStep {
  const refresher = employee.refresher;
  if (!refresher) return 'none';
  if (refresher.status === 'running') return 'running';
  return refresher.status === 'succeeded' ? 'done' : 'failed';
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
