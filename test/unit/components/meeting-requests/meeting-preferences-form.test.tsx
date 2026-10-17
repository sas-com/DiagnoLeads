/**
 * Preferred dates for the first meeting on the result page (#155): what is sent, and the
 * answers for saved, already confirmed and refused dates.
 */
import { MeetingPreferencesForm } from '@/components/features/diagnosis-runner/meeting-preferences-form';
import messages from '@/locales/ja/common.json';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SUBMISSION_ID = '33333333-3333-4333-8333-333333333333';
const fetchMock = vi.fn();

const renderForm = (onSaved = vi.fn()) =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <MeetingPreferencesForm endpoint="/api/x/consultation" submissionId={SUBMISSION_ID} onSaved={onSaved} />
    </NextIntlClientProvider>
  );

const answer = (status: number, body: unknown) =>
  fetchMock.mockResolvedValue({ ok: status < 400, status, json: async () => body });

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
  it('offers dates from tomorrow up to 60 days ahead and three options', () => {
    renderForm();
    const first = screen.getByLabelText('第1希望の日付');
    expect(first).toHaveAttribute('min', '2026-10-17');
    expect(first).toHaveAttribute('max', '2026-12-15');
    expect(first).toBeRequired();
    expect(screen.getByLabelText('第3希望の開始時刻')).toHaveValue('10:00');
  });

  it('sends the filled options, the attendees and the format', async () => {
    const onSaved = vi.fn();
    answer(200, { ok: true, preferences: 'saved' });
    renderForm(onSaved);
    fireEvent.change(screen.getByLabelText('第1希望の日付'), { target: { value: '2026-10-20' } });
    fireEvent.change(screen.getByLabelText('第1希望の開始時刻'), { target: { value: '14:00' } });
    fireEvent.change(screen.getByLabelText('第2希望の日付'), { target: { value: '2026-10-21' } });
    fireEvent.click(screen.getByLabelText('経営層・決裁者'));
    fireEvent.click(screen.getByLabelText('オンライン'));
    fireEvent.click(screen.getByRole('button', { name: '希望日時を送る' }));

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
      },
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it('says so when the date is already set, and asks to check refused dates', async () => {
    answer(200, { ok: true, preferences: 'confirmed' });
    const { unmount } = renderForm();
    fireEvent.change(screen.getByLabelText('第1希望の日付'), { target: { value: '2026-10-20' } });
    fireEvent.click(screen.getByRole('button', { name: '希望日時を送る' }));
    await waitFor(() => expect(screen.getByText(/日程はすでに決まっています/)).toBeInTheDocument());
    unmount();

    answer(200, { ok: true, preferences: 'out_of_range' });
    renderForm();
    fireEvent.change(screen.getByLabelText('第1希望の日付'), { target: { value: '2026-10-20' } });
    fireEvent.click(screen.getByRole('button', { name: '希望日時を送る' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('日付を確認してください'));
  });
});
