/**
 * What an AI employee feels and how it shows (#1135, spike). The emotion comes from the real
 * status and from what really happened, never from anything made up: an employee that did no
 * work is never proud of it. The personality (the tone of #1134) only changes how large the
 * gestures are.
 *
 * Pure functions: the 3D robot only draws what these return.
 */
import type { DeskStatus } from '@/lib/features/ai-employees/office';
import type { AiTone } from '@/lib/features/ai-employees/types/profile';

export const EMOTIONS = [
  'focused',
  'proud',
  'troubled',
  'relaxed',
  'studious',
  'asleep',
  'happy',
  'attentive',
] as const;
export type Emotion = (typeof EMOTIONS)[number];

/** What just happened to the employee, for a short while after it happened */
export const OFFICE_EVENTS = ['run_succeeded', 'hired', 'resumed', 'president_near'] as const;
export type OfficeEvent = (typeof OFFICE_EVENTS)[number];

/** The emotion the status alone gives */
const STATUS_EMOTIONS: Readonly<Record<Exclude<DeskStatus, 'vacant'>, Emotion>> = {
  working: 'focused',
  attention: 'troubled',
  idle: 'relaxed',
  training: 'studious',
  paused: 'asleep',
};

/**
 * The emotion of an employee. Something that just happened shows over the status, except that a
 * sleeping employee stays asleep and a stopped one stays troubled until someone looks at it:
 * neither is covered by a cheer.
 */
export function emotionOf(
  status: Exclude<DeskStatus, 'vacant'>,
  event: OfficeEvent | null = null
): Emotion {
  const base = STATUS_EMOTIONS[status];
  if (!event || status === 'paused') return base;
  if (event === 'president_near') return status === 'attention' ? base : 'attentive';
  if (status === 'attention') return base;
  if (event === 'run_succeeded') return 'proud';
  return 'happy';
}

export type EyeShape = 'open' | 'arc' | 'narrow' | 'down' | 'closed';
export type EmoteIcon = 'none' | 'check' | 'alert' | 'sleep' | 'wave' | 'book';

export interface Expression {
  eyes: EyeShape;
  /** How much the body bobs up and down, as a share of the calm hover */
  bob: number;
  /** How far the head and body lean forward (positive) or back, in radians */
  lean: number;
  /** What floats over the head */
  icon: EmoteIcon;
}

const EXPRESSIONS: Readonly<Record<Emotion, Expression>> = {
  focused: { eyes: 'narrow', bob: 0.5, lean: 0.1, icon: 'none' },
  proud: { eyes: 'arc', bob: 2.4, lean: -0.08, icon: 'check' },
  troubled: { eyes: 'down', bob: 0.3, lean: 0.22, icon: 'alert' },
  relaxed: { eyes: 'arc', bob: 1, lean: 0, icon: 'none' },
  studious: { eyes: 'open', bob: 0.6, lean: 0.12, icon: 'book' },
  asleep: { eyes: 'closed', bob: 0.2, lean: 0.28, icon: 'sleep' },
  happy: { eyes: 'arc', bob: 2, lean: -0.05, icon: 'wave' },
  attentive: { eyes: 'open', bob: 0.8, lean: -0.04, icon: 'none' },
};

export function expressionOf(emotion: Emotion): Expression {
  return EXPRESSIONS[emotion];
}

/** How large the gestures are for a personality: the same emotion, shown smaller or larger */
const GESTURE_SCALES: Readonly<Record<AiTone, number>> = {
  polite: 1,
  brisk: 0.6,
  friendly: 1.25,
  spirited: 1.6,
};

export function gestureScale(tone: AiTone): number {
  return GESTURE_SCALES[tone];
}
