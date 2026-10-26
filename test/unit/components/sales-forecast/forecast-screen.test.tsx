/**
 * The forecast screen (#437): the totals against the target, the owners' rows, the notes on
 * overdue, undated and unpriced deals, the week's changes, the period in the URL, and setting the
 * month's targets and the fiscal year start (real next-intl messages; tRPC and the router mocked)
 */
import { ForecastScreen } from '@/components/features/sales-forecast/forecast-screen';
import { TargetsDialog } from '@/components/features/sales-forecast/targets-dialog';
import { forecastRow } from '@/lib/features/sales-forecast/report';
import { CHANGE_KINDS } from '@/lib/features/sales-forecast/report';
import messages from '@/locales/ja/common.json';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const REP = '770e8400-e29b-41d4-a716-446655440001';

const mocks = vi.hoisted(() => ({
  forecast: { data: undefined as unknown, isError: false, isPlaceholderData: false, refetch: vi.fn() },
  forecastInputs: [] as unknown[],
  targets: { data: undefined } as { data: unknown; isError?: boolean; refetch?: () => void },
  targetsInputs: [] as unknown[],
  saves: [] as unknown[],
  savePending: false,
  startChanges: [] as unknown[],
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
        get: {
          useQuery: (input: unknown) => {
            mocks.targetsInputs.push(input);
            return mocks.targets;
          },
        },
        save: {
          useMutation: (options: { onSuccess?: () => void } = {}) => ({
            isPending: mocks.savePending,
            mutate: (input: unknown, call: { onSuccess?: () => void } = {}) => {
              mocks.saves.push(input);
              options.onSuccess?.();
              call.onSuccess?.();
            },
          }),
        },
        setFiscalYearStart: {
          useMutation: (options: { onSuccess?: () => void } = {}) => ({
            isPending: false,
            mutate: (input: unknown, call: { onSuccess?: () => void } = {}) => {
              mocks.startChanges.push(input);
              options.onSuccess?.();
              call.onSuccess?.();
            },
          }),
        },
      },
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
    usePathname: () => '/ja/forecast',
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
    {
      ...forecastRow(figures, 10_000_000),
      ownerUserId: REP,
      ownerName: '営業 花子',
      targetHidden: false,
    },
    {
      ...forecastRow({ ...figures, won: 0, noAmountCount: 0 }, null),
      ownerUserId: null,
      ownerName: null,
      targetHidden: false,
    },
  ],
  total: forecastRow({ ...figures, won: 2_000_000 }, 10_000_000),
  overdue: { count: 2, amount: 600_000 },
  undated: { count: 3, amount: 900_000 },
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
  viewerUserId: REP,
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
  mocks.savePending = false;
  mocks.startChanges = [];
  mocks.search = '';
  mocks.targets = { data: undefined };
  mocks.targetsInputs = [];
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
    expect(screen.getByText(/2026\/10\/01〜2026\/12\/31 · 期の始まり：4月/)).toBeInTheDocument();
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

  it('points at overdue, undated and unpriced deals', () => {
    renderWithIntl(<ForecastScreen />);
    expect(screen.getByText(/期間より前のまま開いている商談が2件/)).toBeInTheDocument();
    expect(screen.getByText(/受注予定日が未定のまま開いている商談が3件/)).toHaveTextContent(
      '予測には入っていません'
    );
    expect(screen.getByText('金額が未定の商談が1件あります')).toBeInTheDocument();
    // The list is in order of the expected close date, the oldest first
    expect(screen.getByRole('link', { name: '受注予定日の早い順の一覧を開く' })).toHaveAttribute(
      'href',
      '/ja/deals?view=list'
    );
    expect(screen.getByRole('link', { name: '商談の一覧を開く' })).toHaveAttribute(
      'href',
      '/ja/deals?view=list'
    );
  });

  it('leaves out the notes when every open deal is dated and priced', () => {
    mocks.forecast.data = forecastData({
      overdue: { count: 0, amount: 0 },
      undated: { count: 0, amount: 0 },
      total: forecastRow({ ...figures, noAmountCount: 0 }, 10_000_000),
    });
    renderWithIntl(<ForecastScreen />);
    expect(screen.queryByText(/受注予定日が未定/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '商談の一覧を開く' })).not.toBeInTheDocument();
  });

  it("lists the week's changes with the stage moves", () => {
    renderWithIntl(<ForecastScreen />);
    expect(screen.getByText(/開いている商談の金額の増減 \+/)).toBeInTheDocument();
    expect(screen.getByText('前進')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'AS/400 移行' })).toHaveAttribute('href', '/ja/deals/deal-1');
    // The stage move and the amount before and after, in a small group opened from the start
    const line = screen.getByText(
      (_, element) =>
        element?.tagName === 'P' &&
        /^提案 → 条件の調整 · [￥¥]1,000,000 → [￥¥]1,500,000$/.test(element.textContent ?? '')
    );
    expect(line).toBeVisible();
    expect(screen.queryByText('失注')).not.toBeInTheDocument();
  });

  it('offers the targets only to those who may set them', () => {
    mocks.forecast.data = forecastData({ canEditTargets: false });
    renderWithIntl(<ForecastScreen />);
    expect(screen.queryByRole('button', { name: '目標を設定' })).not.toBeInTheDocument();
  });

  it("marks the other reps' targets as hidden for a rep and says why", () => {
    mocks.forecast.data = forecastData({
      canEditTargets: false,
      owners: [
        {
          ...forecastRow(figures, null),
          ownerUserId: 'rep-2',
          ownerName: '営業 次郎',
          targetHidden: true,
        },
      ],
    });
    renderWithIntl(<ForecastScreen />);
    const table = screen.getByRole('table', { name: '担当者ごとの予測' });
    const other = within(table).getByRole('row', { name: /営業 次郎/ });
    expect(within(other).getAllByText('非公開')).toHaveLength(3);
    expect(
      screen.getByText(
        '担当者ごとの目標・達成率・目標との差は、目標を設定する人と本人の分だけを表示します'
      )
    ).toBeInTheDocument();
  });

  it("tells a parent organization's viewer the forecast is not theirs to see", () => {
    mocks.forecast = {
      data: undefined,
      isError: true,
      error: { data: { code: 'FORBIDDEN' } },
      isPlaceholderData: false,
      refetch: vi.fn(),
    } as typeof mocks.forecast;
    renderWithIntl(<ForecastScreen />);
    expect(screen.getByText('売上予測を見る権限がありません')).toBeInTheDocument();
    // Nothing to switch for those who cannot see it
    expect(screen.queryByRole('radio', { name: '今期' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '再読み込み' })).not.toBeInTheDocument();
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

describe('ForecastScreen (#721)', () => {
  it('orders the owner columns by the target, then what is open, and links each owner to their deals', () => {
    renderWithIntl(<ForecastScreen />);
    const table = screen.getByRole('table', { name: '担当者ごとの予測' });
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      '担当',
      '目標',
      '受注済み',
      '達成率',
      '見込み（受注＋コミット）',
      '見込みと目標の差',
      'ベストケース',
      'パイプライン',
      '加重',
    ]);
    const own = within(table).getByRole('row', { name: /営業 花子/ });
    expect(within(own).getByRole('link', { name: '営業 花子' })).toHaveAttribute(
      'href',
      `/ja/deals?owner=${REP}`
    );
    expect(own).toHaveTextContent('（自分）');
    expect(screen.getByText('加重金額（開いている商談）')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '担当者ごと' })).toBeInTheDocument();
  });

  it('says in the table how far a forecast is above its target', () => {
    mocks.forecast.data = forecastData({
      owners: [
        {
          ...forecastRow({ ...figures, won: 9_000_000 }, 10_000_000),
          ownerUserId: REP,
          ownerName: '営業 花子',
          targetHidden: false,
        },
      ],
    });
    renderWithIntl(<ForecastScreen />);
    const row = within(screen.getByRole('table', { name: '担当者ごとの予測' })).getByRole('row', {
      name: /営業 花子/,
    });
    expect(row).toHaveTextContent(/\+[￥¥]2,000,000 上回る/);
  });

  it('explains a missing target to those who set targets, and who sets them to the others', async () => {
    const user = userEvent.setup();
    mocks.forecast.data = forecastData({ total: forecastRow(figures, null) });
    mocks.targets = { data: undefined };
    const { unmount } = renderWithIntl(<ForecastScreen />);
    expect(screen.getByText('目標が未設定です。')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: '目標を設定' });
    expect(buttons).toHaveLength(2);
    await user.click(buttons[1]);
    expect(screen.getByRole('dialog', { name: '目標を設定' })).toBeInTheDocument();
    unmount();

    mocks.forecast.data = forecastData({ total: forecastRow(figures, null), canEditTargets: false });
    renderWithIntl(<ForecastScreen />);
    expect(screen.getByText('目標を変更できるのはオーナーと管理者です')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '目標を設定' })).not.toBeInTheDocument();
  });

  it('says how many more deals changed, and opens only the small groups', () => {
    const deal = (index: number) => ({
      id: `deal-${index}`,
      name: `新規の商談 ${index}`,
      ownerName: '営業 花子',
      stage: 'qualification',
      amount: null,
      expectedCloseOn: null,
      before: null,
    });
    mocks.forecast.data = forecastData({
      changes: {
        groups: {
          ...emptyGroups,
          created: {
            count: 25,
            amount: 0,
            deals: Array.from({ length: 20 }, (_, index) => deal(index)),
          },
          won: { count: 1, amount: 500_000, deals: [{ ...deal(99), stage: 'won', amount: 500_000 }] },
        },
        amountDelta: 0,
      },
    });
    renderWithIntl(<ForecastScreen />);

    expect(screen.getByText(/ほか5件/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '商談のボードで見る' })).toHaveAttribute('href', '/ja/deals');
    const created = screen.getByText('新しい商談').closest('details');
    const won = screen.getByText('受注', { selector: 'summary' }).closest('details');
    expect(created).not.toHaveAttribute('open');
    expect(won).toHaveAttribute('open');
    expect(screen.getAllByText(/金額未定/).length).toBeGreaterThan(0);
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
    await user.click(screen.getByRole('option', { name: '2026年10月' }));
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

  it('asks before switching the month or the year drops the boxes typed in', async () => {
    const user = userEvent.setup();
    mocks.targets = { data: targetsData };
    renderWithIntl(<TargetsDialog open onOpenChange={vi.fn()} organizationId={ORG_ID} />);
    // Nothing typed yet: no question
    await pickOctober(user);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    const rep = screen.getByLabelText('営業 花子');
    await user.clear(rep);
    await user.type(rep, '9000000');

    const pickNovember = async () => {
      await user.click(screen.getByRole('combobox', { name: '月' }));
      await user.click(screen.getByRole('option', { name: '2026年11月' }));
      return screen.findByRole('alertdialog', { name: '保存していない入力があります' });
    };
    let ask = await pickNovember();
    expect(ask).toHaveTextContent('切り替えると、この月の入力は消えます。');
    await user.click(within(ask).getByRole('button', { name: 'キャンセル' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByRole('combobox', { name: '月' })).toHaveTextContent('2026年10月');
    expect(screen.getByLabelText('営業 花子')).toHaveValue('9000000');

    ask = await pickNovember();
    await user.click(within(ask).getByRole('button', { name: '切り替える' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByRole('combobox', { name: '月' })).toHaveTextContent('2026年11月');
    expect(screen.getByLabelText('営業 花子')).toHaveValue('');

    await user.type(screen.getByLabelText('組織全体'), '1000');
    await user.click(screen.getByRole('combobox', { name: '年度' }));
    await user.click(screen.getByRole('option', { name: /^2027年度/ }));
    ask = await screen.findByRole('alertdialog', { name: '保存していない入力があります' });
    await user.click(within(ask).getByRole('button', { name: '切り替える' }));
    expect(mocks.targetsInputs.at(-1)).toEqual({ organizationId: ORG_ID, fiscalYear: 2027 });
    expect(mocks.saves).toEqual([]);
  });

  it('changes the fiscal year start of the organization only after asking, keeping the boxes', async () => {
    const user = userEvent.setup();
    mocks.targets = { data: targetsData };
    renderWithIntl(<TargetsDialog open onOpenChange={vi.fn()} organizationId={ORG_ID} />);
    await pickOctober(user);
    await user.type(screen.getByLabelText('組織全体'), '20000000');
    // Apart from the year and month of the targets, as the organization's setting
    const settings = screen.getByRole('region', { name: '組織の設定' });
    const start = within(settings).getByRole('combobox', { name: '期の始まり' });
    expect(start).toHaveAccessibleDescription(/組織全体の設定です/);
    const pickJanuary = async () => {
      await user.click(start);
      await user.click(screen.getByRole('option', { name: '1月' }));
      return screen.findByRole('alertdialog', { name: '1月始まりに変えますか？' });
    };

    let ask = await pickJanuary();
    expect(ask).toHaveTextContent('四半期と今期の範囲が組織全体で変わります。');
    await user.click(within(ask).getByRole('button', { name: 'キャンセル' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(mocks.startChanges).toEqual([]);
    expect(start).toHaveTextContent('4月');

    // What the server returns once the year starts in January
    mocks.targets = {
      data: {
        ...targetsData,
        fiscalYearStartMonth: 1,
        months: Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}-01`),
      },
    };
    ask = await pickJanuary();
    await user.click(within(ask).getByRole('button', { name: '変更する' }));
    expect(mocks.startChanges).toEqual([{ organizationId: ORG_ID, month: 1 }]);
    expect(mocks.toast.success).toHaveBeenCalledWith('期の始まりを変更しました');
    // The month being edited stays, in its fiscal year from January, with what was typed
    expect(mocks.targetsInputs.at(-1)).toEqual({ organizationId: ORG_ID, fiscalYear: 2026 });
    expect(screen.getByRole('combobox', { name: '月' })).toHaveTextContent('2026年10月');
    expect(screen.getByLabelText('組織全体')).toHaveValue('20000000');
    expect(mocks.saves).toEqual([]);
  });

  it('says when the targets cannot be read and reads them again', async () => {
    const user = userEvent.setup();
    mocks.targets = { data: undefined, isError: true, refetch: vi.fn() };
    renderWithIntl(<TargetsDialog open onOpenChange={vi.fn()} organizationId={ORG_ID} />);
    expect(screen.getByRole('alert')).toHaveTextContent('目標を読み込めませんでした');
    await user.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(mocks.targets.refetch).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
  });

  it('saves and shows the month after, keeping the dialog open (#721)', async () => {
    const user = userEvent.setup();
    mocks.targets = { data: targetsData };
    const onOpenChange = vi.fn();
    renderWithIntl(<TargetsDialog open onOpenChange={onOpenChange} organizationId={ORG_ID} />);
    await pickOctober(user);
    await user.type(screen.getByLabelText('組織全体'), '20000000');
    await user.click(screen.getByRole('button', { name: '保存して次の月へ' }));

    expect(mocks.saves).toEqual([
      {
        organizationId: ORG_ID,
        entries: [{ userId: null, month: '2026-10-01', amount: 20_000_000 }],
      },
    ]);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole('combobox', { name: '月' })).toHaveTextContent('2026年11月');
    // Nothing typed in November: the next month comes without a call
    await user.click(screen.getByRole('button', { name: '保存して次の月へ' }));
    expect(mocks.saves).toHaveLength(1);
    expect(screen.getByRole('combobox', { name: '月' })).toHaveTextContent('2026年12月');
  });

  it("adds up the members' targets under the organization's box (#721)", async () => {
    const user = userEvent.setup();
    mocks.targets = { data: targetsData };
    renderWithIntl(<TargetsDialog open onOpenChange={vi.fn()} organizationId={ORG_ID} />);
    await pickOctober(user);
    expect(screen.getByText(/（担当者の合計 [￥¥]8,000,000）/)).toBeInTheDocument();
    await user.clear(screen.getByLabelText('営業 花子'));
    await user.type(screen.getByLabelText('営業 花子'), '9000000');
    expect(screen.getByText(/（担当者の合計 [￥¥]9,000,000）/)).toBeInTheDocument();
  });

  it('moves the focus to the first box that cannot be saved (#721)', async () => {
    const user = userEvent.setup();
    mocks.targets = { data: targetsData };
    renderWithIntl(<TargetsDialog open onOpenChange={vi.fn()} organizationId={ORG_ID} />);
    await pickOctober(user);
    await user.type(screen.getByLabelText('組織全体'), '1.5');
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByLabelText('組織全体')).toHaveFocus();
    expect(mocks.saves).toEqual([]);
  });

  it('says the targets are being saved', () => {
    mocks.targets = { data: targetsData };
    mocks.savePending = true;
    renderWithIntl(<TargetsDialog open onOpenChange={vi.fn()} organizationId={ORG_ID} />);
    expect(screen.getByRole('button', { name: '保存しています…' })).toBeDisabled();
  });
});
