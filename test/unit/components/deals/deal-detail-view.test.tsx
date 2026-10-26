/**
 * The deal page (#436): winning and reopening from the stage path ask first, those who cannot
 * change deals are told the page is read only, and a failed deletion says so (real next-intl
 * messages and UI components; tRPC mocked)
 */
import { DealDetailView } from '@/components/features/deals/deal-detail-view';
import type { DealDetail } from '@/lib/features/deals/service';
import { jstDate } from '@/lib/features/leads/types/pipeline';
import messages from '@/locales/ja/common.json';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
  fail: false,
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/trpc/client', () => {
  const invalidate = { invalidate: vi.fn() };
  // Runs the hook's callbacks like tRPC does: the mutation's own, then the call's
  const mutation = (options: MutationOptions = {}, sent: unknown[] = []) => ({
    isPending: false,
    mutate: (input: unknown, call?: MutationOptions) => {
      sent.push(input);
      if (mocks.fail) {
        options.onError?.(new Error('failed'), input);
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
        delete: { useMutation: (options?: MutationOptions) => mutation(options) },
      },
      leads: { assignees: { useQuery: () => ({ data: [] }) } },
      leadSearch: { suggest: { useQuery: () => ({ data: [], isFetching: false }) } },
    },
  };
});
vi.mock('@/hooks/use-organization', () => ({
  useOrganization: () => ({ organizationId: ORG_ID }),
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
  lead: { id: LEAD_ID, name: '山田 太郎', company: '架空商事', status: 'negotiating' },
  previousDeal: null,
  nextDeals: [],
  history: [],
  canEdit: true,
  canDelete: true,
  ...overrides,
});

function renderView() {
  return render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <DealDetailView dealId={DEAL_ID} />
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.get = { data: detail(), isError: false, error: null, refetch: vi.fn() };
  mocks.updates = [];
  mocks.fail = false;
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

  it('tells those who cannot change deals that the page is read only', () => {
    mocks.get.data = detail({ canEdit: false, canDelete: false });
    renderView();
    expect(screen.getByText('閲覧のみ')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '編集' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '「受注」に移す' })).not.toBeInTheDocument();
  });

  it('says a deletion failed as a deletion, and a move as a move', async () => {
    const user = userEvent.setup();
    mocks.fail = true;
    renderView();
    await user.click(screen.getByRole('button', { name: '削除' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '削除' }));
    expect(mocks.toast.error).toHaveBeenLastCalledWith(
      '削除できませんでした。もう一度お試しください'
    );

    await user.click(screen.getByRole('button', { name: '「条件の調整」に移す' }));
    expect(mocks.toast.error).toHaveBeenLastCalledWith(
      '「AS/400 現行調査」を「条件の調整」に移せませんでした。「提案」に戻しました'
    );
  });
});
