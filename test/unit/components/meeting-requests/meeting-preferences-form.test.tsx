/**
 * Preferred dates for the first meeting on the result page (#155): what is sent, and the
 * answers for saved, already confirmed and refused dates. #244: the duration guide, dates from a
 * calendar limited to tomorrow .. 60 days ahead with the weekday, the topics and the note, and
 * the inline checks (first option required, the same date and time twice).
 */
import { MeetingPreferencesForm } from '@/components/features/diagnosis-runner/meeting-preferences-form';
import messages from '@/locales/ja/common.json';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ComponentProps } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const SUBMISSION_ID = '33333333-3333-4333-8333-333333333333';
const fetchMock = vi.fn();

const renderForm = (
  onSaved = vi.fn(),
  props: Pick<ComponentProps<typeof MeetingPreferencesForm>, 'duration' | 'fixedFormat'> = {}
) =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <MeetingPreferencesForm
        endpoint="/api/x/consultation"
        submissionId={SUBMISSION_ID}
        onSaved={onSaved}
        {...props}
      />
    </NextIntlClientProvider>
  );

const answer = (status: number, body: unknown) =>
  fetchMock.mockResolvedValue({ ok: status < 400, status, json: async () => body });

const dateButton = (number: number) =>
  screen.getByRole('button', { name: new RegExp(`^第${number}希望の日付 `) });

/** A day button of the open calendar (not one of the neighbouring months) */
const dayButton = (dialog: HTMLElement, day: number) =>
  within(dialog)
    .getAllByText(String(day))
    .map((element) => element.closest('button'))
    .find((button) => button && !button.className.includes('day-outside')) as HTMLButtonElement;

async function pickDate(user: ReturnType<typeof userEvent.setup>, number: number, day: number) {
  await user.click(dateButton(number));
  const dialog = await screen.findByRole('dialog');
  await user.click(dayButton(dialog, day));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  // Friday 2026-10-16 in Japan
  vi.setSystemTime(new Date('2026-10-16T01:00:00Z'));
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('MeetingPreferencesForm', () => {
  it('shows the duration guide, three options and the email note', () => {
    renderForm();
    expect(screen.getByText('所要時間の目安：60分程度')).toBeInTheDocument();
    expect(screen.getByText('日程は担当者が決めて、メールでご連絡します。')).toBeInTheDocument();
    expect(dateButton(1)).toHaveAccessibleName('第1希望の日付 日付を選ぶ');
    expect(dateButton(3)).toBeInTheDocument();
    expect(screen.getByLabelText('第3希望の開始時刻')).toHaveValue('10:00');
    expect(screen.getByText('必須')).toBeInTheDocument();
  });

  it('offers days from tomorrow up to 60 days ahead in the calendar', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(dateButton(1));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('2026年10月')).toBeInTheDocument();
    // Today is not offered, tomorrow is
    expect(dayButton(dialog, 16)).toBeDisabled();
    expect(dayButton(dialog, 17)).toBeEnabled();
    // No earlier month
    expect(within(dialog).getByRole('button', { name: '前の月' })).toBeDisabled();

    await user.click(within(dialog).getByRole('button', { name: '次の月' }));
    await user.click(within(dialog).getByRole('button', { name: '次の月' }));
    expect(within(dialog).getByText('2026年12月')).toBeInTheDocument();
    expect(dayButton(dialog, 15)).toBeEnabled();
    expect(dayButton(dialog, 16)).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: '次の月' })).toBeDisabled();
  });

  it('names the calendar, marks today in Japan and fits a 320px phone', async () => {
    // 23:30 on 10-15 UTC is already Friday 10-16 in Japan
    vi.setSystemTime(new Date('2026-10-15T23:30:00Z'));
    const user = userEvent.setup();
    renderForm();
    await user.click(dateButton(2));
    const dialog = await screen.findByRole('dialog', { name: '第2希望の日付を選ぶ' });
    expect(dayButton(dialog, 16).className).toContain('border-ax-teal-dark');
    expect(dayButton(dialog, 15).className).not.toContain('border-ax-teal-dark');
    // The keyboard focus ring follows the site's colour too, not the button's brand ring (#537)
    for (const button of [dayButton(dialog, 20), within(dialog).getByRole('button', { name: '次の月' })]) {
      expect(button).toHaveClass('focus-visible:ring-ax-teal-dark');
      expect(button).not.toHaveClass('focus-visible:ring-brand-500');
    }
    // 7 x 40px + 2 x 8px padding + 2px border = 298px below sm (320px - 2 x 8px = 304px);
    // 44px days from sm
    expect(dayButton(dialog, 20)).toHaveClass('h-10', 'w-10', 'sm:h-11', 'sm:w-11');
    expect(dialog.querySelector('.rdp')).toHaveClass('p-2', 'sm:p-3');
    expect(dialog.querySelector('.rdp')).not.toHaveClass('p-3');
  });

  it('labels the chosen day with the weekday, and clears it', async () => {
    const user = userEvent.setup();
    renderForm();
    await pickDate(user, 1, 21);
    expect(dateButton(1)).toHaveAccessibleName('第1希望の日付 2026/10/21（水）');
    // Focus returns to the button that opened the calendar
    expect(dateButton(1)).toHaveFocus();

    await user.click(screen.getByRole('button', { name: '第1希望の日付を消す' }));
    expect(dateButton(1)).toHaveAccessibleName('第1希望の日付 日付を選ぶ');
    expect(screen.queryByRole('button', { name: '第1希望の日付を消す' })).not.toBeInTheDocument();
  });

  it('can be used with the keyboard', async () => {
    const user = userEvent.setup();
    renderForm();
    dateButton(2).focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('dialog');
    // The first day offered has the focus; move one day on and pick it
    await user.keyboard('{ArrowRight}{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(dateButton(2)).toHaveAccessibleName('第2希望の日付 2026/10/18（日）');
  });

  it('asks for the first option before sending', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole('button', { name: '希望日時を送る' }));
    expect(screen.getByText('第1希望の日付を選んでください。')).toBeInTheDocument();
    expect(dateButton(1)).toHaveAttribute('aria-invalid', 'true');
    expect(dateButton(1)).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();

    await pickDate(user, 1, 20);
    expect(screen.queryByText('第1希望の日付を選んでください。')).not.toBeInTheDocument();
  });

  it('does not take the same date and time twice', async () => {
    const user = userEvent.setup();
    renderForm();
    await pickDate(user, 1, 20);
    await pickDate(user, 2, 20);
    expect(screen.getByText('第1希望と同じ日時です。日付か時刻を変えてください。')).toBeInTheDocument();
    expect(screen.getByLabelText('第2希望の開始時刻')).toHaveAttribute('aria-invalid', 'true');
    await user.click(screen.getByRole('button', { name: '希望日時を送る' }));
    expect(fetchMock).not.toHaveBeenCalled();

    // Another time is fine
    await user.selectOptions(screen.getByLabelText('第2希望の開始時刻'), '14:00');
    expect(screen.queryByText(/第1希望と同じ日時です/)).not.toBeInTheDocument();
  });

  it('counts the note up to 300 characters', async () => {
    const user = userEvent.setup();
    renderForm();
    const note = screen.getByLabelText('その他・具体的なご相談内容（任意）');
    expect(note).toHaveAttribute('maxLength', '300');
    expect(screen.getByText('0/300文字')).toBeInTheDocument();
    await user.type(note, '移行の時期');
    expect(screen.getByText('5/300文字')).toBeInTheDocument();
    expect(note).toHaveAccessibleDescription('5/300文字');
  });

  it('sends the filled options, the attendees, the format, the topics and the note', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    answer(200, { ok: true, preferences: 'saved' });
    renderForm(onSaved);
    await pickDate(user, 1, 20);
    await user.selectOptions(screen.getByLabelText('第1希望の開始時刻'), '14:00');
    await pickDate(user, 2, 21);
    await user.click(screen.getByLabelText('経営層・決裁者'));
    await user.click(screen.getByLabelText('オンライン'));
    await user.click(screen.getByLabelText('費用の目安'));
    await user.click(screen.getByLabelText('現行システムの調査・資産の棚卸し'));
    await user.type(screen.getByLabelText('その他・具体的なご相談内容（任意）'), '  来期の予算  ');
    await user.click(screen.getByRole('button', { name: '希望日時を送る' }));

    await waitFor(() => expect(screen.getByText(/ご希望を受け付けました/)).toBeInTheDocument());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      submissionId: SUBMISSION_ID,
      preferences: {
        candidates: [
          { date: '2026-10-20', time: '14:00' },
          { date: '2026-10-21', time: '10:00' },
        ],
        attendeeRoles: ['executive'],
        meetingFormat: 'online',
        topics: ['cost', 'current_assessment'],
        topicNote: '来期の予算',
      },
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it('shows another duration and sends the only format without asking (#455)', async () => {
    const user = userEvent.setup();
    answer(200, { ok: true, preferences: 'saved' });
    renderForm(vi.fn(), { duration: '所要時間の目安：30分程度（オンライン）', fixedFormat: 'online' });
    expect(screen.getByText('所要時間の目安：30分程度（オンライン）')).toBeInTheDocument();
    expect(screen.queryByText('所要時間の目安：60分程度')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'ご希望の形式' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('訪問')).not.toBeInTheDocument();

    await pickDate(user, 1, 20);
    await user.click(screen.getByRole('button', { name: '希望日時を送る' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).preferences.meetingFormat).toBe('online');
  });

  it('sends no topics and no note when none were given', async () => {
    const user = userEvent.setup();
    answer(200, { ok: true, preferences: 'saved' });
    renderForm();
    await pickDate(user, 1, 20);
    await user.click(screen.getByRole('button', { name: '希望日時を送る' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).preferences).toMatchObject({
      topics: [],
      topicNote: null,
    });
  });

  it('says so when the date is already set, and asks to check refused dates', async () => {
    const user = userEvent.setup();
    answer(200, { ok: true, preferences: 'confirmed' });
    const { unmount } = renderForm();
    await pickDate(user, 1, 20);
    await user.click(screen.getByRole('button', { name: '希望日時を送る' }));
    await waitFor(() => expect(screen.getByText(/日程はすでに決まっています/)).toBeInTheDocument());
    unmount();

    answer(200, { ok: true, preferences: 'out_of_range' });
    renderForm();
    await pickDate(user, 1, 20);
    await user.click(screen.getByRole('button', { name: '希望日時を送る' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('日付を確認してください'));
  });

  it('does not ask to retry when the answer cannot take preferences (#270)', async () => {
    const user = userEvent.setup();
    answer(200, { ok: true, preferences: 'unavailable' });
    renderForm();
    await pickDate(user, 1, 20);
    await user.click(screen.getByRole('button', { name: '希望日時を送る' }));
    await waitFor(() =>
      expect(screen.getByText(/担当者からご連絡する際にお伺いします/)).toBeInTheDocument()
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '希望日時を送る' })).not.toBeInTheDocument();
  });
});
