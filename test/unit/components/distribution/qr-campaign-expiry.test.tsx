/**
 * The expiry of a QR campaign on the settings page (#695): shown on every campaign in Japan time,
 * marked when the server says it has passed, and set, extended or cleared by those who can
 * manage campaigns. A day entered is sent as the end of that day in Japan, and a day already over
 * there is not taken; clearing sends null; only expiresAt is sent, so a change of the expiry
 * changes nothing else (#610).
 */
import { QrCampaignExpiry } from '@/components/features/distribution/qr-campaign-expiry';
import en from '@/locales/en/common.json';
import ja from '@/locales/ja/common.json';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  invalidate: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  isPending: false,
  options: undefined as
    | undefined
    | {
        onSuccess: (data: unknown, variables: { data: { expiresAt?: string | null } }) => void;
        onError: () => void;
      },
}));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({ distribution: { listCampaigns: { invalidate: mocks.invalidate } } }),
    distribution: {
      updateCampaign: {
        useMutation: (options: NonNullable<typeof mocks.options>) => {
          mocks.options = options;
          return { mutate: mocks.mutate, isPending: mocks.isPending };
        },
      },
    },
  },
}));
vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }));

const ORG = '660e8400-e29b-41d4-a716-446655440000';
const CAMPAIGN = '770e8400-e29b-41d4-a716-446655440001';
/** The end of 31 October 2026 in Japan, as the page stores it */
const END_OF_31_OCTOBER = new Date('2026-10-31T14:59:59.999Z');

type Props = Partial<ComponentProps<typeof QrCampaignExpiry>>;

function renderExpiry(props: Props = {}, locale: 'ja' | 'en' = 'ja') {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === 'ja' ? ja : en}
      timeZone="UTC"
      onError={(error) => {
        throw error;
      }}
    >
      <QrCampaignExpiry
        organizationId={ORG}
        campaignId={CAMPAIGN}
        expiresAt={END_OF_31_OCTOBER}
        expired={false}
        canManage
        {...props}
      />
    </NextIntlClientProvider>
  );
}

/** The editor that opens from 期限を変える */
function openEditor() {
  fireEvent.click(screen.getByRole('button', { name: '期限を変える' }));
  const input = screen.getByLabelText('この日の終わりまで開く（日本時間）') as HTMLInputElement;
  const editor = input.closest('div') as HTMLElement;
  return { input, editor };
}

/** What the mutation was sent, and its success as the server would answer */
function sentAndAnswered() {
  expect(mocks.mutate).toHaveBeenCalledTimes(1);
  const [variables] = mocks.mutate.mock.calls[0];
  mocks.options?.onSuccess({}, variables);
  return variables;
}

describe('QrCampaignExpiry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isPending = false;
    // 25 October 2026, 21:00 in Japan (still the 25th in UTC)
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-25T12:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('what it shows', () => {
    it('shows the expiry in Japan time, whatever the time zone of the page', () => {
      renderExpiry();
      expect(screen.getByText('2026/10/31 23:59 まで（日本時間）')).toBeInTheDocument();
      expect(screen.queryByText('期限切れ')).toBeNull();
    });

    it('shows a campaign without an expiry', () => {
      renderExpiry({ expiresAt: null });
      expect(screen.getByText('期限なし')).toBeInTheDocument();
    });

    it('marks an expired campaign, which the server decided by the entry’s rule', () => {
      renderExpiry({ expiresAt: new Date('2026-10-01T14:59:59.999Z'), expired: true });
      expect(screen.getByText('期限切れ')).toBeInTheDocument();
    });

    it('shows no way to change it to those who cannot manage campaigns', () => {
      renderExpiry({ canManage: false, expired: true });
      expect(screen.getByText('期限切れ')).toBeInTheDocument();
      expect(screen.queryByRole('button')).toBeNull();
    });

    it('reads in English', () => {
      renderExpiry({ expired: true }, 'en');
      expect(screen.getByText('Until Oct 31, 2026, 11:59 PM (Japan time)')).toBeInTheDocument();
      expect(screen.getByText('Expired')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Change expiry' })).toBeInTheDocument();
    });
  });

  describe('changing it', () => {
    it('starts from the last day the campaign is open', () => {
      renderExpiry();
      expect(openEditor().input.value).toBe('2026-10-31');
    });

    it('starts from the day before for an expiry set at midnight in Japan (through the API)', () => {
      renderExpiry({ expiresAt: new Date('2026-10-31T15:00:00.000Z') });
      expect(openEditor().input.value).toBe('2026-10-31');
    });

    it('extends it to the end of the chosen day in Japan, sending the expiry alone', () => {
      renderExpiry({ expired: true, expiresAt: new Date('2026-10-01T14:59:59.999Z') });
      const { input, editor } = openEditor();
      fireEvent.change(input, { target: { value: '2026-11-30' } });
      fireEvent.click(within(editor).getByRole('button', { name: '保存' }));

      expect(sentAndAnswered()).toEqual({
        organizationId: ORG,
        id: CAMPAIGN,
        data: { expiresAt: '2026-11-30T14:59:59.999Z' },
      });
      expect(mocks.toastSuccess).toHaveBeenCalledWith('期限を変えました');
      expect(mocks.invalidate).toHaveBeenCalled();
    });

    it('sets one on a campaign without an expiry, where there is nothing to clear', () => {
      renderExpiry({ expiresAt: null });
      const { input, editor } = openEditor();
      expect(input.value).toBe('');
      expect(within(editor).queryByRole('button', { name: '期限を消す' })).toBeNull();
      fireEvent.change(input, { target: { value: '2027-01-15' } });
      fireEvent.click(within(editor).getByRole('button', { name: '保存' }));

      expect(sentAndAnswered().data).toEqual({ expiresAt: '2027-01-15T14:59:59.999Z' });
    });

    it('clears it by sending null', () => {
      renderExpiry({ expired: true });
      const { editor } = openEditor();
      fireEvent.click(within(editor).getByRole('button', { name: '期限を消す' }));

      expect(sentAndAnswered()).toEqual({
        organizationId: ORG,
        id: CAMPAIGN,
        data: { expiresAt: null },
      });
      expect(mocks.toastSuccess).toHaveBeenCalledWith('期限を消しました');
    });

    it('offers no day before today in Japan', () => {
      renderExpiry();
      expect(openEditor().input.min).toBe('2026-10-25');
    });

    it('takes today, open to the end of the day in Japan', () => {
      renderExpiry({ expired: true, expiresAt: new Date('2026-10-01T14:59:59.999Z') });
      const { input, editor } = openEditor();
      fireEvent.change(input, { target: { value: '2026-10-25' } });
      fireEvent.click(within(editor).getByRole('button', { name: '保存' }));

      expect(sentAndAnswered().data).toEqual({ expiresAt: '2026-10-25T14:59:59.999Z' });
    });

    it('does not take a day already over, which would stop the QR code as it is saved', () => {
      // Meant to extend it, a day of last year is picked by mistake
      renderExpiry();
      const { input, editor } = openEditor();
      for (const day of ['2026-10-24', '2025-10-31']) {
        fireEvent.change(input, { target: { value: day } });
        fireEvent.click(within(editor).getByRole('button', { name: '保存' }));
      }

      expect(mocks.mutate).not.toHaveBeenCalled();
      expect(mocks.toastError).toHaveBeenCalledTimes(2);
      expect(mocks.toastError).toHaveBeenCalledWith(ja.settings.qrCampaigns.expiry.pastDay);
      // The editor stays open with the day, to choose another
      expect(input.value).toBe('2025-10-31');
    });

    it('sends nothing without a day', () => {
      renderExpiry();
      const { input, editor } = openEditor();
      fireEvent.change(input, { target: { value: '' } });
      fireEvent.click(within(editor).getByRole('button', { name: '保存' }));

      expect(mocks.mutate).not.toHaveBeenCalled();
      expect(mocks.toastError).toHaveBeenCalledWith('日付を選んでください');
    });

    it('closes the editor on cancel without sending anything', () => {
      renderExpiry();
      const { editor } = openEditor();
      fireEvent.click(within(editor).getByRole('button', { name: 'キャンセル' }));

      expect(mocks.mutate).not.toHaveBeenCalled();
      expect(screen.queryByLabelText('この日の終わりまで開く（日本時間）')).toBeNull();
    });

    it('says when the change failed', () => {
      renderExpiry();
      mocks.options?.onError();
      expect(mocks.toastError).toHaveBeenCalledWith('期限を変えられませんでした');
    });
  });
});
