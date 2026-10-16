/**
 * Runner renderers for the builder's question types (scale, number_range, text) and the
 * per-type checks of saved answers (#116, runner review notes on #115)
 */
import { QuestionField } from '@/components/features/diagnosis-runner/question-field';
import {
  type QuestionView,
  keepValidAnswers,
  localizeQuestion,
  toQuestionView,
} from '@/components/features/diagnosis-runner/question-view';
import { DiagnosisRunnerProvider } from '@/components/features/diagnosis-runner/runner-context';
import { toPublicDefinition } from '@/lib/features/diagnosis-builder/evaluate';
import type { DiagnosticQuestion } from '@/lib/features/diagnostics/types';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { cloudReadiness } from '../../../fixtures/diagnosis-builder';

const messages = {
  runner: {
    optional: 'Optional',
    quoted: '"{label}"',
    listJoiner: ' or ',
    multipleHint: 'Choose all that apply',
    multipleHintExclusive: 'Choose all ({options} clears the others)',
    scaleHint: 'Choose from {min} to {max}',
    numberHint: 'A number from {min} to {max}{unit}',
    textCount: '{count} / {max}',
  },
};

const wrap = (ui: ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages} timeZone="Asia/Tokyo">
    <DiagnosisRunnerProvider config={{ namespace: 'runner', idPrefix: 'demo' }}>
      {ui}
    </DiagnosisRunnerProvider>
  </NextIntlClientProvider>
);

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const publicQuestions = toPublicDefinition(cloudReadiness()).questions;
const view = (id: string): QuestionView => {
  const question = publicQuestions.find((q) => q.id === id);
  if (!question) throw new Error(id);
  return toQuestionView(question);
};

function renderField(question: QuestionView, value?: string | string[] | number, error?: string) {
  const onValue = vi.fn();
  const onSingle = vi.fn();
  const onToggle = vi.fn();
  const utils = render(
    wrap(
      <QuestionField
        question={question}
        value={value}
        error={error}
        onSingle={onSingle}
        onToggle={onToggle}
        onValue={onValue}
      />
    )
  );
  return { ...utils, onValue, onSingle, onToggle };
}

describe('scale question', () => {
  it('offers each step as a radio button, with the end labels, and reports the number', async () => {
    const user = userEvent.setup();
    const { onValue } = renderField(view('confidence'));
    const group = screen.getByRole('group', { name: '自信の度合い' });
    expect(group).toHaveAccessibleDescription('Choose from 1 to 5');
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    expect(screen.getByText('低い')).toBeInTheDocument();
    expect(screen.getByText('高い')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /4/ }));
    expect(onValue).toHaveBeenCalledWith(4);
  });

  it('shows the chosen step as checked', () => {
    renderField(view('confidence'), 3);
    expect(screen.getByRole('radio', { name: /3/ })).toBeChecked();
  });
});

describe('number question', () => {
  it('is named by the question, tells the range and unit, and reports numbers', async () => {
    const user = userEvent.setup();
    const { onValue } = renderField(view('team_size'));
    const input = screen.getByRole('textbox', { name: '担当者の人数' });
    expect(screen.getByRole('group', { name: '担当者の人数' })).toHaveAccessibleDescription(
      'A number from 1 to 1,000人'
    );
    await user.type(input, '150');
    expect(onValue).toHaveBeenLastCalledWith(150);
    expect(screen.getByText('人')).toBeInTheDocument();
  });

  it('accepts full-width digits and clears the answer for text that is not a number', async () => {
    const user = userEvent.setup();
    const { onValue } = renderField(view('team_size'));
    const input = screen.getByRole('textbox', { name: '担当者の人数' });
    await user.type(input, '１２');
    expect(onValue).toHaveBeenLastCalledWith(12);
    await user.clear(input);
    expect(onValue).toHaveBeenLastCalledWith(undefined);
    await user.type(input, 'abc');
    expect(onValue).toHaveBeenLastCalledWith(undefined);
    expect(input).toHaveValue('abc');
  });

  it('shows a restored answer and marks an error', () => {
    renderField(view('team_size'), 42, 'Enter a number');
    const input = screen.getByRole('textbox', { name: /担当者の人数/ });
    expect(input).toHaveValue('42');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter a number', { selector: 'p' })).toBeInTheDocument();
  });
});

describe('text question', () => {
  it('limits the length, counts the characters and reports the text', async () => {
    const user = userEvent.setup();
    const { onValue, rerender } = renderField(view('notes'));
    const input = screen.getByRole('textbox', { name: /自由記述/ });
    expect(input).toHaveAttribute('maxLength', '200');
    expect(screen.getByText('Optional')).toBeInTheDocument();
    await user.type(input, 'a');
    expect(onValue).toHaveBeenLastCalledWith('a');
    rerender(
      wrap(
        <QuestionField
          question={view('notes')}
          value="abc"
          onSingle={vi.fn()}
          onToggle={vi.fn()}
          onValue={onValue}
        />
      )
    );
    expect(input).toHaveAccessibleDescription('3 / 200');
  });

  it('a multi-line text question is a text area', () => {
    const question = { ...view('notes'), multiline: true } as QuestionView;
    renderField(question);
    expect(screen.getByRole('textbox', { name: /自由記述/ }).tagName).toBe('TEXTAREA');
  });
});

describe('question views', () => {
  it('drops blank descriptions and hints (builder definitions may hold empty strings)', () => {
    const def = cloudReadiness();
    const hosting = def.questions[0] as Extract<(typeof def.questions)[number], { type: 'single' }>;
    hosting.description = '';
    hosting.options[0].hint = '  ';
    const question = toQuestionView(toPublicDefinition(def).questions[0]);
    expect(question.description).toBeUndefined();
    expect(question.type === 'single' && question.options[0].hint).toBeUndefined();

    const coded: DiagnosticQuestion = {
      id: 'q',
      type: 'single',
      label: { ja: '質問', en: 'Question' },
      description: { ja: '', en: '' },
      required: true,
      options: [{ value: 'a', label: { ja: 'A', en: 'A' }, hint: { ja: '', en: '' } }],
    };
    const localized = localizeQuestion(coded, 'ja');
    expect(localized.description).toBeUndefined();
    expect(localized.options[0].hint).toBeUndefined();
  });

  it('a blank description renders no description element', () => {
    const question = { ...view('hosting'), description: undefined };
    renderField(question);
    expect(screen.getByRole('group', { name: /システムはどこで/ })).not.toHaveAttribute(
      'aria-describedby'
    );
  });
});

describe('keepValidAnswers', () => {
  const questions = publicQuestions.map(toQuestionView);

  it('keeps answers that still fit their question, by type', () => {
    const saved = {
      hosting: 'cloud',
      practices: ['iac'],
      confidence: 3,
      team_size: 150,
      notes: 'memo',
    };
    expect(keepValidAnswers(questions, saved)).toEqual(saved);
  });

  it('drops answers that no longer fit (type, range, step, length, unknown, empty)', () => {
    expect(
      keepValidAnswers(questions, {
        hosting: 'mainframe',
        practices: [],
        confidence: 9,
        team_size: 1.5,
        notes: 'x'.repeat(201),
        removed: 'a',
      })
    ).toEqual({});
    expect(keepValidAnswers(questions, { confidence: '3', team_size: '150', notes: '' })).toEqual(
      {}
    );
  });
});
