/**
 * The deals screen (#436): the board from the query, the filters in the URL, moving a deal and
 * losing one only with a reason, and the error state (real next-intl messages; tRPC and the
 * router mocked)
 */
import { DealsScreen } from '@/components/features/deals/deals-screen';
import { DEAL_STAGES } from '@/lib/features/deals/types/pipeline';
import messages from '@/locales/ja/common.json';
import { render, screen } from '@testing-library/react';
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
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mocks.search),
  usePathname: () => '/ja/deals',
  useRouter: () => ({ replace: mocks.replace, push: vi.fn() }),
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

const deal = {
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

const boardData = (deals: (typeof deal)[]) => ({
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

  it('says when the board cannot be read', async () => {
    const user = userEvent.setup();
    mocks.board = { data: undefined, isError: true, isPlaceholderData: false, refetch: vi.fn() };
    renderScreen();
    expect(screen.getByRole('alert')).toHaveTextContent('商談を読み込めませんでした');
    await user.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(mocks.board.refetch).toHaveBeenCalled();
  });

  it('explains where deals come from while there are none', () => {
    mocks.board = { data: boardData([]), isError: false, isPlaceholderData: false, refetch: vi.fn() };
    renderScreen();
    expect(screen.getByText('まだ商談はありません')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '商談を作る' })).toBeInTheDocument();
  });
});
