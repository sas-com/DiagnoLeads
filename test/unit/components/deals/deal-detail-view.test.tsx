/**
 * The deal page (#436, #720): winning and reopening from the stage path ask first, those who
 * cannot change deals are told the page is read only, the header's ⋯ menu edits and deletes, the
 * deletion question stays open until it is done and says a failure itself, the values come in
 * the order sales reads them, and the history says what changed from what (real next-intl
 * messages and UI components; tRPC mocked)
 */
import { DealDetailView } from '@/components/features/deals/deal-detail-view';
import type { DealDetail, DealHistoryView } from '@/lib/features/deals/service';
import { jstDate } from '@/lib/features/leads/types/pipeline';
import enMessages from '@/locales/en/common.json';
import messages from '@/locales/ja/common.json';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { useRouter } from 'next/navigation';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The router of test/setup.ts: one object for every render
const router = useRouter();

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '770e8400-e29b-41d4-a716-446655440001';
const DEAL_ID = '880e8400-e29b-41d4-a716-446655440002';

type MutationOptions = {
  onSuccess?: (result: unknown) => void;
  onError?: (error: Error, input: unknown) => void;
};

const mocks = vi.hoisted(() => ({
  get: { data: undefined as unknown, isError: false, error: null as unknown, refetch: vi.fn() },
  updates: [] as unknown[],
  deletes: [] as unknown[],
  fail: false,
  /** Sends without answering, as a request still on its way */
  hold: false,
  /** A deletion is on its way to the server */
  deleting: false,
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/trpc/client', () => {
  const invalidate = { invalidate: vi.fn() };
  // Runs the hook's callbacks like tRPC does: the mutation's own, then the call's
  const mutation = (options: MutationOptions = {}, sent: unknown[] = [], isPending = false) => ({
    isPending,
    mutate: (input: unknown, call?: MutationOptions) => {
      sent.push(input);
      if (mocks.hold) return;
      if (mocks.fail) {
        const error = new Error('failed');
        options.onError?.(error, input);
        call?.onError?.(error, input);
        return;
      }
      options.onSuccess?.(input);
      call?.onSuccess?.(input);
    },
  });
  return {
    trpc: {
      useUtils: () => ({ deals: invalidate, leads: invalidate, leadActivity: invalidate }),
      deals: {
        get: { useQuery: () => mocks.get },
        create: { useMutation: (options?: MutationOptions) => mutation(options) },
        update: { useMutation: (options?: MutationOptions) => mutation(options, mocks.updates) },
        delete: {
          useMutation: (options?: MutationOptions) =>
            mutation(options, mocks.deletes, mocks.deleting),
        },
      },
      leads: { assignees: { useQuery: () => ({ data: [] }) } },
      leadSearch: { suggest: { useQuery: () => ({ data: [], isFetching: false }) } },
    },
  };
});
vi.mock('@/hooks/use-organization', () => ({
  useOrganization: () => ({ organizationId: ORG_ID }),
}));
// The deal's activity is its own card (#554), tested in deal-activities-card.test.tsx
vi.mock('@/components/features/lead-activity/deal-activities-card', () => ({
  DealActivitiesCard: (props: { dealId: string; leadId: string; leadLabel: string }) => (
    <div data-testid="deal-activities" data-deal={props.dealId} data-lead={props.leadId}>
      {props.leadLabel}
    </div>
  ),
}));
// The lead's next actions are their own card (#85), tested in lead-next-actions-card.test.tsx
vi.mock('@/components/features/lead-follow-up/lead-next-actions-card', () => ({
  LeadNextActionsCard: (props: { leadId: string; description?: string }) => (
    <div data-testid="lead-next-actions" data-lead={props.leadId}>
      {props.description}
    </div>
  ),
}));
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

const detail = (
  overrides: Partial<DealDetail & { canEdit: boolean; canDelete: boolean }> = {}
): DealDetail & { canEdit: boolean; canDelete: boolean } => ({
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
  nextStep: null,
  ownerUserId: null,
  ownerName: null,
  previousDealId: null,
  stageChangedAt: new Date('2026-10-20T00:00:00Z'),
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-20T00:00:00Z'),
  lead: {
    id: LEAD_ID,
    name: '山田 太郎',
    company: '架空商事',
    status: 'negotiating',
    sqlDecision: null,
  },
  previousDeal: null,
  nextDeals: [],
  history: [],
  canEdit: true,
  canDelete: true,
  ...overrides,
});

const view = () => (
  <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
    <DealDetailView dealId={DEAL_ID} />
  </NextIntlClientProvider>
);

function renderView() {
  return render(view());
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.get = { data: detail(), isError: false, error: null, refetch: vi.fn() };
  mocks.updates = [];
  mocks.deletes = [];
  mocks.fail = false;
  mocks.hold = false;
  mocks.deleting = false;
});

describe('DealDetailView', () => {
  it('wins the deal from the stage path only after the won dialog', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole('button', { name: '「受注」に移す' }));
    expect(
      screen.getByRole('dialog', { name: '「AS/400 現行調査」を受注にする' })
    ).toHaveAccessibleDescription('リード「架空商事」は成約になります。');
    expect(mocks.updates).toEqual([]);

    await user.click(screen.getByRole('button', { name: '受注にする' }));
    expect(mocks.updates).toEqual([
      {
        organizationId: ORG_ID,
        dealId: DEAL_ID,
        stage: 'won',
        closedOn: jstDate(),
        amount: 3_000_000,
      },
    ]);
  });

  it('reopens a won deal only after a confirmation', async () => {
    const user = userEvent.setup();
    mocks.get.data = detail({ stage: 'won', probability: 100, closedOn: '2026-10-20' });
    renderView();
    await user.click(screen.getByRole('button', { name: '「提案」に移す' }));
    expect(
      screen.getByRole('alertdialog', { name: '「AS/400 現行調査」を開き直しますか？' })
    ).toHaveAccessibleDescription(
      '確度は「提案」の既定値 40% になり、予測の区分の上書きも消えます。 ほかに受注の商談がなければ、リードは「商談中」に戻ります。'
    );
    expect(mocks.updates).toEqual([]);

    await user.click(screen.getByRole('button', { name: '開き直す' }));
    expect(mocks.updates).toEqual([{ organizationId: ORG_ID, dealId: DEAL_ID, stage: 'proposal' }]);
  });

  it("shows the activity of the deal for the deal's lead (#554)", () => {
    renderView();
    const card = screen.getByTestId('deal-activities');
    expect(card).toHaveAttribute('data-deal', DEAL_ID);
    expect(card).toHaveAttribute('data-lead', LEAD_ID);
    expect(card).toHaveTextContent('架空商事');
  });

  describe('moving out of 見極め without an SQL decision (#801)', () => {
    const qualification = () => detail({ stage: 'qualification', probability: 10 });

    it('asks for the SQL decision and sends 適格 with the move', async () => {
      const user = userEvent.setup();
      mocks.get.data = qualification();
      renderView();
      await user.click(screen.getByRole('button', { name: '「課題の確認」に移す' }));
      const question = screen.getByRole('alertdialog', { name: '「AS/400 現行調査」の SQL判定' });
      expect(question).toHaveAccessibleDescription(
        '「課題の確認」に進める前に、初回ヒアリングの結果からリード「架空商事」の SQL判定を記録してください。 適格にすると、リードの SQL判定に記録します。商談を元に戻しても、判定は残ります。 不適格なら、失注の理由を付けて商談を閉じます。'
      );
      expect(mocks.updates).toEqual([]);

      await user.click(within(question).getByRole('button', { name: '適格：「課題の確認」へ進める' }));
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(mocks.updates).toEqual([
        { organizationId: ORG_ID, dealId: DEAL_ID, stage: 'discovery', sqlDecision: 'qualified' },
      ]);
    });

    it('goes on to the won dialog after 適格, and sends the decision with the win', async () => {
      const user = userEvent.setup();
      mocks.get.data = qualification();
      renderView();
      await user.click(screen.getByRole('button', { name: '「受注」に移す' }));
      await user.click(screen.getByRole('button', { name: '適格：「受注」へ進める' }));
      const won = screen.getByRole('dialog', { name: '「AS/400 現行調査」を受注にする' });
      expect(mocks.updates).toEqual([]);

      await user.click(within(won).getByRole('button', { name: '受注にする' }));
      expect(mocks.updates).toEqual([
        {
          organizationId: ORG_ID,
          dealId: DEAL_ID,
          stage: 'won',
          closedOn: jstDate(),
          amount: 3_000_000,
          sqlDecision: 'qualified',
        },
      ]);
    });

    it('closes the deal as lost with a reason after 不適格', async () => {
      const user = userEvent.setup();
      mocks.get.data = qualification();
      renderView();
      await user.click(screen.getByRole('button', { name: '「提案」に移す' }));
      await user.click(screen.getByRole('button', { name: '不適格：失注にする' }));
      const lost = screen.getByRole('dialog', { name: '「AS/400 現行調査」を失注にする' });
      expect(lost).toHaveAccessibleDescription(
        '失注理由は、勝ち負けの分析に使います リードの SQL判定も「不適格」として一緒に記録します。'
      );
      await user.click(within(lost).getByRole('combobox', { name: '失注理由 必須' }));
      await user.click(screen.getByRole('option', { name: 'ニーズなし' }));
      await user.click(within(lost).getByRole('button', { name: '失注にする' }));
      expect(mocks.updates).toEqual([
        {
          organizationId: ORG_ID,
          dealId: DEAL_ID,
          stage: 'lost',
          lostReason: 'no_need',
          lostNote: null,
          competitor: null,
          sqlDecision: 'not_qualified',
        },
      ]);
    });

    it('gives the focus back to the stage after two questions in a row', async () => {
      const user = userEvent.setup();
      mocks.get.data = qualification();
      renderView();
      const toWon = screen.getByRole('button', { name: '「受注」に移す' });
      await user.click(toWon);
      await user.click(screen.getByRole('button', { name: '適格：「受注」へ進める' }));
      const won = screen.getByRole('dialog', { name: '「AS/400 現行調査」を受注にする' });
      await user.click(within(won).getByRole('button', { name: 'キャンセル' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(toWon).toHaveFocus();
      expect(mocks.updates).toEqual([]);
    });

    it('leaves the deal where it is when the question is cancelled', async () => {
      const user = userEvent.setup();
      mocks.get.data = qualification();
      renderView();
      await user.click(screen.getByRole('button', { name: '「課題の確認」に移す' }));
      await user.click(screen.getByRole('button', { name: 'キャンセル' }));
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(mocks.updates).toEqual([]);
    });

    it('does not ask when the lead has a decision, or when the deal is moved to lost', async () => {
      const user = userEvent.setup();
      mocks.get.data = detail({
        stage: 'qualification',
        probability: 10,
        lead: { ...qualification().lead, sqlDecision: 'qualified' },
      });
      const { unmount } = renderView();
      await user.click(screen.getByRole('button', { name: '「課題の確認」に移す' }));
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(mocks.updates).toEqual([
        { organizationId: ORG_ID, dealId: DEAL_ID, stage: 'discovery' },
      ]);
      unmount();

      mocks.get.data = qualification();
      renderView();
      await user.click(screen.getByRole('button', { name: '「失注」に移す' }));
      expect(
        screen.getByRole('dialog', { name: '「AS/400 現行調査」を失注にする' })
      ).toBeInTheDocument();
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
  });

  it('tells those who cannot change deals that the page is read only', () => {
    mocks.get.data = detail({ canEdit: false, canDelete: false });
    renderView();
    expect(screen.getByText('閲覧のみ')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'その他の操作' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '「受注」に移す' })).not.toBeInTheDocument();
  });

  it('says a deletion failed in the question, which stays open, and a move in a toast', async () => {
    const user = userEvent.setup();
    mocks.fail = true;
    renderView();
    await user.click(screen.getByRole('button', { name: 'その他の操作' }));
    await user.click(screen.getByRole('menuitem', { name: '削除' }));
    const question = screen.getByRole('alertdialog', { name: '商談を削除しますか？' });
    const confirm = within(question).getByRole('button', { name: '削除' });
    await user.click(confirm);
    expect(within(question).getByRole('alert')).toHaveTextContent(
      '削除できませんでした。もう一度お試しください'
    );
    expect(question).toBeInTheDocument();
    // Still where it was, to try again
    expect(confirm).toHaveFocus();
    expect(mocks.toast.error).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();

    await user.click(within(question).getByRole('button', { name: 'キャンセル' }));
    // Asked again, the question does not say the old failure
    await user.click(screen.getByRole('button', { name: 'その他の操作' }));
    await user.click(screen.getByRole('menuitem', { name: '削除' }));
    expect(
      within(screen.getByRole('alertdialog', { name: '商談を削除しますか？' })).queryByRole('alert')
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'キャンセル' }));
    await user.click(screen.getByRole('button', { name: '「条件の調整」に移す' }));
    expect(mocks.toast.error).toHaveBeenLastCalledWith(
      '「AS/400 現行調査」を「条件の調整」に移せませんでした。「提案」に戻しました'
    );
  });

  describe('the header (#720)', () => {
    it('names the deal with its lead and stage, and goes back to the deals', () => {
      renderView();
      expect(screen.getByRole('heading', { level: 1, name: 'AS/400 現行調査' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: '商談へ戻る' })).toHaveAttribute('href', '/ja/deals');
      expect(screen.getByRole('link', { name: '架空商事 山田 太郎' })).toHaveAttribute(
        'href',
        `/ja/leads/${LEAD_ID}`
      );
      expect(screen.getByRole('heading', { level: 2, name: '商談の内容' })).toBeInTheDocument();
    });

    it('edits from the ⋯ menu and gives the focus back to it', async () => {
      const user = userEvent.setup();
      renderView();
      const more = screen.getByRole('button', { name: 'その他の操作' });
      await user.click(more);
      await user.click(screen.getByRole('menuitem', { name: '編集' }));
      const form = screen.getByRole('dialog', { name: '商談を編集' });
      await user.click(within(form).getByRole('button', { name: 'キャンセル' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(more).toHaveFocus();
    });

    it("edits from the values' card and gives the focus back to its button", async () => {
      const user = userEvent.setup();
      renderView();
      const edit = screen.getByRole('button', { name: '編集' });
      await user.click(edit);
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(edit).toHaveFocus();
    });

    it('says why the page is read only to those who came from a lead', () => {
      mocks.get.data = detail({ canEdit: false, canDelete: false });
      renderView();
      expect(
        screen.getByText(
          '商談の作成・変更・ステージの移動は、リードを編集できるメンバーができます。変えるには組織の管理者に依頼してください'
        )
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '編集' })).not.toBeInTheDocument();
    });

    it('offers only what the member may do', async () => {
      const user = userEvent.setup();
      mocks.get.data = detail({ canEdit: true, canDelete: false });
      renderView();
      await user.click(screen.getByRole('button', { name: 'その他の操作' }));
      expect(screen.getByRole('menuitem', { name: '編集' })).toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: '削除' })).not.toBeInTheDocument();
    });
  });

  describe('deleting (#720)', () => {
    it('says what happens to the lead, deletes and goes back to the deals', async () => {
      const user = userEvent.setup();
      renderView();
      await user.click(screen.getByRole('button', { name: 'その他の操作' }));
      await user.click(screen.getByRole('menuitem', { name: '削除' }));
      const question = screen.getByRole('alertdialog', { name: '商談を削除しますか？' });
      expect(question).toHaveAccessibleDescription(
        '「AS/400 現行調査」を削除します。元に戻せません。この商談の活動は、リード「架空商事」の活動履歴に残ります。リードの状態と商談フェーズは、残りの商談から計算し直します。最後の商談なら、リードは今の値のまま残り、手で変えられるようになります。'
      );
      await user.click(within(question).getByRole('button', { name: '削除' }));
      expect(mocks.deletes).toEqual([{ organizationId: ORG_ID, dealId: DEAL_ID }]);
      expect(mocks.toast.success).toHaveBeenCalledWith('商談を削除しました');
      // Replace: going back does not open the deleted deal
      expect(router.replace).toHaveBeenCalledWith('/ja/deals');
      expect(router.push).not.toHaveBeenCalled();
    });

    it('keeps saying it is deleting, not that the deal is gone, until the deals are shown', async () => {
      const user = userEvent.setup();
      const { rerender } = renderView();
      await user.click(screen.getByRole('button', { name: 'その他の操作' }));
      await user.click(screen.getByRole('menuitem', { name: '削除' }));
      await user.click(screen.getByRole('button', { name: '削除' }));
      // The deal read again after the deletion is not found
      mocks.get = {
        data: mocks.get.data,
        isError: true,
        error: { data: { code: 'NOT_FOUND' } },
        refetch: vi.fn(),
      };
      rerender(view());
      expect(screen.queryByText('商談が見つかりません')).not.toBeInTheDocument();
      const question = screen.getByRole('alertdialog', { name: '商談を削除しますか？' });
      expect(within(question).getByRole('button', { name: '削除しています…' })).toBeInTheDocument();
    });

    it('cancelled, gives the focus back to the ⋯ button', async () => {
      const user = userEvent.setup();
      renderView();
      const more = screen.getByRole('button', { name: 'その他の操作' });
      await user.click(more);
      await user.click(screen.getByRole('menuitem', { name: '削除' }));
      await user.click(screen.getByRole('button', { name: 'キャンセル' }));
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(more).toHaveFocus();
    });

    it('stays open, saying it is deleting, until the deletion is done', async () => {
      const user = userEvent.setup();
      const { rerender } = renderView();
      await user.click(screen.getByRole('button', { name: 'その他の操作' }));
      await user.click(screen.getByRole('menuitem', { name: '削除' }));
      // Sent, still on its way: the next render shows it
      mocks.hold = true;
      await user.click(screen.getByRole('button', { name: '削除' }));
      mocks.deleting = true;
      rerender(view());
      const question = screen.getByRole('alertdialog', { name: '商談を削除しますか？' });
      const button = within(question).getByRole('button', { name: '削除しています…' });
      // The same button, so the focus stays on it
      expect(button).toHaveFocus();
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(within(question).getByRole('status')).toHaveTextContent('削除しています…');
      expect(within(question).getByRole('button', { name: 'キャンセル' })).toBeDisabled();

      await user.click(button);
      await user.keyboard('{Escape}');
      expect(mocks.deletes).toHaveLength(1);
      expect(screen.getByRole('alertdialog', { name: '商談を削除しますか？' })).toBeInTheDocument();
    });
  });

  describe('the values (#720)', () => {
    const labels = () =>
      screen.getAllByRole('term').map((term) => term.textContent);

    it('puts by when first, marks a passed close date and keeps a next step as a last note', () => {
      mocks.get.data = detail({ nextStep: '見積もりを送る', expectedCloseOn: '2026-01-31' });
      renderView();
      // What to do next is the lead's next actions (Epic #856); a next step written before #853
      // is an earlier note
      expect(labels()).toEqual([
        '受注予定日',
        '金額（税抜）',
        '確度',
        '担当',
        '種類',
        '加重金額',
        '予測の区分',
        '以前の次の一手（メモ）',
      ]);
      expect(screen.getByText('2026/01/31').closest('dd')).toHaveTextContent('2026/01/31受注予定日を過ぎています');
      expect(screen.getByText('見積もりを送る')).toBeInTheDocument();
      expect(screen.getByText('予測の区分').nextElementSibling).toHaveTextContent(
        '確度から自動（ベストケース）'
      );
    });

    it('names a forecast category set by hand as it is', () => {
      mocks.get.data = detail({ forecastOverride: 'commit', forecastCategory: 'commit' });
      renderView();
      expect(screen.getByText('予測の区分').nextElementSibling).toHaveTextContent(/^コミット$/);
    });

    it('does not mark a close date still ahead, and has no weighted amount without an amount', () => {
      mocks.get.data = detail({ expectedCloseOn: '2099-12-31', amount: null, weightedAmount: 0 });
      renderView();
      expect(screen.queryByText('以前の次の一手（メモ）')).not.toBeInTheDocument();
      expect(screen.getByText('2099/12/31').closest('dd')).toHaveTextContent(/^2099\/12\/31$/);
      expect(screen.getByText('加重金額').nextElementSibling).toHaveTextContent(/^—$/);
      expect(screen.queryByText('受注予定日を過ぎています')).not.toBeInTheDocument();
    });

    it('shows a won deal with the day it was won instead of the forecast', () => {
      mocks.get.data = detail({ stage: 'won', probability: 100, closedOn: '2026-10-20' });
      renderView();
      expect(labels()).toEqual(['受注日', '金額（税抜）', '担当', '種類']);
      expect(screen.getByText('2026/10/20')).toBeInTheDocument();
    });

    it('shows a lost deal with the day, the reason and the details', () => {
      mocks.get.data = detail({
        stage: 'lost',
        probability: 0,
        closedOn: '2026-10-21',
        lostReason: 'no_need',
        lostNote: '予算が付かなかった',
        competitor: '架空システム',
      });
      renderView();
      expect(labels()).toEqual([
        '失注日',
        '金額（税抜）',
        '担当',
        '種類',
        '失注理由',
        '失注の詳細',
        '競合',
      ]);
      expect(screen.getByText('ニーズなし')).toBeInTheDocument();
    });

    it("shows the lead's next actions on the deal's page", () => {
      renderView();
      expect(screen.getByTestId('lead-next-actions')).toHaveAttribute('data-lead', LEAD_ID);
      expect(screen.getByTestId('lead-next-actions')).toHaveTextContent(
        'リード「架空商事」の次の行動・持ち帰り事項です。リードの画面と同じものです'
      );
    });

    it('does not name a lead without a company or a name', () => {
      mocks.get.data = detail({ lead: { ...detail().lead, company: null, name: null } });
      renderView();
      expect(screen.getByTestId('lead-next-actions')).toHaveTextContent(
        'このリードの次の行動・持ち帰り事項です。リードの画面と同じものです'
      );
    });

    it('moves the deal from a group of stages, not a navigation', () => {
      renderView();
      expect(screen.getByRole('group', { name: 'ステージ' })).toBeInTheDocument();
      expect(screen.queryByRole('navigation', { name: 'ステージ' })).not.toBeInTheDocument();
    });
  });

  describe('the history (#720)', () => {
    const row = (overrides: Partial<DealHistoryView>): DealHistoryView => ({
      id: 'h',
      kind: 'survey',
      stage: 'proposal',
      amount: 3_000_000,
      probability: 40,
      forecastOverride: null,
      expectedCloseOn: '2026-11-30',
      ownerUserId: null,
      ownerName: null,
      changedFields: [],
      changedByName: '営業 花子',
      changedAt: new Date('2026-10-20T01:00:00Z'),
      ...overrides,
    });

    it('says what changed from what, newest first', () => {
      mocks.get.data = detail({
        history: [
          row({
            id: 'h3',
            stage: 'negotiation',
            probability: 70,
            forecastOverride: 'commit',
            changedFields: ['stage', 'probability', 'forecastOverride'],
            changedAt: new Date('2026-10-22T01:00:00Z'),
          }),
          row({
            id: 'h2',
            amount: 4_500_000,
            expectedCloseOn: '2026-12-15',
            changedFields: ['amount', 'expectedCloseOn'],
            changedAt: new Date('2026-10-21T01:00:00Z'),
          }),
          row({ id: 'h1', changedFields: ['created'] }),
        ],
      });
      renderView();
      const history = screen.getByRole('heading', { name: '履歴' }).closest('div') as HTMLElement;
      const rows = within(history).getAllByRole('listitem').filter((item) => item.querySelector('time'));
      expect(rows.map((item) => item.textContent)).toEqual([
        expect.stringContaining(
          'ステージ：提案 →から 条件の調整確度：40% →から 70%予測の区分：自動（ベストケース） →から コミット'
        ),
        expect.stringContaining(
          '受注予定日：2026/11/30 →から 2026/12/15金額：￥3,000,000 →から ￥4,500,000'
        ),
        expect.stringContaining(
          '作成ステージ：提案受注予定日：2026/11/30金額：￥3,000,000確度：40%担当：担当未定'
        ),
      ]);
      // The arrow is not read out; "から" is
      const arrow = within(rows[0]).getAllByText('→', { exact: false })[0];
      expect(arrow).toHaveAttribute('aria-hidden', 'true');
    });

    it('shows only the new value when the change before it is not shown', () => {
      mocks.get.data = detail({
        history: [row({ id: 'h9', probability: 70, changedFields: ['probability'] })],
      });
      renderView();
      expect(screen.getByText('確度：70%')).toBeInTheDocument();
    });

    it('says other fields changed without naming them', () => {
      mocks.get.data = detail({
        history: [row({ id: 'h8', changedFields: ['someFutureField'] })],
      });
      renderView();
      expect(screen.getByText('ほかの項目を変更')).toBeInTheDocument();
      expect(screen.queryByText(/someFutureField/)).not.toBeInTheDocument();
    });

    it('reads in English with the arrow said as "to"', () => {
      mocks.get.data = detail({
        history: [
          row({ id: 'h2', probability: 70, changedFields: ['probability'] }),
          row({ id: 'h1', changedFields: ['created'] }),
        ],
      });
      render(
        <NextIntlClientProvider locale="en" messages={enMessages} timeZone="Asia/Tokyo">
          <DealDetailView dealId={DEAL_ID} />
        </NextIntlClientProvider>
      );
      // The change's line, not the first row's "Probability: 40%"
      const change = screen.getByText(
        (_, element) => element?.tagName === 'LI' && element.textContent === 'Probability: 40% →to 70%'
      );
      expect(within(change).getByText('to')).toHaveClass('sr-only');
    });
  });
});
