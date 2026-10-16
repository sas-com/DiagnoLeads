import { LiveRegion, useAnnouncer } from '@/components/features/diagnosis-runner/announcer';
import { focusFirstError, scrollToStart } from '@/components/features/diagnosis-runner/focus';
import { usePrintTitle } from '@/components/features/diagnosis-runner/print';
import { QuestionField } from '@/components/features/diagnosis-runner/question-field';
import type { ChoiceQuestionView } from '@/components/features/diagnosis-runner/question-view';
import { DiagnosisRunnerProvider } from '@/components/features/diagnosis-runner/runner-context';
import { StepNavigation, SubmitErrorAlert } from '@/components/features/diagnosis-runner/step-layout';
import { StepProgress } from '@/components/features/diagnosis-runner/step-progress';
import { act, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { type ReactNode, createRef } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/** A namespace of its own: the parts are not tied to the AX texts */
const messages = {
  runner: {
    optional: 'Optional',
    quoted: '"{label}"',
    listJoiner: ' or ',
    multipleHint: 'Choose all that apply',
    multipleHintExclusive: 'Choose all that apply ({options} clears the others)',
    progress: 'STEP {current} / {total}',
    back: 'Back',
    next: 'Next',
    submit: 'Send',
    submitting: 'Sending',
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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const multiple: ChoiceQuestionView = {
  id: 'tools',
  type: 'multiple',
  label: 'Which tools?',
  required: true,
  options: [
    { value: 'sheets', label: 'Spreadsheets', hint: 'Excel and the like' },
    { value: 'crm', label: 'CRM' },
    { value: 'none', label: 'None' },
  ],
  exclusiveOptions: ['none'],
};

describe('QuestionField', () => {
  it('renders a multiple-choice question with the exclusive options named', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(
      wrap(
        <QuestionField
          question={multiple}
          value={['crm']}
          onSingle={vi.fn()}
          onToggle={onToggle}
        />
      )
    );
    const group = screen.getByRole('group', { name: 'Which tools?' });
    expect(group).toHaveAccessibleDescription('Choose all that apply ("None" clears the others)');
    expect(within(group).getByRole('checkbox', { name: 'CRM' })).toBeChecked();
    expect(within(group).getByRole('checkbox', { name: 'Spreadsheets' })).toHaveAccessibleDescription(
      'Excel and the like'
    );
    await user.click(within(group).getByRole('checkbox', { name: 'None' }));
    expect(onToggle).toHaveBeenCalledWith('none', true);
  });

  it('renders a single-choice question, marks it optional and names its error once', async () => {
    const onSingle = vi.fn();
    const user = userEvent.setup();
    render(
      wrap(
        <QuestionField
          question={{
            id: 'size',
            type: 'single',
            label: 'Team size',
            description: 'People who use it daily',
            required: false,
            options: [
              { value: 'small', label: '1-9' },
              { value: 'large', label: '10+' },
            ],
          }}
          value={undefined}
          error="Choose one"
          onSingle={onSingle}
          onToggle={vi.fn()}
        />
      )
    );
    const group = screen.getByRole('group', { name: /Team size\s*Optional\s*Choose one/ });
    expect(group).toHaveAccessibleDescription('People who use it daily');
    expect(document.getElementById('q-size-error')).toHaveTextContent('Choose one');
    await user.click(within(group).getByRole('radio', { name: '10+' }));
    expect(onSingle).toHaveBeenCalledWith('large');
  });

  it('needs a runner provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(
        <NextIntlClientProvider locale="en" messages={messages}>
          <QuestionField question={multiple} value={[]} onSingle={vi.fn()} onToggle={vi.fn()} />
        </NextIntlClientProvider>
      )
    ).toThrow(/DiagnosisRunnerProvider/);
  });
});

describe('StepProgress and StepNavigation', () => {
  it('names the step in a focusable heading with the configured id', () => {
    const ref = createRef<HTMLHeadingElement>();
    render(wrap(<StepProgress headingLevel="h3" headingRef={ref} step={1} total={4} title="Usage" />));
    const heading = screen.getByRole('heading', { level: 3, name: /STEP 2 \/ 4\s*Usage/ });
    expect(heading).toHaveAttribute('id', 'demo-step-heading');
    expect(ref.current).toBe(heading);
    expect(heading.nextElementSibling?.firstElementChild).toHaveStyle({ width: '50%' });
  });

  it('keeps the buttons focusable while sending', async () => {
    const onBack = vi.fn();
    const user = userEvent.setup();
    render(wrap(<StepNavigation isLast submitting onBack={onBack} onNext={vi.fn()} />));
    const back = screen.getByRole('button', { name: 'Back' });
    expect(back).toHaveAttribute('aria-disabled', 'true');
    await user.click(back);
    expect(onBack).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Sending' })).toHaveAttribute('type', 'submit');
  });

  it('shows a send error as an alert', () => {
    render(wrap(<SubmitErrorAlert error={{ message: 'Try again', kind: 'other', run: 1 }} />));
    expect(screen.getByRole('alert')).toHaveTextContent('Try again');
  });
});

describe('announcer and focus helpers', () => {
  it('announces a repeated message again by changing it slightly', () => {
    const { result } = renderHook(() => useAnnouncer());
    act(() => result.current.announce('Cleared'));
    expect(result.current.announcement).toBe('Cleared');
    act(() => result.current.announce('Cleared'));
    expect(result.current.announcement).toBe('Cleared ');
    act(() => result.current.announce('Cleared'));
    expect(result.current.announcement).toBe('Cleared');
  });

  it('renders the live region politely', () => {
    render(<LiveRegion message="Done" />);
    expect(screen.getByText('Done')).toHaveAttribute('aria-live', 'polite');
  });

  it('focuses the first control of the group whose legend has an error', () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(
      <>
        <fieldset>
          <legend id="q-a">A</legend>
          <button type="button">first</button>
        </fieldset>
        <input id="contact-email" aria-label="email" />
      </>
    );
    focusFirstError('q-a');
    expect(screen.getByRole('button', { name: 'first' })).toHaveFocus();
    focusFirstError('contact-email');
    expect(screen.getByLabelText('email')).toHaveFocus();
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
  });

  it('scrolls without animation when the respondent prefers less motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }));
    const element = document.createElement('div');
    element.scrollIntoView = vi.fn();
    scrollToStart(element);
    expect(element.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
  });
});

describe('usePrintTitle', () => {
  it('names the page while printing and puts the title back afterwards', () => {
    document.title = 'Page';
    const { unmount } = renderHook(() => usePrintTitle(() => 'Result 2026-10-16'));
    window.dispatchEvent(new Event('beforeprint'));
    expect(document.title).toBe('Result 2026-10-16');
    window.dispatchEvent(new Event('afterprint'));
    expect(document.title).toBe('Page');
    unmount();
    window.dispatchEvent(new Event('beforeprint'));
    expect(document.title).toBe('Page');
  });
});
