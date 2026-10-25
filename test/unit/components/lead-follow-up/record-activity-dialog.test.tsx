/**
 * Recording an activity with its details (#554): the kind, the time in Japan (never in the
 * future), the duration, the outcome, the deal and a note (real next-intl messages; tRPC mocked)
 */
import { fromJstInputValue, toJstInputValue } from '@/components/features/lead-follow-up/contact-time';
import { RecordActivityDialog } from '@/components/features/lead-follow-up/record-activity-dialog';
import messages from '@/locales/ja/common.json';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '770e8400-e29b-41d4-a716-446655440001';
const HOUR_MS = 60 * 60 * 1000;

type MutationOptions = { onSuccess?: (result: unknown) => void; onError?: () => void };

const mocks = vi.hoisted(() => ({
  deals: { data: undefined as unknown, error: null as unknown },
  calls: [] as unknown[],
  fail: false,
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/trpc/client', () => {
  const invalidate = { invalidate: vi.fn() };
  return {
    trpc: {
      useUtils: () => ({
        leadFollowUp: { contacts: invalidate },
        leadActivity: { list: invalidate, forDeal: invalidate },
        analytics: { getDashboard: invalidate },
      }),
      deals: {
        forLead: { useQuery: () => mocks.deals },
      },
      leadFollowUp: {
        recordContact: {
          useMutation: (options: MutationOptions = {}) => ({
            isPending: false,
            mutateAsync: async (input: unknown) => {
              mocks.calls.push(input);
              if (mocks.fail) {
                options.onError?.();
                throw new Error('failed');
              }
              const saved = { id: 'c1', kind: (input as { kind: string }).kind };
              options.onSuccess?.(saved);
              return saved;
            },
          }),
        },
        deleteContact: { useMutation: () => ({ mutate: vi.fn() }) },
      },
    },
  };
});
vi.mock('sonner', () => ({ toast: mocks.toast }));

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture ??= () => false;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.calls = [];
  mocks.fail = false;
  mocks.deals = {
    data: {
      items: [
        { id: 'deal-won', name: '現行システムの調査', stage: 'won' },
        { id: 'deal-open', name: 'Access の移行', stage: 'proposal' },
      ],
    },
    error: null,
  };
});

function renderDialog(props: { defaultDealId?: string } = {}) {
  const onOpenChange = vi.fn();
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <RecordActivityDialog
        open
        onOpenChange={onOpenChange}
        organizationId={ORG_ID}
        leadId={LEAD_ID}
        leadLabel="架空商事"
        {...props}
      />
    </NextIntlClientProvider>
  );
  return { onOpenChange };
}

describe('contact times in Japan', () => {
  it('reads and writes the datetime-local value in Japan, whatever the browser', () => {
    const at = new Date('2026-10-25T05:30:00Z');
    expect(toJstInputValue(at)).toBe('2026-10-25T14:30');
    expect(fromJstInputValue('2026-10-25T14:30')?.toISOString()).toBe(at.toISOString());
    expect(fromJstInputValue('')).toBeNull();
    expect(fromJstInputValue('2026-02-30T10:00')).toBeNull();
    expect(fromJstInputValue('2026-10-25T24:10')).toBeNull();
  });
});

describe('RecordActivityDialog', () => {
  it('records an online meeting at a past time with its duration, outcome and the open deal', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();
    const heldAt = new Date(Math.floor((Date.now() - 26 * HOUR_MS) / 60_000) * 60_000);

    expect(screen.getByText(/架空商事への連絡・訪問・オンライン商談/)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'オンラインで商談した' }));
    fireEvent.change(screen.getByLabelText('日時'), {
      target: { value: toJstInputValue(heldAt) },
    });
    await user.type(screen.getByLabelText('所要時間（任意）'), '60');
    await user.click(screen.getByRole('radio', { name: '前進' }));
    // The lead's only open deal is chosen to start with; open deals come first
    expect(screen.getByRole('combobox', { name: '商談（任意）' })).toHaveTextContent(
      'Access の移行（提案）'
    );
    await user.type(screen.getByLabelText('メモ（任意）'), '移行の範囲を確かめた');
    await user.click(screen.getByRole('button', { name: '記録する' }));

    expect(mocks.calls).toEqual([
      {
        organizationId: ORG_ID,
        leadId: LEAD_ID,
        kind: 'online_meeting',
        contactedAt: heldAt,
        durationMinutes: 60,
        outcome: 'advanced',
        dealId: 'deal-open',
        note: '移行の範囲を確かめた',
      },
    ]);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mocks.toast.success).toHaveBeenCalledWith(
      '「オンラインで商談した」を記録しました',
      expect.objectContaining({ action: expect.objectContaining({ label: '取り消す' }) })
    );
  });

  it('refuses a time in the future and a duration out of range, and sends nothing', async () => {
    const user = userEvent.setup();
    renderDialog();

    fireEvent.change(screen.getByLabelText('日時'), {
      target: { value: toJstInputValue(new Date(Date.now() + 2 * HOUR_MS)) },
    });
    await user.type(screen.getByLabelText('所要時間（任意）'), '1441');
    await user.click(screen.getByRole('button', { name: '記録する' }));

    expect(screen.getByText('今より後の日時は記録できません')).toBeInTheDocument();
    expect(screen.getByText('1〜1440の整数（分）で入れてください')).toBeInTheDocument();
    expect(screen.getByLabelText('日時')).toHaveAttribute('aria-invalid', 'true');
    expect(mocks.calls).toEqual([]);

    fireEvent.change(screen.getByLabelText('日時'), { target: { value: '' } });
    await user.click(screen.getByRole('button', { name: '記録する' }));
    expect(screen.getByText('日付と時刻を入れてください')).toBeInTheDocument();
    expect(mocks.calls).toEqual([]);
  });

  it('takes no duration or outcome for a call that got no answer', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText('所要時間（任意）'), '15');
    await user.click(screen.getByRole('radio', { name: 'つながらなかった' }));
    expect(screen.queryByLabelText('所要時間（任意）')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: '前進' })).not.toBeInTheDocument();
    expect(screen.getByText('つながらなかったときは、所要時間と結果は記録しません')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '記録する' }));

    expect(mocks.calls).toEqual([
      expect.objectContaining({ kind: 'no_answer', durationMinutes: null, outcome: null }),
    ]);
  });

  it('starts with the deal of the deal page, and can name no deal', async () => {
    const user = userEvent.setup();
    renderDialog({ defaultDealId: 'deal-won' });

    const deal = screen.getByRole('combobox', { name: '商談（任意）' });
    expect(deal).toHaveTextContent('現行システムの調査（受注）');
    await user.click(deal);
    await user.click(await screen.findByRole('option', { name: '商談を選ばない' }));
    await user.click(screen.getByRole('button', { name: '記録する' }));

    expect(mocks.calls).toEqual([expect.objectContaining({ kind: 'call', dealId: null })]);
  });

  it('leaves the deal out for those who may not read deals and for a lead without deals', () => {
    mocks.deals = { data: undefined, error: { data: { code: 'FORBIDDEN' } } };
    renderDialog();
    expect(screen.queryByRole('combobox', { name: '商談（任意）' })).not.toBeInTheDocument();
  });

  it('keeps what was entered when the record fails', async () => {
    mocks.fail = true;
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();

    await user.click(screen.getByRole('radio', { name: '訪問した' }));
    await user.type(screen.getByLabelText('メモ（任意）'), '会議室で説明した');
    await user.click(screen.getByRole('button', { name: '記録する' }));

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalled());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByLabelText('メモ（任意）')).toHaveValue('会議室で説明した');
    expect(screen.getByRole('radio', { name: '訪問した' })).toHaveAttribute('aria-checked', 'true');
  });
});
