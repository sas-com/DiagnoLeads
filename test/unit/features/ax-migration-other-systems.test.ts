/**
 * Other systems recorded on a lead ("diagnose another system"), as JSON on the lead's responses
 */
import {
  type OtherSystemEntry,
  withOtherSystem,
  withOtherSystemUpdate,
} from '@/lib/features/diagnostics/ax-migration/submission-service';
import { describe, expect, it } from 'vitest';

const entry = (submissionId: string): OtherSystemEntry => ({
  submissionId,
  diagnosedAt: '2026-10-11T01:00:00.000Z',
  platform: 'access',
  targetSystem: 'access',
  difficulty: 'low',
  urgency: 'high',
  primaryChallenge: 'people',
  needsHearing: false,
});

describe('withOtherSystem', () => {
  it('adds the system next to the first diagnosis, keeping everything else', () => {
    const responses = { axMigration: { submissionId: 'first', difficulty: 'medium' }, note: 'x' };
    expect(withOtherSystem(responses, entry('second'), false)).toEqual({
      note: 'x',
      axMigration: { submissionId: 'first', difficulty: 'medium', otherSystems: [entry('second')] },
    });
    // The input is not changed
    expect(responses.axMigration).not.toHaveProperty('otherSystems');
  });

  it('appends to the systems already recorded and marks a consultation request', () => {
    const responses = { axMigration: { otherSystems: [entry('second')] } };
    expect(withOtherSystem(responses, entry('third'), true)).toEqual({
      axMigration: { consultationRequested: true, otherSystems: [entry('second'), entry('third')] },
    });
  });

  it.each([
    ['no responses', null],
    ['a list', ['a', 'b']],
    ['a text', 'abc'],
    ['a number', 3],
  ])('starts from empty responses for %s', (_name, responses) => {
    expect(withOtherSystem(responses, entry('second'), false)).toEqual({
      axMigration: { otherSystems: [entry('second')] },
    });
  });

  it('replaces a summary or list that is not one', () => {
    expect(withOtherSystem({ axMigration: 'broken' }, entry('second'), false)).toEqual({
      axMigration: { otherSystems: [entry('second')] },
    });
    expect(
      withOtherSystem({ axMigration: { otherSystems: 'broken' } }, entry('second'), false)
    ).toEqual({ axMigration: { otherSystems: [entry('second')] } });
  });
  it('keeps the higher MQL level of the lead and the other system (#139)', () => {
    const fit = { level: 'fit' as const, signals: [], unmet: [] };
    const interest = { level: 'interest' as const, signals: ['support_deadline' as const], unmet: [] };
    const upgraded = withOtherSystem({ axMigration: { mql: fit } }, entry('second'), false, interest);
    expect(upgraded.axMigration).toMatchObject({ mql: interest });
    const kept = withOtherSystem({ axMigration: { mql: interest } }, entry('second'), false, fit);
    expect(kept.axMigration).toMatchObject({ mql: interest });
    // Without a judgement nothing about the MQL changes
    expect(withOtherSystem({ axMigration: {} }, entry('second'), false).axMigration).not.toHaveProperty('mql');
  });
});

describe('withOtherSystemUpdate', () => {
  it('changes only the recorded system of that submission', () => {
    const responses = { axMigration: { difficulty: 'medium', otherSystems: [entry('a'), entry('b')] } };
    expect(withOtherSystemUpdate(responses, 'b', { difficulty: 'high' })).toEqual({
      axMigration: {
        difficulty: 'medium',
        otherSystems: [entry('a'), { ...entry('b'), difficulty: 'high' }],
      },
    });
  });

  it('returns null when the submission is not recorded (nothing to write)', () => {
    expect(withOtherSystemUpdate({ axMigration: { otherSystems: [entry('a')] } }, 'b', {})).toBeNull();
    expect(withOtherSystemUpdate(null, 'b', {})).toBeNull();
    expect(withOtherSystemUpdate(['a'], 'b', {})).toBeNull();
  });
});
