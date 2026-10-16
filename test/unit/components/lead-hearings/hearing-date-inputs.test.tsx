/**
 * Date and month pickers of the hearing editor (Refs #130), with the real ja messages
 */
import {
  HearingDateInput,
  HearingMonthInput,
} from '@/components/features/lead-hearings/hearing-date-inputs';
import messages from '@/locales/ja/common.json';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { type ComponentProps, useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const LABEL = 'Field A';
const ed = messages.leadHearings.editor;
const fill = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((text, [k, v]) => text.replace(`{${k}}`, String(v)), template);

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

function withIntl(children: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      {children}
    </NextIntlClientProvider>
  );
}

/** Holds the value like the editor does, and reports every change */
function DateHarness(
  props: { initial?: string; onChange: (v: string | undefined) => void } & Partial<
    ComponentProps<typeof HearingDateInput>
  >
) {
  const { initial, onChange, ...rest } = props;
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="date-a">{LABEL}</label>
      <HearingDateInput
        id="date-a"
        label={LABEL}
        readOnly={false}
        {...rest}
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
      />
    </>
  );
}

function MonthHarness({
  initial,
  onChange,
}: { initial?: string; onChange: (v: string | undefined) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <HearingMonthInput
      id="month-a"
      label={LABEL}
      readOnly={false}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

const pad = (n: number) => String(n).padStart(2, '0');
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

describe('HearingDateInput', () => {
  it('shows the stored date in Japanese order and takes a typed date', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(withIntl(<DateHarness initial="2026-10-15" onChange={onChange} />));

    const input = screen.getByLabelText(LABEL);
    expect(input).toHaveValue('2026/10/15');
    await user.clear(input);
    await user.type(input, '2026/11/5');
    expect(onChange).toHaveBeenLastCalledWith('2026-11-05');
    await user.tab();
    expect(input).toHaveValue('2026/11/05');
  });

  it('keeps an invalid date as typed with an error, without changing the value', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(withIntl(<DateHarness initial="2026-10-15" onChange={onChange} />));

    const input = screen.getByLabelText(LABEL);
    await user.clear(input);
    await user.type(input, '2026/02/30{Enter}');
    expect(input).toHaveValue('2026/02/30');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(ed.dateInvalid)).toBeInTheDocument();
    // Clearing the box (and leaving it) clears the value
    expect(onChange).not.toHaveBeenCalledWith(expect.stringMatching(/02-30/));
    await user.clear(input);
    await user.tab();
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(screen.queryByText(ed.dateInvalid)).not.toBeInTheDocument();
  });

  it('picks a day from the calendar, today, or clears it', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(withIntl(<DateHarness initial="2026-11-05" onChange={onChange} />));
    const openCalendar = () =>
      user.click(screen.getByRole('button', { name: fill(ed.openCalendar, { field: LABEL }) }));

    await openCalendar();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('2026年11月')).toBeInTheDocument();
    const day20 = within(dialog)
      .getAllByText('20')
      .map((el) => el.closest('button'))
      .find((button) => button && !button.className.includes('day-outside'));
    await user.click(day20 as HTMLButtonElement);
    expect(onChange).toHaveBeenLastCalledWith('2026-11-20');
    expect(screen.getByLabelText(LABEL)).toHaveValue('2026/11/20');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await openCalendar();
    await user.click(await screen.findByRole('button', { name: ed.today }));
    expect(onChange).toHaveBeenLastCalledWith(todayIso());

    await openCalendar();
    await user.click(await screen.findByRole('button', { name: ed.clear }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(screen.getByLabelText(LABEL)).toHaveValue('');
  });

  it('can be opened and used with the keyboard', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(withIntl(<DateHarness initial="2026-11-05" onChange={onChange} />));

    await user.click(screen.getByLabelText(LABEL));
    await user.tab(); // the calendar button
    await user.keyboard('{Enter}');
    await screen.findByRole('dialog');
    // The chosen day has the focus; move one day on and pick it
    await user.keyboard('{ArrowRight}{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('2026-11-06');
  });

  it('has no clear button for a date that must stay set, and restores a blanked box', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(withIntl(<DateHarness initial="2026-10-15" clearable={false} onChange={onChange} />));

    const input = screen.getByLabelText(LABEL);
    await user.clear(input);
    await user.tab();
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue('2026/10/15');

    await user.click(screen.getByRole('button', { name: fill(ed.openCalendar, { field: LABEL }) }));
    await screen.findByRole('dialog');
    expect(screen.queryByRole('button', { name: ed.clear })).not.toBeInTheDocument();
  });

  it('does nothing in read-only mode', () => {
    render(
      withIntl(
        <HearingDateInput
          id="date-a"
          label={LABEL}
          value="2026-10-15"
          readOnly
          onChange={vi.fn()}
        />
      )
    );
    expect(screen.getByRole('textbox')).toHaveAttribute('readonly');
    expect(
      screen.getByRole('button', { name: fill(ed.openCalendar, { field: LABEL }) })
    ).toBeDisabled();
  });
});

describe('HearingMonthInput', () => {
  const trigger = (text: string) => screen.getByRole('button', { name: `${LABEL}: ${text}` });

  it('picks a year and a month', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(withIntl(<MonthHarness initial="2027-03" onChange={onChange} />));

    await user.click(trigger('2027年3月'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('2027年')).toBeInTheDocument();
    // The chosen month has the focus
    expect(within(dialog).getByRole('button', { name: '2027年3月' })).toHaveFocus();
    expect(within(dialog).getByRole('button', { name: '2027年3月' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    await user.click(within(dialog).getByRole('button', { name: ed.nextYear }));
    await user.click(within(dialog).getByRole('button', { name: '2028年9月' }));
    expect(onChange).toHaveBeenLastCalledWith('2028-09');
    expect(trigger('2028年9月')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('offers this month and clear, starting on this year when nothing is chosen', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(withIntl(<MonthHarness onChange={onChange} />));
    const now = new Date();

    await user.click(trigger(ed.pickMonth));
    expect(await screen.findByText(`${now.getFullYear()}年`)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: ed.thisMonth }));
    expect(onChange).toHaveBeenLastCalledWith(`${now.getFullYear()}-${pad(now.getMonth() + 1)}`);

    await user.click(trigger(`${now.getFullYear()}年${now.getMonth() + 1}月`));
    await user.click(await screen.findByRole('button', { name: ed.clear }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(trigger(ed.pickMonth)).toBeInTheDocument();
  });
});
