/**
 * The deals screen (#436): the board from the query, the filters in the URL, moving a deal,
 * losing one only with a reason, winning one only after confirming the day and the amount,
 * reopening a closed one only after a confirmation, and the error and read-only states (real
 * next-intl messages; tRPC and the router mocked)
 */
import { DealsScreen } from '@/components/features/deals/deals-screen';
import type { DealCard } from '@/lib/features/deals/service';
import { DEAL_STAGES } from '@/lib/features/deals/types/pipeline';
import { jstDate } from '@/lib/features/leads/types/pipeline';
import messages from '@/locales/ja/common.json';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';

type MutateOptions = { onSuccess?: (result: unknown) => void };

const mocks = vi.hoisted(() => ({
  board: { data: undefined as unknown, isError: false, isPlaceholderData: false, refetch: vi.fn() },
  boardInputs: [] as unknown[],
  updates: [] as unknown[],
  search: '',
  replace: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/trpc/client', () => {
  const invalidate = { invalidate: vi.fn() };
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
        create: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
        update: {
          useMutation: () => ({
            isPending: false,
            mutate: (input: unknown, options?: MutateOptions) => {
              mocks.updates.push(input);
              options?.onSuccess?.({});
            },
          }),
        },
        delete: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
      },
      leads: { assignees: { useQuery: () => ({ data: [] }) } },
      leadSearch: { suggest: { useQuery: () => ({ data: [], isFetching: false }) } },
    },
  };
});
vi.mock('@/hooks/use-organization', () => ({
  useOrganization: () => ({ organizationId: ORG_ID }),
}));
vi.mock('next/navigation', () => {
  // One object for every render, like Next's useRouter (#636)
  const router = { replace: mocks.replace, push: vi.fn() };
  return {
    useSearchParams: () => new URLSearchParams(mocks.search),
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

const boardData = (deals: DealCard[]) => ({
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
  canEdit: true,
  canDelete: false,
});

function renderScreen() {
  return render(
    <NextIntlClientProvider locale="ja" messages={messages}>
      <DealsScreen />
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.board = { data: boardData([deal]), isError: false, isPlaceholderData: false, refetch: vi.fn() };
  mocks.boardInputs = [];
  mocks.updates = [];
  mocks.search = '';
});

describe('DealsScreen', () => {
  it('reads the board for everyone by default and for the URL filters', () => {
    renderScreen();
    expect(mocks.boardInputs.at(-1)).toEqual({ organizationId: ORG_ID, owner: 'all' });
    expect(screen.getByRole('region', { name: '提案' })).toBeInTheDocument();

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

  it('moves a deal and says so', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole('button', { name: '「AS/400 現行調査」のステージを移動' }));
    await user.click(screen.getByRole('menuitem', { name: '「条件の調整」へ移す' }));
    expect(mocks.updates).toEqual([
      { organizationId: ORG_ID, dealId: 'deal-1', stage: 'negotiation' },
    ]);
    expect(mocks.toast.success).toHaveBeenCalledWith(
      '「AS/400 現行調査」を「条件の調整」に移しました'
    );
  });

  it('loses a deal only with a reason', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole('button', { name: '「AS/400 現行調査」のステージを移動' }));
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
  });

  it('wins a deal from the menu only after confirming the day and the amount', async () => {
    const user = userEvent.setup();
    const today = jstDate();
    renderScreen();
    await user.click(screen.getByRole('button', { name: '「AS/400 現行調査」のステージを移動' }));
    await user.click(screen.getByRole('menuitem', { name: '「受注」へ移す' }));
    const dialog = screen.getByRole('dialog', { name: '「AS/400 現行調査」を受注にする' });
    expect(dialog).toHaveAccessibleDescription(
      'リード「架空商事」は成約になります。商談を開き直しても、リードは成約のままです。'
    );
    expect(screen.getByLabelText('受注日')).toHaveValue(today.replaceAll('-', '/'));
    const amount = screen.getByLabelText('金額（税抜）');
    expect(amount).toHaveValue('3000000');
    expect(mocks.updates).toEqual([]);

    await user.clear(amount);
    await user.type(amount, '3500000');
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
    expect(mocks.toast.success).toHaveBeenCalledWith('「AS/400 現行調査」を「受注」に移しました');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('sends nothing when winning is cancelled', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole('button', { name: '「AS/400 現行調査」のステージを移動' }));
    await user.click(screen.getByRole('menuitem', { name: '「受注」へ移す' }));
    await user.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.updates).toEqual([]);
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
    const won = screen.getByRole('region', { name: '受注（直近30日）' });
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
    await user.click(screen.getByRole('button', { name: '「AS/400 現行調査」のステージを移動' }));
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
    mocks.board = {
      data: boardData([lostDeal, wonDeal]),
      isError: false,
      isPlaceholderData: false,
      refetch: vi.fn(),
    };
    renderScreen();
    await user.click(screen.getByRole('button', { name: '「移行」のステージを移動' }));
    await user.click(screen.getByRole('menuitem', { name: '「受注」へ移す' }));
    expect(
      screen.getByRole('dialog', { name: '「移行」を受注にする' })
    ).toHaveAccessibleDescription(
      'リード「架空商事」は成約になります。商談を開き直しても、リードは成約のままです。 失注理由と詳細は消えます。'
    );
    await user.click(screen.getByRole('button', { name: 'キャンセル' }));

    await user.click(screen.getByRole('button', { name: '「保守」のステージを移動' }));
    await user.click(screen.getByRole('menuitem', { name: '「失注」へ移す' }));
    expect(screen.getByRole('dialog', { name: '「保守」を失注にする' })).toHaveAccessibleDescription(
      '失注理由は、勝ち負けの分析に使います リードは成約のままです。'
    );
    expect(mocks.updates).toEqual([]);
  });

  it('reopens a lost deal only after saying what is cleared', async () => {
    const user = userEvent.setup();
    mocks.board = {
      data: boardData([lostDeal]),
      isError: false,
      isPlaceholderData: false,
      refetch: vi.fn(),
    };
    renderScreen();
    await user.click(screen.getByRole('button', { name: '「移行」のステージを移動' }));
    await user.click(screen.getByRole('menuitem', { name: '「提案」へ移す' }));
    const dialog = screen.getByRole('alertdialog', { name: '「移行」を開き直しますか？' });
    expect(dialog).toHaveAccessibleDescription(
      '失注理由（他社選定）と詳細は消えます。 確度は「提案」の既定値 40% になり、予測の区分の上書きも消えます。'
    );
    expect(mocks.updates).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(mocks.updates).toEqual([]);

    await user.click(screen.getByRole('button', { name: '「移行」のステージを移動' }));
    await user.click(screen.getByRole('menuitem', { name: '「提案」へ移す' }));
    await user.click(screen.getByRole('button', { name: '開き直す' }));
    expect(mocks.updates).toEqual([
      { organizationId: ORG_ID, dealId: 'deal-2', stage: 'proposal' },
    ]);
    expect(mocks.toast.success).toHaveBeenCalledWith('「移行」を「提案」に移しました');
  });

  it('says a won deal keeps its lead won when it is reopened by dragging', () => {
    mocks.board = {
      data: boardData([{ ...deal, stage: 'won', probability: 100, closedOn: '2026-10-20' }]),
      isError: false,
      isPlaceholderData: false,
      refetch: vi.fn(),
    };
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
    const negotiation = screen.getByRole('region', { name: '条件の調整' });
    fireEvent.dragOver(negotiation, { dataTransfer });
    fireEvent.drop(negotiation, { dataTransfer });
    expect(
      screen.getByRole('alertdialog', { name: '「AS/400 現行調査」を開き直しますか？' })
    ).toHaveAccessibleDescription(
      '確度は「条件の調整」の既定値 70% になり、予測の区分の上書きも消えます。 リードは成約のままです。'
    );
    expect(mocks.updates).toEqual([]);
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

  it('tells those who cannot change deals that the board is read only', () => {
    mocks.board = {
      data: { ...boardData([deal]), canEdit: false },
      isError: false,
      isPlaceholderData: false,
      refetch: vi.fn(),
    };
    renderScreen();
    expect(screen.getByText('閲覧のみです')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '商談を作る' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '「AS/400 現行調査」のステージを移動' })
    ).not.toBeInTheDocument();
  });

  it('explains where deals come from while there are none', () => {
    mocks.board = { data: boardData([]), isError: false, isPlaceholderData: false, refetch: vi.fn() };
    renderScreen();
    expect(screen.getByText('まだ商談はありません')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '商談を作る' })).toBeInTheDocument();
  });
});
