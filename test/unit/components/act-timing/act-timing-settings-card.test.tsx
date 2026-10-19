/**
 * Organization settings of "when to act" (#151): what is saved, the range check and members
 * who cannot change them.
 */
import { ActTimingSettingsCard } from '@/components/features/act-timing/act-timing-settings-card';
import messages from '@/locales/ja/common.json';
import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  result: {} as Record<string, unknown>,
  mutate: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    actTiming: {
      settings: { useQuery: () => mocks.result },
      updateSettings: { useMutation: () => ({ mutate: mocks.mutate, isPending: false }) },
    },
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: mocks.error } }));

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';

const renderCard = () =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <ActTimingSettingsCard organizationId={ORG_ID} />
    </NextIntlClientProvider>
  );

beforeEach(() => {
  mocks.mutate.mockReset();
  mocks.error.mockReset();
  mocks.result = {
    data: { settings: { migrationMonths: 12, noticeMonths: 3 }, canEdit: true },
    isError: false,
  };
});

describe('ActTimingSettingsCard', () => {
  it('saves the months', () => {
    renderCard();
    fireEvent.change(screen.getByLabelText('移行にかかる期間（か月）'), { target: { value: '18' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(mocks.mutate).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      settings: { migrationMonths: 18, noticeMonths: 3 },
    });
  });

  it('refuses months out of range', () => {
    renderCard();
    const input = screen.getByLabelText('何か月前に知らせるか');
    fireEvent.change(input, { target: { value: '13' } });
    // The browser stops it (max=12); past that, the card checks the range itself
    expect(input).toBeInvalid();
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalled();
  });

  it('shows the settings read-only to members', () => {
    mocks.result = {
      data: { settings: { migrationMonths: 12, noticeMonths: 3 }, canEdit: false },
      isError: false,
    };
    renderCard();
    expect(screen.getByLabelText('移行にかかる期間（か月）')).toBeDisabled();
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
  });
});
