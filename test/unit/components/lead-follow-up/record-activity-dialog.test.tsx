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

type MutationOptions = {
  onSuccess?: (result: unknown, input: unknown) => void;
  onError?: () => void;
};

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
        leadActivity: { list: invalidate, forDeal: invalidate, myDay: invalidate },
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
              const saved = {
                id: 'c1',
                kind: (input as { kind: string }).kind,
                contactedAt: (input as { contactedAt?: Date }).contactedAt ?? new Date(),
              };
              options.onSuccess?.(saved, input);
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

function renderDialogWithUnmount(props: { defaultDealId?: string } = {}) {
  const onOpenChange = vi.fn();
  const view = render(
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
  return { onOpenChange, unmount: view.unmount };
}

const renderDialog = (props: { defaultDealId?: string } = {}) => renderDialogWithUnmount(props);

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
    await user.click(screen.getByRole('radio', { name: 'オンライン商談' }));
    fireEvent.change(screen.getByLabelText('日時（日本時間）'), {
      target: { value: toJstInputValue(heldAt) },
    });
    // Full-width digits are read as numbers
    await user.type(screen.getByLabelText('所要時間（分・任意）'), '６０');
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
    // The toast says when, as the time was given, and for whom (#863)
    expect(mocks.toast.success).toHaveBeenCalledWith(
      expect.stringMatching(/^「オンラインで商談した」（.+）を記録しました$/),
      expect.objectContaining({
        description: '架空商事',
        action: expect.objectContaining({ label: '取り消す' }),
      })
    );
  });

  it('asks what happened before recording, and records it now from the note with Ctrl+Enter', async () => {
    const user = userEvent.setup();
    renderDialog();

    // The time follows the clock until it is changed
    expect(screen.getByLabelText('日時（日本時間）')).toHaveValue(toJstInputValue(new Date()));
    await user.click(screen.getByRole('button', { name: '記録する' }));
    expect(screen.getByText('種類を選んでください')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '電話' })).toHaveFocus();
    expect(mocks.calls).toEqual([]);

    await user.click(screen.getByRole('radio', { name: '電話' }));
    expect(screen.queryByText('種類を選んでください')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('メモ（任意）'), '日程を相談した{Control>}{Enter}{/Control}');

    expect(mocks.calls).toEqual([
      expect.objectContaining({ kind: 'call', contactedAt: undefined, note: '日程を相談した' }),
    ]);
    expect(mocks.toast.success).toHaveBeenCalledWith('「電話した」を記録しました', expect.anything());
  });

  it('does not record on the Enter of a Japanese conversion', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('radio', { name: '電話' }));
    const note = screen.getByLabelText('メモ（任意）');
    expect(note).toHaveAttribute('aria-keyshortcuts', 'Control+Enter Meta+Enter');

    fireEvent.keyDown(note, { key: 'Enter', ctrlKey: true, isComposing: true });
    // Safari sends the Enter that confirms a conversion after compositionend, as keyCode 229
    fireEvent.keyDown(note, { key: 'Enter', ctrlKey: true, keyCode: 229 });
    expect(mocks.calls).toEqual([]);

    fireEvent.keyDown(note, { key: 'Enter', ctrlKey: true });
    expect(mocks.calls).toEqual([expect.objectContaining({ kind: 'call' })]);
  });

  it('refuses a time in the future and a duration out of range, and sends nothing', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('radio', { name: '訪問' }));
    fireEvent.change(screen.getByLabelText('日時（日本時間）'), {
      target: { value: toJstInputValue(new Date(Date.now() + 2 * HOUR_MS)) },
    });
    await user.type(screen.getByLabelText('所要時間（分・任意）'), '1441');
    await user.click(screen.getByRole('button', { name: '記録する' }));

    expect(screen.getByText('今より後の日時は記録できません')).toBeInTheDocument();
    expect(screen.getByText('1分〜24時間（1440分）の間で、分を整数で入れてください')).toBeInTheDocument();
    // The help stays, and the first wrong field has the focus
    expect(screen.getByText('既定は今です。未来の日時は記録できません')).toBeInTheDocument();
    expect(screen.getByLabelText('日時（日本時間）')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('日時（日本時間）')).toHaveFocus();
    expect(mocks.calls).toEqual([]);

    // Fixed fields are checked again as they change
    await user.clear(screen.getByLabelText('所要時間（分・任意）'));
    await user.type(screen.getByLabelText('所要時間（分・任意）'), '30分');
    expect(screen.getByText('1分〜24時間（1440分）の間で、分を整数で入れてください')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('日時（日本時間）'), { target: { value: '' } });
    expect(screen.getByText('日付と時刻を入れてください')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '記録する' }));
    expect(mocks.calls).toEqual([]);
  });

  it('takes no duration or outcome for a call that got no answer', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('radio', { name: '電話' }));
    await user.type(screen.getByLabelText('所要時間（分・任意）'), '15');
    await user.click(screen.getByRole('radio', { name: '不通' }));
    expect(screen.queryByLabelText('所要時間（分・任意）')).not.toBeInTheDocument();
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
    await user.click(await screen.findByRole('option', { name: '指定しない' }));
    await user.click(screen.getByRole('radio', { name: 'メール' }));
    await user.click(screen.getByRole('button', { name: '記録する' }));

    expect(mocks.calls).toEqual([expect.objectContaining({ kind: 'email', dealId: null })]);
  });

  it('leaves the deal out for those who may not read deals, and says when the lead has none', () => {
    mocks.deals = { data: undefined, error: { data: { code: 'FORBIDDEN' } } };
    const { unmount } = renderDialogWithUnmount();
    expect(screen.queryByText('商談（任意）')).not.toBeInTheDocument();
    unmount();

    mocks.deals = { data: { items: [] }, error: null };
    renderDialog();
    expect(screen.getByRole('combobox', { name: '商談（任意）' })).toHaveTextContent(
      'このリードに商談はありません'
    );
  });

  it('keeps what was entered and says so in place when the record fails', async () => {
    mocks.fail = true;
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();

    await user.click(screen.getByRole('radio', { name: '訪問' }));
    await user.type(screen.getByLabelText('メモ（任意）'), '会議室で説明した');
    await user.click(screen.getByRole('button', { name: '記録する' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '記録できませんでした。もう一度お試しください'
    );
    // Said in the dialog, not in a toast behind it
    expect(mocks.toast.error).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByLabelText('メモ（任意）')).toHaveValue('会議室で説明した');
    expect(screen.getByRole('radio', { name: '訪問' })).toHaveAttribute('aria-checked', 'true');
  });
});
