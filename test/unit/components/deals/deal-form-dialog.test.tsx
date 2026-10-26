/**
 * The deal form (#436, #720): editing sends only the fields changed in the dialog, a close date
 * box holding text that is not a date, or a date outside 2000-2100, holds the save, a new deal
 * created as won says what it does to the lead, the amount box reads commas, spaces and
 * full-width digits and shows what it read, the lead is chosen from suggestions whose count is
 * read out, a failed save is said in the dialog, which does not close while it saves, a send with
 * errors takes the focus to the first one, the description says what is required, and a won or
 * lost deal is edited with its day, reason and competitor instead of its probability (real
 * next-intl messages and UI components; tRPC mocked)
 */
import { DealFormDialog } from '@/components/features/deals/deal-form-dialog';
import type { DealView } from '@/lib/features/deals/service';
import messages from '@/locales/ja/common.json';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '770e8400-e29b-41d4-a716-446655440001';
const DEAL_ID = '880e8400-e29b-41d4-a716-446655440002';

type Callbacks = { onSuccess?: (result: unknown) => unknown; onError?: (error: Error) => unknown };

const mocks = vi.hoisted(() => ({
  creates: [] as unknown[],
  updates: [] as unknown[],
  fail: false,
  // The mutations are on their way (isPending)
  pending: false,
  searches: [] as { query: string; enabled: boolean }[],
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/trpc/client', () => {
  const invalidate = { invalidate: vi.fn() };
  // Like TanStack Query: the hook's callbacks, then the call's
  const mutation = (hook: Callbacks = {}, sent: unknown[] = []) => ({
    isPending: mocks.pending,
    mutate: (input: unknown, call: Callbacks = {}) => {
      sent.push(input);
      if (mocks.fail) {
        const error = new Error('failed');
        hook.onError?.(error);
        call.onError?.(error);
        return;
      }
      hook.onSuccess?.(input);
      call.onSuccess?.(input);
    },
  });
  return {
    trpc: {
      useUtils: () => ({ deals: invalidate, leads: invalidate, leadActivity: invalidate }),
      deals: {
        create: { useMutation: (hook?: Callbacks) => mutation(hook, mocks.creates) },
        update: { useMutation: (hook?: Callbacks) => mutation(hook, mocks.updates) },
        delete: { useMutation: (hook?: Callbacks) => mutation(hook) },
      },
      leads: {
        assignees: {
          useQuery: () => ({ data: [{ userId: 'user-1', displayName: '営業 花子' }] }),
        },
      },
      leadSearch: {
        suggest: {
          useQuery: (input: { query: string }, options: { enabled: boolean }) => {
            mocks.searches.push({ query: input.query, enabled: options.enabled });
            return {
              data: options.enabled
                ? [
                    {
                      id: LEAD_ID,
                      name: '山田 太郎',
                      email: 'taro@example.com',
                      company: '架空商事',
                      status: 'new',
                    },
                  ]
                : undefined,
              isFetching: false,
            };
          },
        },
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

const deal: DealView = {
  id: DEAL_ID,
  leadId: LEAD_ID,
  name: 'AS/400 現行調査',
  kind: 'survey',
  stage: 'proposal',
  amount: 3_000_000,
  probability: 40,
  weightedAmount: 1_200_000,
  forecastOverride: null,
  forecastCategory: 'best_case',
  expectedCloseOn: '2026-11-30',
  closedOn: null,
  lostReason: null,
  lostNote: null,
  competitor: null,
  targetSystem: null,
  nextStep: '見積を送る',
  ownerUserId: 'user-1',
  ownerName: '営業 花子',
  previousDealId: null,
  stageChangedAt: new Date('2026-10-20T00:00:00Z'),
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-20T00:00:00Z'),
};

const wonDeal: DealView = {
  ...deal,
  stage: 'won',
  probability: 100,
  forecastCategory: 'closed',
  closedOn: '2026-10-20',
};

const lostDeal: DealView = {
  ...deal,
  stage: 'lost',
  probability: 0,
  forecastCategory: 'lost',
  closedOn: '2026-10-21',
  lostReason: 'competitor',
  lostNote: '架空システムズに決定',
  competitor: '架空システムズ',
};

function renderForm(props: { deal?: DealView; leadId?: string } = {}) {
  const onOpenChange = vi.fn();
  const onSaved = vi.fn();
  render(
    <NextIntlClientProvider locale="ja" messages={messages}>
      <DealFormDialog
        open
        onOpenChange={onOpenChange}
        organizationId={ORG_ID}
        onSaved={onSaved}
        {...props}
      />
    </NextIntlClientProvider>
  );
  return { onOpenChange, onSaved };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.creates = [];
  mocks.updates = [];
  mocks.fail = false;
  mocks.pending = false;
  mocks.searches = [];
});

describe('DealFormDialog', () => {
  it('sends only the fields changed in the dialog when editing', async () => {
    const user = userEvent.setup();
    const { onOpenChange, onSaved } = renderForm({ deal });
    await user.clear(screen.getByLabelText('金額（税抜）'));
    await user.type(screen.getByLabelText('金額（税抜）'), '3500000');
    await user.clear(screen.getByLabelText('次の一手'));
    await user.click(screen.getByRole('button', { name: '保存' }));
    // Not the probability, kind or owner it was opened with: a stage move made elsewhere
    // meanwhile resets the probability, and this save must not write the old one back
    expect(mocks.updates).toEqual([
      { organizationId: ORG_ID, dealId: DEAL_ID, amount: 3_500_000, nextStep: null },
    ]);
    expect(onSaved).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes without a request when nothing was changed', async () => {
    const user = userEvent.setup();
    const { onOpenChange, onSaved } = renderForm({ deal });
    await user.type(screen.getByLabelText('商談名 必須'), ' ');
    // The same amount written another way is no change
    await user.clear(screen.getByLabelText('金額（税抜）'));
    await user.type(screen.getByLabelText('金額（税抜）'), '3,000,000');
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(mocks.updates).toEqual([]);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does not save while the close date box holds text that is not a date', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderForm({ deal });
    const date = screen.getByLabelText('受注予定日');
    await user.clear(date);
    await user.type(date, '2026/13/45');
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(mocks.updates).toEqual([]);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(date).toHaveAccessibleDescription(messages.leadHearings.editor.dateInvalid);

    await user.clear(date);
    await user.type(date, '2026/12/15');
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(mocks.updates).toEqual([
      { organizationId: ORG_ID, dealId: DEAL_ID, expectedCloseOn: '2026-12-15' },
    ]);
  });

  it('does not save a close date the deals do not take (outside 2000 to 2100)', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderForm({ deal });
    const date = screen.getByLabelText('受注予定日');
    await user.clear(date);
    await user.type(date, '1999/12/31');
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(mocks.updates).toEqual([]);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(date).toHaveAccessibleDescription('受注予定日は2000〜2100年の日付で入力してください');
  });

  it('does not create a deal with text that is not a date either', async () => {
    const user = userEvent.setup();
    renderForm({ leadId: LEAD_ID });
    await user.type(screen.getByLabelText('商談名 必須'), 'AS/400 移行');
    await user.type(screen.getByLabelText('受注予定日'), '来月末');
    await user.click(screen.getByRole('button', { name: '作成' }));
    expect(mocks.creates).toEqual([]);
  });

  it('marks the required fields and leaves the owner of a new deal to the lead', async () => {
    const user = userEvent.setup();
    renderForm({});
    expect(screen.getByLabelText('リード 必須')).toBeInTheDocument();
    expect(screen.getByLabelText('商談名 必須')).toBeInTheDocument();
    // The server makes the lead's assignee the owner when none is chosen
    expect(screen.getByRole('combobox', { name: '担当' })).toHaveTextContent('リードの担当者');
    await user.click(screen.getByRole('combobox', { name: '担当' }));
    expect(screen.getByRole('option', { name: '担当未定' })).toBeInTheDocument();
  });

  it('says what creating a deal as won does to the lead', async () => {
    const user = userEvent.setup();
    renderForm({ leadId: LEAD_ID });
    await user.type(screen.getByLabelText('商談名 必須'), 'AS/400 移行');
    await user.click(screen.getByRole('combobox', { name: 'ステージ' }));
    await user.click(screen.getByRole('option', { name: '受注' }));
    // The lead's status follows its deals (#444); a past win's day is corrected afterwards
    expect(screen.getByRole('combobox', { name: 'ステージ' })).toHaveAccessibleDescription(
      'このリードは成約になります。 受注日は今日になります。 過去の受注は、作成のあとに編集で受注日を直せます。'
    );
    await user.click(screen.getByRole('button', { name: '作成' }));
    expect(mocks.creates).toEqual([
      {
        organizationId: ORG_ID,
        leadId: LEAD_ID,
        stage: 'won',
        name: 'AS/400 移行',
        kind: 'survey',
        amount: null,
        expectedCloseOn: null,
        nextStep: null,
        forecastOverride: null,
      },
    ]);
  });

  describe('the amount box (#720)', () => {
    it.each([
      ['12,000,000', 12_000_000],
      ['１２００００００', 12_000_000],
      ['１２，０００，０００', 12_000_000],
      ['12 000 000', 12_000_000],
    ])('reads %s and shows the amount it reads', async (typed, amount) => {
      const user = userEvent.setup();
      renderForm({ leadId: LEAD_ID });
      await user.type(screen.getByLabelText('商談名 必須'), 'AS/400 移行');
      const box = screen.getByLabelText('金額（税抜）');
      await user.type(box, typed);
      expect(screen.getByText('＝ ￥12,000,000')).toBeInTheDocument();
      expect(box).toHaveAccessibleDescription(
        '税抜の円。カンマや全角の数字でも入力できます。未定なら空欄 ＝ ￥12,000,000'
      );
      await user.click(screen.getByRole('button', { name: '作成' }));
      expect(mocks.creates).toEqual([expect.objectContaining({ amount })]);
    });

    it('says yen after the box, and shows no amount for text that is not one', async () => {
      const user = userEvent.setup();
      renderForm({ leadId: LEAD_ID });
      const box = screen.getByLabelText('金額（税抜）');
      expect(box.parentElement).toHaveTextContent('円');
      await user.type(box, '1200万');
      expect(screen.queryByText(/^＝/)).not.toBeInTheDocument();
      await user.type(screen.getByLabelText('商談名 必須'), 'AS/400 移行');
      await user.click(screen.getByRole('button', { name: '作成' }));
      expect(mocks.creates).toEqual([]);
      expect(box).toHaveAccessibleDescription(
        '税抜の円。カンマや全角の数字でも入力できます。未定なら空欄 0以上の整数で入力してください'
      );
      expect(box).toHaveFocus();
    });
  });

  describe('the lead (#720)', () => {
    it('is chosen from the suggestions, and the focus goes on to the deal name', async () => {
      const user = userEvent.setup();
      renderForm({});
      const lead = screen.getByRole('combobox', { name: 'リード 必須' });
      expect(lead).toHaveTextContent('リードを選ぶ');
      await user.click(lead);
      const search = screen.getByRole('combobox', { name: 'リードを探す' });
      expect(search).toHaveFocus();
      // Said in a status line that is always there, so the changes are read out (#720)
      const status = screen.getByRole('status');
      expect(status).toHaveTextContent('会社名・氏名・メールの一部を入れてください');

      await user.type(search, '架空');
      const option = await screen.findByRole('option', { name: /架空商事 山田 太郎/ });
      expect(mocks.searches.at(-1)).toEqual({ query: '架空', enabled: true });
      expect(status).toHaveTextContent('1件の候補');
      expect(within(option).getByText('taro@example.com')).toBeInTheDocument();
      await user.click(option);

      expect(lead).toHaveTextContent('架空商事 山田 太郎');
      await waitFor(() => expect(screen.getByLabelText('商談名 必須')).toHaveFocus());
      await user.keyboard('AS/400 移行');
      await user.click(screen.getByRole('button', { name: '作成' }));
      expect(mocks.creates).toEqual([
        expect.objectContaining({ leadId: LEAD_ID, name: 'AS/400 移行' }),
      ]);
    });

    it('is chosen with the keyboard as well', async () => {
      const user = userEvent.setup();
      renderForm({});
      screen.getByRole('combobox', { name: 'リード 必須' }).focus();
      await user.keyboard('{Enter}');
      await user.keyboard('山田');
      await screen.findByRole('option', { name: /架空商事 山田 太郎/ });
      await user.keyboard('{Enter}');
      expect(screen.getByRole('combobox', { name: 'リード 必須' })).toHaveTextContent(
        '架空商事 山田 太郎'
      );
      await waitFor(() => expect(screen.getByLabelText('商談名 必須')).toHaveFocus());
    });
  });

  describe('errors (#720)', () => {
    it('takes the focus to the first field to fix when the form is sent', async () => {
      const user = userEvent.setup();
      renderForm({});
      await user.click(screen.getByRole('button', { name: '作成' }));
      const lead = screen.getByRole('combobox', { name: 'リード 必須' });
      expect(lead).toHaveFocus();
      expect(lead).toHaveAccessibleDescription('リードを選んでください');
      expect(mocks.creates).toEqual([]);
    });

    it('takes the focus to the deal name when the lead is given', async () => {
      const user = userEvent.setup();
      renderForm({ leadId: LEAD_ID });
      await user.type(screen.getByLabelText('確度'), '120');
      await user.click(screen.getByRole('button', { name: '作成' }));
      const name = screen.getByLabelText('商談名 必須');
      expect(name).toHaveFocus();
      expect(name).toHaveAccessibleDescription('商談名を入力してください');
    });

    it('says in the dialog that a save failed, and keeps what was typed', async () => {
      const user = userEvent.setup();
      mocks.fail = true;
      const { onOpenChange } = renderForm({ deal });
      await user.clear(screen.getByLabelText('次の一手'));
      await user.type(screen.getByLabelText('次の一手'), '稟議を待つ');
      await user.click(screen.getByRole('button', { name: '保存' }));
      const dialog = screen.getByRole('dialog', { name: '商談を編集' });
      expect(within(dialog).getByRole('alert')).toHaveTextContent(
        '保存できませんでした。もう一度お試しください'
      );
      expect(screen.getByLabelText('次の一手')).toHaveValue('稟議を待つ');
      expect(onOpenChange).not.toHaveBeenCalled();
      // The dialog says it; no toast behind the dialog's overlay
      expect(mocks.toast.error).not.toHaveBeenCalled();

      mocks.fail = false;
      await user.click(screen.getByRole('button', { name: '保存' }));
      expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('says a failed save of a new lost deal in the lost reason dialog', async () => {
      const user = userEvent.setup();
      mocks.fail = true;
      renderForm({ leadId: LEAD_ID });
      await user.type(screen.getByLabelText('商談名 必須'), 'AS/400 移行');
      await user.click(screen.getByRole('combobox', { name: 'ステージ' }));
      await user.click(screen.getByRole('option', { name: '失注' }));
      await user.click(screen.getByRole('button', { name: '作成' }));
      const lost = screen.getByRole('dialog', { name: '「AS/400 移行」を失注にする' });
      await user.click(within(lost).getByRole('combobox', { name: '失注理由 必須' }));
      await user.click(screen.getByRole('option', { name: '時期' }));
      await user.click(within(lost).getByRole('button', { name: '失注にする' }));
      expect(within(lost).getByRole('alert')).toHaveTextContent(
        '保存できませんでした。もう一度お試しください'
      );
    });
  });

  describe('a won or lost deal (#720)', () => {
    it('is edited with its won day and competitor instead of its probability and category', async () => {
      const user = userEvent.setup();
      renderForm({ deal: wonDeal });
      expect(screen.queryByLabelText('確度')).not.toBeInTheDocument();
      expect(screen.queryByRole('combobox', { name: '予測の区分' })).not.toBeInTheDocument();
      expect(screen.queryByLabelText('失注日 必須')).not.toBeInTheDocument();
      const day = screen.getByLabelText('受注日 必須');
      expect(day).toHaveValue('2026/10/20');

      await user.clear(day);
      await user.type(day, '2026/10/18');
      // Labelled like the deal page; only the required fields are marked (#720)
      await user.type(screen.getByLabelText('競合'), '架空システムズ');
      await user.click(screen.getByRole('button', { name: '保存' }));
      expect(mocks.updates).toEqual([
        {
          organizationId: ORG_ID,
          dealId: DEAL_ID,
          closedOn: '2026-10-18',
          competitor: '架空システムズ',
        },
      ]);
    });

    it('does not save a won day the deals do not take', async () => {
      const user = userEvent.setup();
      renderForm({ deal: wonDeal });
      const day = screen.getByLabelText('受注日 必須');
      await user.clear(day);
      await user.type(day, '1999/12/31');
      await user.click(screen.getByRole('button', { name: '保存' }));
      expect(mocks.updates).toEqual([]);
      expect(day).toHaveAccessibleDescription('受注日は2000〜2100年の日付で入力してください');
      expect(day).toHaveFocus();
    });

    it('is edited with its lost day, reason, details and competitor', async () => {
      const user = userEvent.setup();
      renderForm({ deal: lostDeal });
      expect(screen.queryByLabelText('確度')).not.toBeInTheDocument();
      expect(screen.getByLabelText('失注日 必須')).toHaveValue('2026/10/21');
      expect(screen.getByRole('combobox', { name: '失注理由 必須' })).toHaveTextContent('他社選定');
      expect(screen.getByLabelText('失注の詳細')).toHaveValue('架空システムズに決定');
      expect(screen.getByLabelText('競合')).toHaveValue('架空システムズ');
      // Nothing says 保留 is not a deal's reason when it is not the one saved
      expect(screen.queryByText(/商談の失注理由に使えません/)).not.toBeInTheDocument();

      await user.click(screen.getByRole('combobox', { name: '失注理由 必須' }));
      await user.click(screen.getByRole('option', { name: '予算' }));
      await user.clear(screen.getByLabelText('失注の詳細'));
      await user.click(screen.getByRole('button', { name: '保存' }));
      expect(mocks.updates).toEqual([
        { organizationId: ORG_ID, dealId: DEAL_ID, lostReason: 'budget', lostNote: null },
      ]);
    });

    it('asks for a lost reason a deal can take, and says why', async () => {
      const user = userEvent.setup();
      // 保留 is a lead's reason, not a deal's (#445)
      renderForm({ deal: { ...lostDeal, lostReason: 'on_hold' } });
      const reason = screen.getByRole('combobox', { name: '失注理由 必須' });
      expect(reason).toHaveTextContent('選んでください');
      expect(reason).toHaveAccessibleDescription(
        '「保留」は商談の失注理由に使えません。選び直してください'
      );
      await user.click(screen.getByRole('button', { name: '保存' }));
      expect(mocks.updates).toEqual([]);
      expect(reason).toHaveFocus();
      expect(reason).toHaveAccessibleDescription(
        '「保留」は商談の失注理由に使えません。選び直してください 失注理由を選んでください'
      );

      await user.click(reason);
      await user.click(screen.getByRole('option', { name: '時期' }));
      expect(screen.queryByText(/商談の失注理由に使えません/)).not.toBeInTheDocument();
    });
  });

  describe('while it saves (#720)', () => {
    it('does not close, so a failure can still be said in it', async () => {
      const user = userEvent.setup();
      mocks.pending = true;
      const { onOpenChange } = renderForm({ deal });
      const dialog = screen.getByRole('dialog', { name: '商談を編集' });
      const save = within(dialog).getByRole('button', { name: '保存しています…' });
      expect(save).toBeDisabled();
      expect(save.querySelector('svg')).toHaveClass('animate-spin');
      expect(within(dialog).getByRole('button', { name: 'キャンセル' })).toBeDisabled();

      await user.keyboard('{Escape}');
      await user.click(within(dialog).getByRole('button', { name: '閉じる' }));
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog', { name: '商談を編集' })).toBeInTheDocument();
    });

    it('closes as before once it is saved', async () => {
      const user = userEvent.setup();
      const { onOpenChange } = renderForm({ deal });
      await user.keyboard('{Escape}');
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it.each([
    [{}, 'リードと商談名は必須です。ほかはあとから入力できます'],
    [{ leadId: LEAD_ID }, '商談名は必須です。ほかはあとから入力できます'],
    [{ deal }, '商談名は必須です。ほかはあとから入力できます'],
    [{ deal: wonDeal }, '商談名と受注日は必須です。ほかはあとから入力できます'],
    [{ deal: lostDeal }, '商談名・失注日・失注理由は必須です。ほかはあとから入力できます'],
  ])('describes what is required (#720): %#', (props, description) => {
    renderForm(props);
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(description);
  });

  it('scrolls the fields and keeps the buttons in view under them (#720)', () => {
    renderForm({ deal: lostDeal });
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveClass('max-h-[90dvh]');
    const fields = screen.getByLabelText('商談名 必須').closest('.overflow-y-auto');
    expect(fields).not.toBeNull();
    expect(fields).not.toContainElement(screen.getByRole('button', { name: '保存' }));
  });

  it('keeps the dialog behind the list of leads while it is open (a modal list, #720)', async () => {
    const user = userEvent.setup();
    renderForm({});
    await user.click(screen.getByRole('combobox', { name: 'リード 必須' }));
    expect(screen.getByRole('combobox', { name: 'リードを探す' })).toBeInTheDocument();
    // The modal list hides the rest, which also lets it scroll inside the dialog
    expect(screen.queryByRole('textbox', { name: '商談名 必須' })).not.toBeInTheDocument();
  });

  it('writes no text under 14px (#720)', () => {
    renderForm({ deal: lostDeal });
    expect(screen.getByRole('dialog').querySelector('.text-xs')).toBeNull();
  });
});
