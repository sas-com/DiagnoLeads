/** The training room's pure functions (#1191): the boards, where an employee stands, the steps */
import {
  BOARD_KEYS,
  TRAINING_BOARDS,
  boardOfKey,
  nextStepDelay,
  onboardingStep,
  reviewStep,
  runningSession,
} from '@/components/features/ai-employees/rooms/training';
import { describe, expect, it } from 'vitest';

const NOW = new Date('2026-11-15T00:00:00Z');
const base = {
  status: 'active' as const,
  level: 0 as const,
  session: null,
  review: null,
  nextReviewAt: null,
};
const session = (kind: 'onboarding' | 'review', status: 'running' | 'waiting' | 'failed') => ({
  id: 's',
  kind,
  status,
  resultCode: null,
});

describe('the boards', () => {
  it('are on the keys 1 to 4', () => {
    expect(TRAINING_BOARDS.map((board) => BOARD_KEYS[board])).toEqual(['1', '2', '3', '4']);
    expect(boardOfKey('3')).toBe('review');
    expect(boardOfKey('5')).toBeNull();
  });
});

describe('onboardingStep', () => {
  it('follows the onboarding session, and says when the agents are off or the employee paused', () => {
    expect(onboardingStep(base, true)).toBe('start');
    expect(onboardingStep(base, false)).toBe('disabled');
    expect(onboardingStep({ ...base, status: 'paused' }, true)).toBe('paused');
    expect(onboardingStep({ ...base, session: session('onboarding', 'running') }, true)).toBe('running');
    expect(onboardingStep({ ...base, session: session('onboarding', 'failed') }, true)).toBe('start');
    // A report already in can be answered even with the agents off
    expect(onboardingStep({ ...base, session: session('onboarding', 'waiting') }, false)).toBe('waiting');
    expect(onboardingStep({ ...base, level: 1 }, false)).toBe('onboarded');
  });
});

describe('reviewStep', () => {
  const onboarded = { ...base, level: 1 as const };
  it('starts after the onboarding, when due, and follows the review and its self-review', () => {
    expect(reviewStep(base, true, NOW)).toBe('training');
    expect(reviewStep({ ...onboarded, nextReviewAt: '2026-11-14' }, true, NOW)).toBe('due');
    expect(reviewStep({ ...onboarded, nextReviewAt: '2026-12-14' }, true, NOW)).toBe('not_due');
    expect(reviewStep({ ...onboarded, nextReviewAt: '2026-11-14' }, false, NOW)).toBe('disabled');
    expect(reviewStep({ ...onboarded, session: session('review', 'running') }, true, NOW)).toBe('running');
    const open = { status: 'open' as const, sessionId: 's' };
    expect(
      reviewStep({ ...onboarded, review: open, session: session('review', 'waiting') }, true, NOW)
    ).toBe('waiting');
    expect(reviewStep({ ...onboarded, review: open }, false, NOW)).toBe('open');
  });
});

describe('the steps of a running session', () => {
  it('are asked for at once while running, a moment later when held, never once over', () => {
    expect(runningSession({ ...base, session: session('onboarding', 'running') })).toBe('s');
    expect(runningSession({ ...base, session: session('onboarding', 'waiting') })).toBeNull();
    // A paused employee's session waits until it is resumed
    expect(
      runningSession({ ...base, status: 'paused', session: session('onboarding', 'running') })
    ).toBeNull();
    expect(nextStepDelay('running')).toBe(0);
    expect(nextStepDelay('busy')).toBe(3_000);
    expect(nextStepDelay('retry')).toBe(3_000);
    for (const state of ['waiting', 'failed', 'paused', 'disabled', 'closed'] as const) {
      expect(nextStepDelay(state)).toBeNull();
    }
  });
});
