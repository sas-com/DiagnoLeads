/**
 * The deals screen (#436, #720): the board from the query, the filters and the list's order in
 * the URL, a move between open stages shown at once with its undo and put back when it fails,
 * the focus after a move from the menu, losing a deal only with a reason, winning one only after
 * confirming the day and the amount, reopening a closed one only after a confirmation, and the
 * empty, error and read-only states (real next-intl messages; tRPC and the router mocked)
 */
import { DealsScreen } from '@/components/features/deals/deals-screen';
import type { DealCard } from '@/lib/features/deals/service';
import { DEAL_STAGES } from '@/lib/features/deals/types/pipeline';
import { jstDate } from '@/lib/features/leads/types/pipeline';
import messages from '@/locales/ja/common.json';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';

type Callbacks = {
  onSuccess?: (result: unknown, input: unknown) => unknown;
  onError?: (error: Error, input: unknown) => unknown;
};
type ToastOptions = { action?: { label: string; onClick: () => void } };

const mocks = vi.hoisted(() => ({
  board: { data: undefined as unknown, isError: false, isPlaceholderData: false, refetch: vi.fn() },
  // The board the next refresh reads, like a refetch after a change
  refetched: undefined as unknown,
  boardInputs: [] as unknown[],
  updates: [] as Record<string, unknown>[],
  // How the server answers the next changes, and whether it waits until the test releases it
  answer: 'ok' as 'ok' | 'fail',
  hold: false,
  held: [] as (() => Promise<void>)[],
  search: '',
  replace: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}));

vi.mock('@/lib/trpc/client', async () => {
  const { STAGE_PROBABILITY } = await import('@/lib/features/deals/types/pipeline');
  const invalidate = {
    invalidate: vi.fn(async () => {
      if (mocks.refetched) mocks.board = { ...mocks.board, data: mocks.refetched };
    }),
  };
  // The deal the server answers with: the stage sent, with its probability unless one was sent
  const saved = (input: { dealId: string; stage: keyof typeof STAGE_PROBABILITY; probability?: number }) => ({
    id: input.dealId,
    stage: input.stage,
    probability: input.probability ?? STAGE_PROBABILITY[input.stage],
  });
  // Like TanStack Query: the hook's callbacks (awaited), then the call's
  const mutation = (hook: Callbacks = {}, sent: unknown[] = []) => ({
    isPending: false,
    mutate: (input: never, call: Callbacks = {}) => {
      sent.push(input);
      const answer = mocks.answer;
      const settle = async () => {
        if (answer === 'fail') {
          const error = new Error('failed');
          await hook.onError?.(error, input);
          call.onError?.(error, input);
          return;
        }
        const result = saved(input);
        await hook.onSuccess?.(result, input);
        call.onSuccess?.(result, input);
      };
      if (mocks.hold) mocks.held.push(settle);
      else void settle();
    },
  });
  return {
    trpc: {
      useUtils: () => ({ deals: invalidate, leads: invalidate, leadActivity: invalidate }),
      deals: {
        board: {
          useQuery: (input: unknown) => {
            mocks.boardInputs.push(input);
            return mocks.board;
          },
        },
        create: { useMutation: (hook?: Callbacks) => mutation(hook) },
        update: { useMutation: (hook?: Callbacks) => mutation(hook, mocks.updates) },
        delete: { useMutation: (hook?: Callbacks) => mutation(hook) },
      },
      leads: { assignees: { useQuery: () => ({ data: [] }) } },
      leadSearch: { suggest: { useQuery: () => ({ data: [], isFetching: false }) } },
    },
  };
});
vi.mock('@/hooks/use-organization', () => ({
  useOrganization: () => ({ organizationId: ORG_ID }),
}));
vi.mock('next/navigation', async () => {
  const { searchParamsCache } = await import('@/test/mocks/next-navigation');
  // One object for every render, like Next's useRouter (#636)
  const router = { replace: mocks.replace, push: vi.fn() };
  // A new object only when mocks.search changes, like Next's useSearchParams (#719)
  const searchParamsFor = searchParamsCache();
  return {
    useSearchParams: () => searchParamsFor(mocks.search),
    usePathname: () => '/ja/deals',
    useRouter: () => router,
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

const deal: DealCard = {
  id: 'deal-1',
  leadId: 'lead-1',
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
  leadName: null,
  company: '架空商事',
  hasOpenTask: true,
};

const lostDeal: DealCard = {
  ...deal,
  id: 'deal-2',
  name: '移行',
  stage: 'lost',
  probability: 0,
  weightedAmount: 0,
  forecastCategory: 'lost',
  closedOn: '2026-10-20',
  lostReason: 'competitor',
  lostNote: '架空システムズに決定',
};

const boardData = (deals: DealCard[], canEdit = true) => ({
  columns: DEAL_STAGES.map((stage) => {
    const inStage = deals.filter((d) => d.stage === stage);
    return {
      stage,
      count: inStage.length,
      amount: inStage.reduce((sum, d) => sum + (d.amount ?? 0), 0),
      weightedAmount: inStage.reduce((sum, d) => sum + d.weightedAmount, 0),
      deals: inStage,
    };
  }),
  truncated: false,
  today: '2026-10-24',
  canEdit,
  canDelete: false,
});

const showBoard = (data: unknown) => {
  mocks.board = { data, isError: false, isPlaceholderData: false, refetch: vi.fn() };
};

function renderScreen() {
  return render(
    <NextIntlClientProvider locale="ja" messages={messages}>
      <DealsScreen />
    </NextIntlClientProvider>
  );
}

const column = (name: string) => screen.getByRole('region', { name });
const moveButton = (name: string) =>
  screen.getByRole('button', { name: `「${name}」のステージを移動` });

/** Let the held answers of the server through */
const release = () =>
  act(async () => {
    for (const settle of mocks.held.splice(0)) await settle();
  });

/** The undo of the last success toast */
const undoOfLastToast = () =>
  (mocks.toast.success.mock.lastCall?.[1] as ToastOptions | undefined)?.action;

beforeEach(() => {
  vi.clearAllMocks();
  showBoard(boardData([deal]));
  mocks.refetched = undefined;
  mocks.boardInputs = [];
  mocks.updates = [];
  mocks.answer = 'ok';
  mocks.hold = false;
  mocks.held = [];
  mocks.search = '';
});

describe('DealsScreen', () => {
  it('reads the board for everyone by default and for the URL filters', () => {
    renderScreen();
    expect(mocks.boardInputs.at(-1)).toEqual({ organizationId: ORG_ID, owner: 'all' });
    expect(column('提案')).toBeInTheDocument();

    mocks.search = 'owner=mine&kind=migration&period=thisMonth&view=list';
    renderScreen();
    expect(mocks.boardInputs.at(-1)).toMatchObject({
      owner: 'mine',
      kinds: ['migration'],
      closeFrom: expect.stringMatching(/^\d{4}-\d{2}-01$/),
    });
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('keeps the view in the URL', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole('radio', { name: '一覧' }));
    expect(mocks.replace).toHaveBeenCalledWith('/ja/deals?view=list', { scroll: false });
  });

  describe('moving between open stages (#720)', () => {
    it('shows the move before the server answers, then says the new probability', async () => {
      const user = userEvent.setup();
      mocks.hold = true;
      mocks.refetched = boardData([
        { ...deal, stage: 'negotiation', probability: 70, weightedAmount: 2_100_000 },
      ]);
      renderScreen();
      await user.click(moveButton('AS/400 現行調査'));
      await user.click(screen.getByRole('menuitem', { name: '「条件の調整」へ移す' }));

      expect(mocks.updates).toEqual([
        { organizationId: ORG_ID, dealId: 'deal-1', stage: 'negotiation' },
      ]);
      // On the board at once, with the column totals moved along
      const negotiation = column('条件の調整');
      expect(within(negotiation).getByRole('link', { name: 'AS/400 現行調査' })).toBeInTheDocument();
      expect(within(negotiation).getByText(/^1件/)).toBeInTheDocument();
      expect(within(negotiation).getByText('70%')).toBeInTheDocument();
      expect(within(column('提案')).queryByRole('link')).not.toBeInTheDocument();
      expect(mocks.toast.success).not.toHaveBeenCalled();

      await release();
      expect(mocks.toast.success).toHaveBeenCalledWith(
        '「AS/400 現行調査」を「条件の調整」に移しました（確度 70%）',
        { action: { label: '元に戻す', onClick: expect.any(Function) } }
      );
      expect(within(column('条件の調整')).getByRole('link', { name: 'AS/400 現行調査' })).toBeInTheDocument();
    });

    it('undoes a move from its toast, with the probability the move reset', async () => {
      const user = userEvent.setup();
      showBoard(boardData([{ ...deal, probability: 55 }]));
      mocks.refetched = boardData([{ ...deal, stage: 'negotiation', probability: 70 }]);
      renderScreen();
      await user.click(moveButton('AS/400 現行調査'));
      await user.click(screen.getByRole('menuitem', { name: '「条件の調整」へ移す' }));
      await waitFor(() => expect(undoOfLastToast()).toBeDefined());

      mocks.hold = true;
      mocks.refetched = boardData([{ ...deal, probability: 55 }]);
      act(() => undoOfLastToast()?.onClick());
      expect(mocks.updates.at(-1)).toEqual({
        organizationId: ORG_ID,
        dealId: 'deal-1',
        stage: 'proposal',
        probability: 55,
      });
      expect(within(column('提案')).getByRole('link', { name: 'AS/400 現行調査' })).toBeInTheDocument();

      await release();
      expect(mocks.toast.success).toHaveBeenLastCalledWith(
        '「AS/400 現行調査」を「提案」に戻しました'
      );
    });

    it('offers to undo only the latest move of a deal', async () => {
      const user = userEvent.setup();
      mocks.hold = true;
      renderScreen();
      await user.click(moveButton('AS/400 現行調査'));
      await user.click(screen.getByRole('menuitem', { name: '「条件の調整」へ移す' }));
      await user.click(moveButton('AS/400 現行調査'));
      await user.click(screen.getByRole('menuitem', { name: '「見極め」へ移す' }));
      expect(within(column('見極め')).getByRole('link', { name: 'AS/400 現行調査' })).toBeInTheDocument();
      expect(mocks.updates).toEqual([
        { organizationId: ORG_ID, dealId: 'deal-1', stage: 'negotiation' },
        { organizationId: ORG_ID, dealId: 'deal-1', stage: 'qualification' },
      ]);

      await release();
      expect(mocks.toast.success).toHaveBeenNthCalledWith(
        1,
        '「AS/400 現行調査」を「条件の調整」に移しました（確度 70%）'
      );
      expect(mocks.toast.success).toHaveBeenNthCalledWith(
        2,
        '「AS/400 現行調査」を「見極め」に移しました（確度 10%）',
        { action: { label: '元に戻す', onClick: expect.any(Function) } }
      );
      // Back to where the latest move started from
      act(() => undoOfLastToast()?.onClick());
      expect(mocks.updates.at(-1)).toEqual({
        organizationId: ORG_ID,
        dealId: 'deal-1',
        stage: 'negotiation',
        probability: 70,
      });
    });

    it('puts the card back and says so when the move fails', async () => {
      const user = userEvent.setup();
      mocks.hold = true;
      mocks.answer = 'fail';
      renderScreen();
      await user.click(moveButton('AS/400 現行調査'));
      await user.click(screen.getByRole('menuitem', { name: '「見極め」へ移す' }));
      expect(within(column('見極め')).getByRole('link', { name: 'AS/400 現行調査' })).toBeInTheDocument();

      await release();
      expect(within(column('提案')).getByRole('link', { name: 'AS/400 現行調査' })).toBeInTheDocument();
      expect(within(column('見極め')).queryByRole('link')).not.toBeInTheDocument();
      expect(mocks.toast.error).toHaveBeenCalledWith('保存できませんでした。もう一度お試しください');
      expect(mocks.toast.success).not.toHaveBeenCalled();
    });

    it('keeps the focus on the move button of the card, in its new column and back', async () => {
      const user = userEvent.setup();
      mocks.hold = true;
      mocks.answer = 'fail';
      renderScreen();
      await user.click(moveButton('AS/400 現行調査'));
      await user.click(screen.getByRole('menuitem', { name: '「条件の調整」へ移す' }));
      expect(
        within(column('条件の調整')).getByRole('button', { name: '「AS/400 現行調査」のステージを移動' })
      ).toHaveFocus();

      await release();
      expect(
        within(column('提案')).getByRole('button', { name: '「AS/400 現行調査」のステージを移動' })
      ).toHaveFocus();
    });
  });

  it('loses a deal only with a reason', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(moveButton('AS/400 現行調査'));
    await user.click(screen.getByRole('menuitem', { name: '「失注」へ移す' }));
    const dialog = screen.getByRole('dialog', { name: '「AS/400 現行調査」を失注にする' });
    expect(dialog).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '失注にする' }));
    expect(screen.getByText('失注理由を選んでください')).toBeInTheDocument();
    expect(mocks.updates).toEqual([]);

    await user.click(screen.getByRole('combobox', { name: '失注理由' }));
    // 保留 is not a loss (#445), so a deal cannot be lost for it
    expect(screen.getByRole('option', { name: '時期' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '保留' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: '他社選定' }));
    await user.type(screen.getByLabelText('競合（任意）'), '架空システムズ');
    await user.click(screen.getByRole('button', { name: '失注にする' }));
    expect(mocks.updates).toEqual([
      {
        organizationId: ORG_ID,
        dealId: 'deal-1',
        stage: 'lost',
        lostReason: 'competitor',
        lostNote: null,
        competitor: '架空システムズ',
      },
    ]);
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith('「AS/400 現行調査」を「失注」に移しました')
    );
  });

  it('wins a deal from the menu only after confirming the day and the amount', async () => {
    const user = userEvent.setup();
    const today = jstDate();
    renderScreen();
    await user.click(moveButton('AS/400 現行調査'));
    await user.click(screen.getByRole('menuitem', { name: '「受注」へ移す' }));
    const dialog = screen.getByRole('dialog', { name: '「AS/400 現行調査」を受注にする' });
    expect(dialog).toHaveAccessibleDescription(
      'リード「架空商事」は成約になります。商談を開き直しても、リードは成約のままです。'
    );
    expect(screen.getByLabelText('受注日')).toHaveValue(today.replaceAll('-', '/'));
    const amount = screen.getByLabelText('金額（税抜）');
    expect(amount).toHaveValue('3000000');
    expect(amount).toHaveAccessibleDescription(/＝ ￥3,000,000$/);
    expect(mocks.updates).toEqual([]);

    // The amount box reads commas and full-width digits as the deal form does (#720)
    await user.clear(amount);
    await user.type(amount, '３,５００,０００');
    expect(within(dialog).getByText('＝ ￥3,500,000')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '受注にする' }));
    expect(mocks.updates).toEqual([
      {
        organizationId: ORG_ID,
        dealId: 'deal-1',
        stage: 'won',
        closedOn: today,
        amount: 3_500_000,
      },
    ]);
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith('「AS/400 現行調査」を「受注」に移しました')
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('gives the focus back to the card when a question from its menu closes', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(moveButton('AS/400 現行調査'));
    await user.click(screen.getByRole('menuitem', { name: '「受注」へ移す' }));
    await user.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.updates).toEqual([]);
    await waitFor(() => expect(moveButton('AS/400 現行調査')).toHaveFocus());

    // Won: the card is drawn in the won column, whose move button takes the focus
    mocks.refetched = boardData([{ ...deal, stage: 'won', probability: 100, closedOn: jstDate() }]);
    await user.click(moveButton('AS/400 現行調査'));
    await user.click(screen.getByRole('menuitem', { name: '「受注」へ移す' }));
    await user.click(screen.getByRole('button', { name: '受注にする' }));
    await waitFor(() =>
      expect(
        within(column('受注（直近30日）')).getByRole('button', {
          name: '「AS/400 現行調査」のステージを移動',
        })
      ).toHaveFocus()
    );
  });

  it('asks the same when a card is dragged to the won column', async () => {
    const user = userEvent.setup();
    renderScreen();
    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? '',
      effectAllowed: '',
      dropEffect: '',
    };
    const card = screen.getByRole('link', { name: 'AS/400 現行調査' }).closest('li');
    fireEvent.dragStart(card as HTMLElement, { dataTransfer });
    const won = column('受注（直近30日）');
    fireEvent.dragOver(won, { dataTransfer });
    fireEvent.drop(won, { dataTransfer });
    expect(screen.getByRole('dialog', { name: '「AS/400 現行調査」を受注にする' })).toBeInTheDocument();
    expect(mocks.updates).toEqual([]);

    await user.click(screen.getByRole('button', { name: '受注にする' }));
    expect(mocks.updates).toEqual([
      {
        organizationId: ORG_ID,
        dealId: 'deal-1',
        stage: 'won',
        closedOn: jstDate(),
        amount: 3_000_000,
      },
    ]);
  });

  it('does not win with a day the API does not take or text that is not a date', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(moveButton('AS/400 現行調査'));
    await user.click(screen.getByRole('menuitem', { name: '「受注」へ移す' }));
    const date = screen.getByLabelText('受注日');

    await user.clear(date);
    await user.type(date, '1999/12/31');
    await user.click(screen.getByRole('button', { name: '受注にする' }));
    expect(date).toHaveAccessibleDescription('受注日は2000〜2100年の日付で入力してください');

    await user.clear(date);
    await user.type(date, '2026/13/45');
    await user.click(screen.getByRole('button', { name: '受注にする' }));
    expect(date).toHaveAccessibleDescription(messages.leadHearings.editor.dateInvalid);
    expect(mocks.updates).toEqual([]);
  });

  it('says winning a lost deal clears its lost reason, and losing a won deal keeps its lead won', async () => {
    const user = userEvent.setup();
    const wonDeal: DealCard = { ...deal, id: 'deal-3', name: '保守', stage: 'won', probability: 100 };
    showBoard(boardData([lostDeal, wonDeal]));
    renderScreen();
    await user.click(moveButton('移行'));
    await user.click(screen.getByRole('menuitem', { name: '「受注」へ移す' }));
    expect(
      screen.getByRole('dialog', { name: '「移行」を受注にする' })
    ).toHaveAccessibleDescription(
      'リード「架空商事」は成約になります。商談を開き直しても、リードは成約のままです。 失注理由と詳細は消えます。'
    );
    await user.click(screen.getByRole('button', { name: 'キャンセル' }));

    await user.click(moveButton('保守'));
    await user.click(screen.getByRole('menuitem', { name: '「失注」へ移す' }));
    expect(screen.getByRole('dialog', { name: '「保守」を失注にする' })).toHaveAccessibleDescription(
      '失注理由は、勝ち負けの分析に使います リードは成約のままです。'
    );
    expect(mocks.updates).toEqual([]);
  });

  it('reopens a lost deal only after saying what is cleared', async () => {
    const user = userEvent.setup();
    showBoard(boardData([lostDeal]));
    renderScreen();
    await user.click(moveButton('移行'));
    await user.click(screen.getByRole('menuitem', { name: '「提案」へ移す' }));
    const dialog = screen.getByRole('alertdialog', { name: '「移行」を開き直しますか？' });
    expect(dialog).toHaveAccessibleDescription(
      '失注理由（他社選定）と詳細は消えます。 確度は「提案」の既定値 40% になり、予測の区分の上書きも消えます。'
    );
    expect(mocks.updates).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(mocks.updates).toEqual([]);

    await user.click(moveButton('移行'));
    await user.click(screen.getByRole('menuitem', { name: '「提案」へ移す' }));
    await user.click(screen.getByRole('button', { name: '開き直す' }));
    expect(mocks.updates).toEqual([
      { organizationId: ORG_ID, dealId: 'deal-2', stage: 'proposal' },
    ]);
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith('「移行」を「提案」に移しました（確度 40%）')
    );
  });

  it('says a won deal keeps its lead won when it is reopened by dragging', () => {
    showBoard(boardData([{ ...deal, stage: 'won', probability: 100, closedOn: '2026-10-20' }]));
    renderScreen();
    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? '',
      effectAllowed: '',
      dropEffect: '',
    };
    const card = screen.getByRole('link', { name: 'AS/400 現行調査' }).closest('li');
    fireEvent.dragStart(card as HTMLElement, { dataTransfer });
    const negotiation = column('条件の調整');
    fireEvent.dragOver(negotiation, { dataTransfer });
    fireEvent.drop(negotiation, { dataTransfer });
    expect(
      screen.getByRole('alertdialog', { name: '「AS/400 現行調査」を開き直しますか？' })
    ).toHaveAccessibleDescription(
      '確度は「条件の調整」の既定値 70% になり、予測の区分の上書きも消えます。 リードは成約のままです。'
    );
    expect(mocks.updates).toEqual([]);
  });

  describe('the list (#720)', () => {
    const later: DealCard = {
      ...deal,
      id: 'deal-4',
      name: '基幹 移行',
      stage: 'qualification',
      amount: 9_000_000,
      expectedCloseOn: '2027-03-31',
    };
    const noDate: DealCard = {
      ...deal,
      id: 'deal-5',
      name: 'AX 化',
      stage: 'negotiation',
      amount: null,
      expectedCloseOn: null,
    };
    const rowNames = () =>
      screen
        .getAllByRole('row')
        .slice(1)
        .map((row) => within(row).getAllByRole('link')[0].textContent);

    it("keeps the board's order unless the URL sorts it", () => {
      showBoard(boardData([deal, later, noDate]));
      mocks.search = 'view=list';
      renderScreen();
      expect(rowNames()).toEqual(['基幹 移行', 'AS/400 現行調査', 'AX 化']);
      expect(screen.getByRole('columnheader', { name: /ステージ/ })).toHaveAttribute(
        'aria-sort',
        'ascending'
      );
    });

    it('lists the earliest close dates first for the link of the forecast', () => {
      showBoard(boardData([later, noDate, deal]));
      mocks.search = 'view=list&sort=expectedCloseOn';
      renderScreen();
      // No close date goes last
      expect(rowNames()).toEqual(['AS/400 現行調査', '基幹 移行', 'AX 化']);
      expect(screen.getByRole('columnheader', { name: /受注予定日/ })).toHaveAttribute(
        'aria-sort',
        'ascending'
      );
    });

    it('sorts by amount from its header, largest first, and flips on the next click', async () => {
      const user = userEvent.setup();
      showBoard(boardData([deal, later, noDate]));
      mocks.search = 'view=list';
      const first = renderScreen();
      await user.click(screen.getByRole('button', { name: '金額（税抜）で並べ替える' }));
      expect(mocks.replace).toHaveBeenLastCalledWith('/ja/deals?view=list&sort=amount', {
        scroll: false,
      });
      first.unmount();

      mocks.search = 'view=list&sort=amount';
      const second = renderScreen();
      expect(rowNames()).toEqual(['基幹 移行', 'AS/400 現行調査', 'AX 化']);
      await user.click(screen.getByRole('button', { name: '金額（税抜）（大きい順）' }));
      expect(mocks.replace).toHaveBeenLastCalledWith(
        '/ja/deals?view=list&sort=amount&order=asc',
        { scroll: false }
      );
      second.unmount();

      mocks.search = 'view=list&sort=amount&order=asc';
      renderScreen();
      expect(rowNames()).toEqual(['AS/400 現行調査', '基幹 移行', 'AX 化']);
      // The stage's header puts back the board's order
      await user.click(screen.getByRole('button', { name: 'ステージで並べ替える' }));
      expect(mocks.replace).toHaveBeenLastCalledWith('/ja/deals?view=list', { scroll: false });
    });
  });

  it('says when no deal matches the filters, and clears them', async () => {
    const user = userEvent.setup();
    showBoard(boardData([]));
    mocks.search = 'owner=mine&kind=migration&view=list&sort=amount';
    renderScreen();
    expect(screen.getByText('条件に合う商談はありません')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('まだ商談はありません')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '絞り込みを解除' }));
    expect(mocks.replace).toHaveBeenCalledWith('/ja/deals?view=list&sort=amount', {
      scroll: false,
    });
  });

  it('says when the board cannot be read', async () => {
    const user = userEvent.setup();
    mocks.board = { data: undefined, isError: true, isPlaceholderData: false, refetch: vi.fn() };
    renderScreen();
    expect(screen.getByRole('alert')).toHaveTextContent('商談を読み込めませんでした');
    await user.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(mocks.board.refetch).toHaveBeenCalled();
  });

  it("tells a parent organization's viewer they may not see the deals", () => {
    mocks.board = {
      data: undefined,
      isError: true,
      error: { data: { code: 'FORBIDDEN' } },
      isPlaceholderData: false,
      refetch: vi.fn(),
    } as typeof mocks.board;
    renderScreen();
    expect(screen.getByText('商談を見る権限がありません')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '再読み込み' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: '一覧' })).not.toBeInTheDocument();
  });

  it('tells those who cannot change deals that the board is read only, and why', () => {
    showBoard(boardData([deal], false));
    renderScreen();
    expect(screen.getByText('閲覧のみです')).toBeInTheDocument();
    expect(
      screen.getByText('商談の作成・変更・ステージの移動は、リードを編集できるメンバーができます')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '商談を作成' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '「AS/400 現行調査」のステージを移動' })).not.toBeInTheDocument();
  });

  it('offers to create the first deal to those who can, and says who can to the others', async () => {
    const user = userEvent.setup();
    showBoard(boardData([]));
    renderScreen();
    expect(screen.getByText('まだ商談はありません')).toBeInTheDocument();
    expect(
      screen.getByText('商談は、リードの詳細か、この画面の「商談を作成」から作成します')
    ).toBeInTheDocument();
    // The header's button and the empty board's
    const create = screen.getAllByRole('button', { name: '商談を作成' });
    expect(create).toHaveLength(2);
    await user.click(create[1]);
    expect(screen.getByRole('dialog', { name: '商談を作成' })).toBeInTheDocument();
  });

  it('does not offer to create the first deal to those who cannot', () => {
    showBoard(boardData([], false));
    renderScreen();
    expect(screen.getByText('まだ商談はありません')).toBeInTheDocument();
    expect(screen.getByText('商談を作成できるのは、リードを編集できるメンバーです')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '商談を作成' })).not.toBeInTheDocument();
  });
});
