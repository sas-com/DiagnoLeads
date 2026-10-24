/**
 * The forecast screen (#437): the totals against the target, the owners' rows, the notes on
 * overdue and unpriced deals, the week's changes, the period in the URL, and setting the month's
 * targets (real next-intl messages; tRPC and the router mocked)
 */
import { ForecastScreen } from '@/components/features/sales-forecast/forecast-screen';
import { TargetsDialog } from '@/components/features/sales-forecast/targets-dialog';
import { forecastRow } from '@/lib/features/sales-forecast/report';
import { CHANGE_KINDS } from '@/lib/features/sales-forecast/report';
import messages from '@/locales/ja/common.json';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const REP = '770e8400-e29b-41d4-a716-446655440001';

const mocks = vi.hoisted(() => ({
  forecast: { data: undefined as unknown, isError: false, isPlaceholderData: false, refetch: vi.fn() },
  forecastInputs: [] as unknown[],
  targets: { data: undefined as unknown },
  saves: [] as unknown[],
  search: '',
  replace: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/trpc/client', () => {
  const invalidate = { invalidate: vi.fn() };
  return {
    trpc: {
      useUtils: () => ({ salesTargets: invalidate, salesForecast: invalidate }),
      salesForecast: {
        get: {
          useQuery: (input: unknown) => {
            mocks.forecastInputs.push(input);
            return mocks.forecast;
          },
        },
      },
      salesTargets: {
        get: { useQuery: () => mocks.targets },
        save: {
          useMutation: (options: { onSuccess?: () => void } = {}) => ({
            isPending: false,
            mutate: (input: unknown) => {
              mocks.saves.push(input);
              options.onSuccess?.();
            },
          }),
        },
        setFiscalYearStart: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
      },
    },
  };
});
vi.mock('@/hooks/use-organization', () => ({
  useOrganization: () => ({ organizationId: ORG_ID }),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mocks.search),
  usePathname: () => '/ja/forecast',
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

const figures = {
  won: 2_000_000,
  commit: 3_000_000,
  bestCase: 1_000_000,
  pipeline: 5_000_000,
  weighted: 3_000_000,
  openCount: 4,
  noAmountCount: 1,
};
const emptyGroups = Object.fromEntries(
  CHANGE_KINDS.map((kind) => [kind, { count: 0, amount: 0, deals: [] }])
);

const forecastData = (overrides: Record<string, unknown> = {}) => ({
  period: 'thisQuarter',
  range: { from: '2026-10-01', to: '2026-12-31', months: ['2026-10-01', '2026-11-01', '2026-12-01'] },
  today: '2026-10-24',
  fiscalYearStartMonth: 4,
  owners: [
    { ...forecastRow(figures, 10_000_000), ownerUserId: REP, ownerName: '営業 花子' },
    { ...forecastRow({ ...figures, won: 0, noAmountCount: 0 }, null), ownerUserId: null, ownerName: null },
  ],
  total: forecastRow({ ...figures, won: 2_000_000 }, 10_000_000),
  overdue: { count: 2, amount: 600_000 },
  changes: {
    groups: {
      ...emptyGroups,
      advanced: {
        count: 1,
        amount: 1_500_000,
        deals: [
          {
            id: 'deal-1',
            name: 'AS/400 移行',
            ownerName: '営業 花子',
            stage: 'negotiation',
            amount: 1_500_000,
            expectedCloseOn: '2026-12-31',
            before: { stage: 'proposal', amount: 1_000_000, expectedCloseOn: '2026-11-30' },
          },
        ],
      },
    },
    amountDelta: 500_000,
  },
  canEditTargets: true,
  ...overrides,
});

function renderWithIntl(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="ja" messages={messages}>
      {node}
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.forecast = { data: forecastData(), isError: false, isPlaceholderData: false, refetch: vi.fn() };
  mocks.forecastInputs = [];
  mocks.saves = [];
  mocks.search = '';
  mocks.targets = { data: undefined };
});

describe('ForecastScreen', () => {
  it('reads this quarter by default and the period from the URL', () => {
    renderWithIntl(<ForecastScreen />);
    expect(mocks.forecastInputs.at(-1)).toEqual({ organizationId: ORG_ID, period: 'thisQuarter' });
    mocks.search = 'period=thisMonth';
    renderWithIntl(<ForecastScreen />);
    expect(mocks.forecastInputs.at(-1)).toEqual({ organizationId: ORG_ID, period: 'thisMonth' });
  });

  it('keeps the chosen period in the URL', async () => {
    const user = userEvent.setup();
    renderWithIntl(<ForecastScreen />);
    await user.click(screen.getByRole('radio', { name: '今期' }));
    expect(mocks.replace).toHaveBeenCalledWith('/ja/forecast?period=thisFiscalYear', { scroll: false });
  });

  it('shows the totals against the target with their rates', () => {
    renderWithIntl(<ForecastScreen />);
    expect(screen.getByText(/2026-10-01〜2026-12-31/)).toBeInTheDocument();
    expect(screen.getByText('達成率 20%')).toBeInTheDocument();
    expect(screen.getByText('見込みの達成率 50%')).toBeInTheDocument();
  });

  it('lists each owner, the deals without one and the total', () => {
    renderWithIntl(<ForecastScreen />);
    const table = screen.getByRole('table', { name: '担当者ごとの予測' });
    expect(within(table).getByRole('row', { name: /営業 花子/ })).toHaveTextContent('20%');
    expect(within(table).getByRole('row', { name: /担当未定/ })).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: /合計/ })).toBeInTheDocument();
  });

  it('points at overdue and unpriced deals', () => {
    renderWithIntl(<ForecastScreen />);
    expect(screen.getByText(/期間より前のまま開いている商談が2件/)).toBeInTheDocument();
    expect(screen.getByText('金額が未定の商談が1件あります')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '商談のボードを開く' })).toHaveAttribute('href', '/ja/deals');
  });

  it("lists the week's changes with the stage moves", () => {
    renderWithIntl(<ForecastScreen />);
    expect(screen.getByText(/開いている商談の金額の増減 \+/)).toBeInTheDocument();
    expect(screen.getByText('前進')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'AS/400 移行' })).toHaveAttribute('href', '/ja/deals/deal-1');
    expect(screen.getByText('提案 → 条件の調整')).toBeInTheDocument();
    expect(screen.queryByText('失注')).not.toBeInTheDocument();
  });

  it('offers the targets only to those who may set them', () => {
    mocks.forecast.data = forecastData({ canEditTargets: false });
    renderWithIntl(<ForecastScreen />);
    expect(screen.queryByRole('button', { name: '目標を設定' })).not.toBeInTheDocument();
  });

  it('says when the forecast cannot be read', async () => {
    const user = userEvent.setup();
    mocks.forecast = { data: undefined, isError: true, isPlaceholderData: false, refetch: vi.fn() };
    renderWithIntl(<ForecastScreen />);
    expect(screen.getByRole('alert')).toHaveTextContent('予測を読み込めませんでした');
    await user.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(mocks.forecast.refetch).toHaveBeenCalled();
  });
});

describe('TargetsDialog', () => {
  const targetsData = {
    fiscalYear: 2026,
    fiscalYearStartMonth: 4,
    months: Array.from({ length: 12 }, (_, i) => {
      const month = ((3 + i) % 12) + 1;
      const year = month >= 4 ? 2026 : 2027;
      return `${year}-${String(month).padStart(2, '0')}-01`;
    }),
    members: [{ userId: REP, displayName: '営業 花子' }],
    formerMembers: [] as { userId: string; displayName: string | null }[],
    targets: [{ userId: REP, month: '2026-10-01', amount: 8_000_000 }],
    canEdit: true,
  };
  const pickOctober = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('combobox', { name: '月' }));
    await user.click(screen.getByRole('option', { name: '2026-10' }));
  };

  it('fills the month and saves only the boxes that changed', async () => {
    const user = userEvent.setup();
    mocks.targets = { data: targetsData };
    const onOpenChange = vi.fn();
    renderWithIntl(<TargetsDialog open onOpenChange={onOpenChange} organizationId={ORG_ID} />);
    await pickOctober(user);
    expect(screen.getByLabelText('営業 花子')).toHaveValue('8000000');
    await user.type(screen.getByLabelText('組織全体'), '20,000,000');
    await user.click(screen.getByRole('button', { name: '保存' }));
    // The member's unchanged 8,000,000 is not sent, so another admin's edit of it is kept
    expect(mocks.saves).toEqual([
      {
        organizationId: ORG_ID,
        entries: [{ userId: null, month: '2026-10-01', amount: 20_000_000 }],
      },
    ]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('removes a target by emptying its box and closes without a call when nothing changed', async () => {
    const user = userEvent.setup();
    mocks.targets = { data: targetsData };
    const onOpenChange = vi.fn();
    renderWithIntl(<TargetsDialog open onOpenChange={onOpenChange} organizationId={ORG_ID} />);
    await pickOctober(user);
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(mocks.saves).toEqual([]);
    expect(onOpenChange).toHaveBeenCalledWith(false);

    await user.clear(screen.getByLabelText('営業 花子'));
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(mocks.saves).toEqual([
      { organizationId: ORG_ID, entries: [{ userId: REP, month: '2026-10-01', amount: null }] },
    ]);
  });

  it('only lets the target of someone who left be removed', async () => {
    const user = userEvent.setup();
    const LEFT = '770e8400-e29b-41d4-a716-446655440099';
    mocks.targets = {
      data: {
        ...targetsData,
        formerMembers: [{ userId: LEFT, displayName: '退職 次郎' }],
        targets: [...targetsData.targets, { userId: LEFT, month: '2026-10-01', amount: 5_000_000 }],
      },
    };
    renderWithIntl(<TargetsDialog open onOpenChange={vi.fn()} organizationId={ORG_ID} />);
    await pickOctober(user);
    const box = screen.getByLabelText('退職 次郎');
    expect(box).toHaveValue('5000000');
    expect(box).toHaveAccessibleDescription(/組織にいない人の目標です/);

    await user.clear(box);
    await user.type(box, '6000000');
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByText('組織にいない人の目標は、欄を空にして消すことだけができます')).toBeInTheDocument();
    expect(mocks.saves).toEqual([]);

    await user.clear(box);
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(mocks.saves).toEqual([
      { organizationId: ORG_ID, entries: [{ userId: LEFT, month: '2026-10-01', amount: null }] },
    ]);
  });

  it('refuses amounts that are not whole yen', async () => {
    const user = userEvent.setup();
    mocks.targets = { data: targetsData };
    renderWithIntl(<TargetsDialog open onOpenChange={vi.fn()} organizationId={ORG_ID} />);
    await user.clear(screen.getByLabelText('営業 花子'));
    await user.type(screen.getByLabelText('営業 花子'), '1.5');
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByText('0以上の整数で入力してください')).toBeInTheDocument();
    expect(mocks.saves).toEqual([]);
  });
});
