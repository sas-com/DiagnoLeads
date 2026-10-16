import { stepProgress } from '@/components/features/diagnosis-runner/progress';
import {
  keepValidChoiceAnswers,
  localizeQuestion,
  toggleChoice,
} from '@/components/features/diagnosis-runner/question-view';
import type { DiagnosticQuestion } from '@/lib/features/diagnostics/types';
import { describe, expect, it } from 'vitest';

describe('toggleChoice', () => {
  const exclusive = ['none', 'unknown'];

  it('adds and removes ordinary options', () => {
    expect(toggleChoice(['a'], 'b', true, exclusive)).toEqual({
      next: ['a', 'b'],
      clearedOthers: false,
    });
    expect(toggleChoice(['a', 'b'], 'a', false, exclusive)).toEqual({
      next: ['b'],
      clearedOthers: false,
    });
  });

  it('an exclusive option clears the others, and says so', () => {
    expect(toggleChoice(['a', 'b'], 'none', true, exclusive)).toEqual({
      next: ['none'],
      clearedOthers: true,
    });
  });

  it('an ordinary option clears the exclusive ones', () => {
    expect(toggleChoice(['unknown'], 'a', true, exclusive)).toEqual({
      next: ['a'],
      clearedOthers: true,
    });
  });

  it('works without exclusive options', () => {
    expect(toggleChoice([], 'a', true)).toEqual({ next: ['a'], clearedOthers: false });
  });
});

describe('keepValidChoiceAnswers', () => {
  const questions = [
    { id: 's', type: 'single' as const, options: [{ value: 'x' }, { value: 'y' }] },
    { id: 'm', type: 'multiple' as const, options: [{ value: 'x' }, { value: 'y' }] },
  ];

  it('keeps answers that are still choices of their question', () => {
    expect(keepValidChoiceAnswers(questions, { s: 'x', m: ['x', 'y'] })).toEqual({
      s: 'x',
      m: ['x', 'y'],
    });
  });

  it('drops unknown questions, removed options and wrong shapes', () => {
    expect(
      keepValidChoiceAnswers(questions, { gone: 'x', s: 'z', m: ['x', 'z'] })
    ).toEqual({});
    expect(keepValidChoiceAnswers(questions, { s: ['x'], m: 'x' })).toEqual({});
    expect(keepValidChoiceAnswers(questions, { m: [] })).toEqual({});
  });
});

describe('localizeQuestion', () => {
  it('picks the texts of one language and keeps the rest', () => {
    const question: DiagnosticQuestion = {
      id: 'q',
      type: 'multiple',
      label: { ja: '質問', en: 'Question' },
      required: false,
      options: [
        { value: 'a', label: { ja: 'あ', en: 'A' }, hint: { ja: 'ヒント', en: 'Hint' } },
        { value: 'b', label: { ja: 'い', en: 'B' } },
      ],
      exclusiveOptions: ['b'],
    };
    expect(localizeQuestion(question, 'en')).toEqual({
      id: 'q',
      type: 'multiple',
      label: 'Question',
      description: undefined,
      required: false,
      options: [
        { value: 'a', label: 'A', hint: 'Hint' },
        { value: 'b', label: 'B', hint: undefined },
      ],
      exclusiveOptions: ['b'],
    });
  });
});

describe('stepProgress', () => {
  it('counts from one and reaches 100% on the last step', () => {
    expect(stepProgress(0, 5)).toEqual({ current: 1, percent: 20 });
    expect(stepProgress(2, 3)).toEqual({ current: 3, percent: 100 });
    // Never beyond the total (a shorter path)
    expect(stepProgress(7, 5)).toEqual({ current: 5, percent: 100 });
  });
});
