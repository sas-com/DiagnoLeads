/**
 * The marketing room of the full-screen office (#1127, the marketer's room since #1200): entering
 * it from the floor, the room's figures and who reads them, the boards of figures (sources and
 * progress), the lead board with its views, pages and states, the keys, and the customer file
 * that opens inside the room and records a contact (#1128).
 * Real next-intl messages; tRPC mocked.
 */
import { OfficeImmersive } from '@/components/features/ai-employees/office-immersive';
import { LEAD_BOARD_PAGE_SIZE } from '@/components/features/ai-employees/office-rooms';
import { DEFAULT_AI_EMPLOYEE_PROFILE } from '@/lib/features/ai-employees/types/profile';
import {
  type AcquisitionCostSummary,
  type ConversionFunnelData,
  type DealReturns,
  FUNNEL_STAGES,
} from '@/lib/features/analytics/types/schemas';
import { MESSAGE_FILES, mergeMessageFiles } from '@/lib/i18n/messages';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';

interface ListInput {
  organizationId: string;
  limit: number;
  offset: number;
  status?: string[];
  consultationRequested?: boolean;
  createdFromDay?: string;
  assignee?: string;
}

const lead = (n: number, status = 'new') => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  name: `見本 ${n}郎`,
  company: `見本商事${n}`,
  status,
  mqlLevel: n === 1 ? ('interest' as const) : null,
  assignee: n === 2 ? { id: 'u', name: '山田 太郎', email: 'x' } : null,
  createdAt: new Date('2026-11-10T00:00:00Z'),
});

interface ContactRecord {
  id: string;
  leadId: string;
  kind: 'call' | 'email' | 'no_answer';
  note: string | null;
  contactedAt: Date;
  durationMinutes: number | null;
  outcome: null;
  createdBy: { id: string; name: string } | null;
}

const mocks = vi.hoisted(() => ({
  inputs: [] as unknown[],
  /** The inputs of the analytics queries of the room */
  figureInputs: [] as unknown[],
  /** What leads.list and the analytics answer: 'ok', 'forbidden', 'error' or 'loading' */
  mode: 'ok' as 'ok' | 'forbidden' | 'error' | 'loading',
  /** The period has no prospects at all */
  noProspects: false,
  /** The member may read deals: the API answers with what the deals brought in */
  withDeals: false,
  /** The contact records of the open lead, newest first */
  records: [] as ContactRecord[],
  recorded: [] as { organizationId: string; leadId: string; kind: string }[],
  deleted: [] as { organizationId: string; id: string }[],
  canEdit: true,
  failRecord: false,
  failDelete: false,
  contactsFail: false,
  refreshed: vi.fn(),
}));

/** 12 leads in all; 3 are new, none asked for a consultation, 5 came this week */
function answer(input: ListInput) {
  const all = Array.from({ length: 12 }, (_, i) => lead(i + 1, i < 3 ? 'new' : 'negotiating'));
  let rows = all;
  if (input.status?.includes('new')) rows = all.filter((row) => row.status === 'new');
  if (input.consultationRequested) rows = [];
  if (input.createdFromDay) rows = all.slice(0, 5);
  if (input.assignee === 'me') rows = all.slice(1, 2);
  return {
    items: rows.slice(input.offset, input.offset + input.limit),
    total: rows.length,
    limit: input.limit,
    offset: input.offset,
  };
}

const RETURNS: DealReturns = {
  dealCount: 3,
  wonDealCount: 1,
  wonAmount: 3_000_000,
  costPerWonDeal: 150_000,
  roi: 20,
  medianDaysToWin: 21,
};

/** 20 prospects of the period: 8 reached MQL, 3 a deal, 2 SQL, 1 was won; 2 are nurtured */
function funnelAnswer(): ConversionFunnelData {
  const reached = mocks.noProspects ? [0, 0, 0, 0, 0] : [20, 8, 3, 2, 1];
  const rate = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 10000) / 100 : 0);
  return {
    stages: FUNNEL_STAGES.map((name, index) => ({
      name,
      count: reached[index] - (reached[index + 1] ?? 0),
      cumulativeCount: reached[index],
      percentage: index === 0 ? 100 : rate(reached[index], reached[0]),
      conversionRate: index === 0 ? 100 : rate(reached[index], reached[index - 1]),
    })),
    totalLeads: reached[0],
    nurturingCount: mocks.noProspects ? 0 : 2,
    overallConversionRate: rate(reached[4], reached[0]),
    averageConversionDays: 0,
  };
}

/** The same 20 prospects by source: 12 from seminars, 5 from advertising, 3 without a source */
function costAnswer(): AcquisitionCostSummary {
  const deals = mocks.withDeals ? RETURNS : null;
  const source = (
    name: string,
    leadCount: number,
    costedLeadCount: number,
    sqlCount: number,
    wonCount: number,
    totalCost: number
  ) => ({
    source: name,
    leadCount,
    costedLeadCount,
    sqlCount,
    wonCount,
    totalCost,
    costPerSql: null,
    costPerWon: null,
    deals: mocks.withDeals ? (name === 'seminar' ? RETURNS : { ...RETURNS, wonAmount: 0, roi: null }) : null,
  });
  const bySource = mocks.noProspects
    ? []
    : [
        source('seminar', 12, 10, 2, 1, 150_000),
        source('advertising', 5, 5, 0, 0, 80_000),
        source('unset', 3, 0, 0, 0, 0),
      ];
  return {
    leadCount: mocks.noProspects ? 0 : 20,
    costedLeadCount: mocks.noProspects ? 0 : 15,
    sqlCount: mocks.noProspects ? 0 : 2,
    wonCount: mocks.noProspects ? 0 : 1,
    totalCost: mocks.noProspects ? 0 : 230_000,
    costPerSql: null,
    costPerWon: null,
    deals,
    bySource,
  };
}

/** A query of the analytics API in the state the test asks for */
function figureQuery<T>(input: unknown, answer: () => T) {
  mocks.figureInputs.push(input);
  if (mocks.mode === 'loading') return { data: undefined, error: null, isError: false };
  if (mocks.mode !== 'ok') {
    return {
      data: undefined,
      error: { data: { code: mocks.mode === 'forbidden' ? 'FORBIDDEN' : 'INTERNAL' } },
      isError: true,
    };
  }
  return { data: answer(), error: null, isError: false };
}

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    analytics: {
      getConversionFunnel: { useQuery: (input: unknown) => figureQuery(input, funnelAnswer) },
      getAcquisitionCost: { useQuery: (input: unknown) => figureQuery(input, costAnswer) },
    },
    useUtils: () => ({
      aiEmployees: { office: { invalidate: vi.fn() } },
      leadFollowUp: { contacts: { invalidate: mocks.refreshed } },
      leadActivity: {
        list: { invalidate: vi.fn() },
        forDeal: { invalidate: vi.fn() },
        myDay: { invalidate: vi.fn() },
      },
      analytics: { getDashboard: { invalidate: vi.fn() } },
    }),
    leadFollowUp: {
      contacts: {
        useQuery: () =>
          mocks.contactsFail
            ? { data: undefined, isError: true }
            : {
                data: {
                  firstContactAt: mocks.records.at(-1)?.contactedAt ?? null,
                  total: mocks.records.length,
                  noAnswerCount: mocks.records.filter((r) => r.kind === 'no_answer').length,
                  recent: mocks.records,
                  canEdit: mocks.canEdit,
                },
                isError: false,
              },
      },
      recordContact: {
        useMutation: (
          options: {
            onSuccess?: (saved: ContactRecord, input: { kind: string }) => void;
            onError?: () => void;
          } = {}
        ) => ({
          isPending: false,
          mutate: (input: { organizationId: string; leadId: string; kind: ContactRecord['kind'] }) => {
            if (mocks.failRecord) {
              options.onError?.();
              return;
            }
            const saved: ContactRecord = {
              id: `contact-${mocks.recorded.length + 1}`,
              leadId: input.leadId,
              kind: input.kind,
              note: null,
              contactedAt: new Date('2026-11-13T02:00:00Z'),
              durationMinutes: null,
              outcome: null,
              createdBy: { id: 'u', name: '山田 太郎' },
            };
            mocks.recorded.push(input);
            mocks.records.unshift(saved);
            options.onSuccess?.(saved, input);
          },
        }),
      },
      deleteContact: {
        useMutation: (options: { onSuccess?: () => void; onError?: () => void } = {}) => ({
          isPending: false,
          mutate: (input: { organizationId: string; id: string }) => {
            if (mocks.failDelete) {
              options.onError?.();
              return;
            }
            mocks.deleted.push(input);
            mocks.records = mocks.records.filter((r) => r.id !== input.id);
            options.onSuccess?.();
          },
        }),
      },
    },
    aiEmployees: {
      hire: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
      update: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
    },
    leads: {
      list: {
        useQuery: (input: ListInput) => {
          mocks.inputs.push(input);
          if (mocks.mode === 'loading') {
            return { data: undefined, error: null, isError: false, isFetching: true };
          }
          if (mocks.mode !== 'ok') {
            return {
              data: undefined,
              error: { data: { code: mocks.mode === 'forbidden' ? 'FORBIDDEN' : 'INTERNAL' } },
              isError: true,
              isFetching: false,
            };
          }
          return { data: answer(input), error: null, isError: false, isFetching: false };
        },
      },
    },
  },
}));

const messages = mergeMessageFiles(MESSAGE_FILES.ja);

const marketer = (deskStatus: 'training' | 'idle' | 'paused') => ({
  id: '770e8400-e29b-41d4-a716-446655440001',
  role: 'marketer' as const,
  name: 'AIマーケター',
  status: deskStatus === 'paused' ? ('paused' as const) : ('active' as const),
  createdAt: new Date('2026-11-01T00:00:00Z'),
  deskStatus,
  lastRun: null,
  processedToday: 0,
  profile: DEFAULT_AI_EMPLOYEE_PROFILE,
});

/** Enters the room: the source board is on the wall */
async function enterMarketing(employees: ReturnType<typeof marketer>[] = []) {
  const user = userEvent.setup();
  const onExit = vi.fn();
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <OfficeImmersive
        organizationId={ORG_ID}
        companyName="テスト商事"
        presidentName="山田 太郎"
        employees={employees}
        canManage
        onExit={onExit}
      />
    </NextIntlClientProvider>
  );
  const office = screen.getByRole('dialog', { name: 'AI社員オフィス（全画面）' });
  await user.click(within(office).getByRole('button', { name: /^出社する/ }));
  await user.keyboard('2');
  return { user, office, onExit };
}

/** Enters the room and asks for the lead board: what nobody has started on yet (key 3) */
async function enterRoom(employees: ReturnType<typeof marketer>[] = []) {
  const room = await enterMarketing(employees);
  await room.user.keyboard('3');
  const board = within(room.office).getByRole('region', { name: '見込み客ボード' });
  return { ...room, board };
}

function reset() {
  mocks.inputs.length = 0;
  mocks.figureInputs.length = 0;
  mocks.mode = 'ok';
  mocks.noProspects = false;
  mocks.withDeals = false;
  mocks.records = [];
  mocks.recorded.length = 0;
  mocks.deleted.length = 0;
  mocks.canEdit = true;
  mocks.failRecord = false;
  mocks.failDelete = false;
  mocks.contactsFail = false;
  mocks.refreshed.mockClear();
}

describe('the marketing room', () => {
  beforeEach(reset);

  it('is entered from the floor guide, and left with Esc', async () => {
    const user = userEvent.setup();
    render(
      <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
        <OfficeImmersive
          organizationId={ORG_ID}
          companyName={null}
          presidentName={null}
          employees={[]}
          canManage
          onExit={vi.fn()}
        />
      </NextIntlClientProvider>
    );
    const office = screen.getByRole('dialog', { name: 'AI社員オフィス（全画面）' });
    await user.click(within(office).getByRole('button', { name: /^出社する/ }));
    const guide = within(office).getByRole('navigation', { name: 'フロア案内' });
    await user.click(within(guide).getByRole('button', { name: /マーケティング室.*リード管理/ }));

    expect(within(office).getByRole('heading', { name: 'リード管理' })).toBeInTheDocument();
    expect(within(office).getByRole('region', { name: '流入元ボード' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(within(office).queryByRole('region', { name: '流入元ボード' })).not.toBeInTheDocument();
    expect(within(office).getByRole('navigation', { name: 'フロア案内' })).toBeInTheDocument();
  });

  it('asks only for the leads and the figures of the organization', async () => {
    await enterRoom();
    expect(mocks.inputs.length).toBeGreaterThan(0);
    for (const input of mocks.inputs) {
      expect((input as ListInput).organizationId).toBe(ORG_ID);
    }
    // The figures: the last 30 days of this organization, from the two analytics queries
    expect(mocks.figureInputs.length).toBeGreaterThan(0);
    for (const input of mocks.figureInputs) {
      expect(input).toEqual({ organizationId: ORG_ID, dateRange: '30d' });
    }
  });

  it('asks leads.list for nothing until the lead board is asked for', async () => {
    await enterMarketing();
    expect(mocks.inputs).toHaveLength(0);
  });

  it('reads the real figures of the last 30 days, and says that the seat is vacant', async () => {
    const { office } = await enterMarketing();
    expect(
      within(office).getByText(
        '過去30日の新しい見込み客は 20 件です。関心あり（MQL）以上に進んだのは 8 件、商談に進んだのは 3 件です。いちばん多い流入元は「勉強会・セミナー」の 12 件です。流入元の記録が無いものが 3 件あります。'
      )
    ).toBeInTheDocument();
    expect(
      within(office).getByText('マーケターは空席です。数字は記録から読み上げています。')
    ).toBeInTheDocument();
  });

  it('does not put a report in the mouth of an AI employee in training or paused', async () => {
    const training = await enterRoom([marketer('training')]);
    expect(
      within(training.office).getByText(
        'AIマーケターは研修中で、まだこの部屋の仕事を受け持っていません。数字は記録から読み上げています。'
      )
    ).toBeInTheDocument();
    expect(within(training.office).queryByText(/受け持っています。$/)).not.toBeInTheDocument();
  });

  it('names the AI employee that holds the room once it works', async () => {
    const { office } = await enterRoom([marketer('idle')]);
    expect(
      within(office).getByText('AIマーケターが、この部屋を受け持っています。')
    ).toBeInTheDocument();
  });

  it('says that the period has no prospects, without figures of its own', async () => {
    mocks.noProspects = true;
    const { office } = await enterMarketing();
    expect(within(office).getByText('過去30日は、新しい見込み客がいません。')).toBeInTheDocument();
    expect(
      within(within(office).getByRole('region', { name: '流入元ボード' })).getByText(
        '過去30日に登録された見込み客はいません。'
      )
    ).toBeInTheDocument();
    expect(within(office).queryByRole('table')).not.toBeInTheDocument();
  });

  it('opens on where the prospects came from, the focus on the report', async () => {
    const { office } = await enterMarketing();
    const board = within(office).getByRole('region', { name: '流入元ボード' });
    expect(within(board).getByText('過去30日に登録された見込み客・20 件')).toBeInTheDocument();
    expect(within(office).getByRole('button', { name: /どこから来たかを見せて/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    // Enter pressed once too often opens nothing: the focus is on the report
    expect(document.activeElement?.textContent).toContain('過去30日の新しい見込み客');
  });

  it('shows each source with its prospects, share, SQL, wins and cost, and the total', async () => {
    const { office } = await enterMarketing();
    const board = within(office).getByRole('region', { name: '流入元ボード' });
    const cells = (name: string) =>
      within(within(board).getByRole('row', { name: new RegExp(`^${name}`) }))
        .getAllByRole('cell')
        .map((cell) => cell.textContent);
    expect(cells('勉強会・セミナー')).toEqual(['12', '60%', '2', '1', '￥150,000']);
    expect(cells('広告')).toEqual(['5', '25%', '0', '0', '￥80,000']);
    // Prospects without a recorded source are shown as such, last
    expect(cells('流入元の記録なし')).toEqual(['3', '15%', '0', '0', '￥0']);
    expect(cells('合計')).toEqual(['20', '100%', '2', '1', '￥230,000']);
    expect(
      within(board).getByText(
        '獲得費用は、見込み客に記録した金額（税抜）の合計です。5 件は費用が未記録です。'
      )
    ).toBeInTheDocument();
  });

  it('shows the won amount and the ROI only to a member the API answers with them', async () => {
    const without = await enterMarketing();
    expect(
      within(without.office).queryByRole('columnheader', { name: 'ROI' })
    ).not.toBeInTheDocument();
    expect(within(without.office).queryByText(/受注額と ROI は/)).not.toBeInTheDocument();
    cleanup();

    mocks.withDeals = true;
    const { office } = await enterMarketing();
    const board = within(office).getByRole('region', { name: '流入元ボード' });
    expect(within(board).getByRole('columnheader', { name: '受注額' })).toBeInTheDocument();
    const seminar = within(board).getByRole('row', { name: /^勉強会・セミナー/ });
    expect(within(seminar).getByText('￥3,000,000')).toBeInTheDocument();
    expect(within(seminar).getByText('20 倍')).toBeInTheDocument();
    // Nothing spent on the source: no ROI, said with a dash and not with a zero
    const advertising = within(board).getByRole('row', { name: /^広告/ });
    expect(within(advertising).getAllByRole('cell').at(-1)).toHaveTextContent('—');
  });

  it('shows how far the prospects got, a row per stage, with the key 2', async () => {
    const { user, office } = await enterMarketing();
    await user.keyboard('2');
    const board = within(office).getByRole('region', { name: '進み具合ボード' });
    expect(within(office).queryByRole('region', { name: '流入元ボード' })).not.toBeInTheDocument();
    const cells = (name: string) =>
      within(within(board).getByRole('row', { name: new RegExp(`^${name}`) }))
        .getAllByRole('cell')
        .map((cell) => cell.textContent);
    expect(cells('見込み客')).toEqual(['20', '100%', '—']);
    expect(cells('MQL（関心あり）')).toEqual(['8', '40%', '40%']);
    expect(cells('商談')).toEqual(['3', '15%', '38%']);
    expect(cells('SQL（適格）')).toEqual(['2', '10%', '67%']);
    expect(cells('受注')).toEqual(['1', '5%', '50%']);
    expect(
      within(board).getByText('再育成（ナーチャリング）中の見込み客は 2 件です（段には数えません）。')
    ).toBeInTheDocument();
    expect(within(office).getByRole('button', { name: /どこまで進んだかを見せて/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('links the boards of figures to the analytics page of the normal view, and closes the office', async () => {
    const { user, office, onExit } = await enterMarketing();
    const link = within(office).getByRole('link', { name: '通常の表示の分析で開く' });
    expect(link).toHaveAttribute('href', '/ja/analytics');
    link.addEventListener('click', (event) => event.preventDefault());
    await user.click(link);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('says which board is on the wall from the panel that stays, at every change', async () => {
    const { user, office } = await enterMarketing();
    const said = () =>
      within(office)
        .getAllByRole('status')
        .map((status) => status.textContent)
        .filter((text) => text?.startsWith('壁のボード'));
    expect(said()).toEqual(['壁のボード：流入元ボード']);
    await user.keyboard('2');
    expect(said()).toEqual(['壁のボード：進み具合ボード']);
    await user.keyboard('5');
    expect(said()).toEqual(['壁のボード：見込み客ボード']);
  });

  it('names the scrolling table of a board of figures, and the group of lead views', async () => {
    const { office } = await enterMarketing();
    expect(
      within(office).getByRole('group', {
        name: '流入元ボードの表。矢印キーでスクロールできます',
      })
    ).toHaveAttribute('tabindex', '0');
    const views = within(office).getByRole('group', { name: '見込み客を見せて' });
    expect(within(views).getAllByRole('button')).toHaveLength(5);
  });

  it('takes the focus back to the report when the board that holds it leaves the wall', async () => {
    const { user, office, board } = await enterRoom();
    await user.keyboard('{ArrowDown}');
    expect(within(board).getAllByRole('button', { name: /見本商事/ })[0]).toHaveFocus();
    await user.keyboard('1');
    expect(within(office).getByRole('region', { name: '流入元ボード' })).toBeInTheDocument();
    expect(document.activeElement?.textContent).toContain('過去30日の新しい見込み客');
    // The keys of the room go on working from there
    await user.keyboard('2');
    expect(within(office).getByRole('region', { name: '進み具合ボード' })).toBeInTheDocument();
  });

  it('says how many prospects have no source recorded only when there are some', async () => {
    const { office } = await enterMarketing();
    expect(within(office).getByText(/流入元の記録が無いものが 3 件あります。$/)).toBeInTheDocument();
  });

  it('keeps the meaning of every number key whichever board is on the wall', async () => {
    const { user, office } = await enterMarketing();
    const pressed = () =>
      within(office)
        .getAllByRole('button', { pressed: true })
        .map((button) => button.textContent);
    for (const [key, label] of [
      ['7', '7すべて'],
      ['2', '2どこまで進んだかを見せて'],
      ['5', '5今週の新規'],
      ['1', '1どこから来たかを見せて'],
      ['3', '3未着手'],
      ['4', '4相談の申込'],
      ['6', '6自分の担当'],
    ]) {
      await user.keyboard(key);
      expect(pressed()).toEqual([label]);
    }
    // No other number chooses anything
    await user.keyboard('8');
    await user.keyboard('9');
    expect(pressed()).toEqual(['6自分の担当']);
  });

  it('opens the lead board on what nobody has started on with the key 3', async () => {
    const { office, board } = await enterRoom();
    expect(within(board).getByText(/まだ着手していない（新規）・3 件/)).toBeInTheDocument();
    expect(within(board).getAllByRole('button', { name: /見本商事/ })).toHaveLength(3);
    expect(within(office).getByRole('button', { name: /未着手/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    // The focus stays on the report: Enter pressed once too often opens no row
    expect(document.activeElement?.textContent).toContain('過去30日の新しい見込み客');
  });

  it('switches the view with a choice or its number key', async () => {
    const { user, office, board } = await enterRoom();
    await user.click(within(office).getByRole('button', { name: /すべて/ }));
    expect(within(board).getByText(/すべて・12 件/)).toBeInTheDocument();
    expect(within(board).getAllByRole('button', { name: /見本商事/ })).toHaveLength(
      LEAD_BOARD_PAGE_SIZE
    );

    await user.keyboard('6');
    expect(within(board).getByText(/自分の担当・1 件/)).toBeInTheDocument();
    expect(within(board).getByText('山田 太郎')).toBeInTheDocument();
  });

  it('says so when a view holds no leads', async () => {
    const { user, board } = await enterRoom();
    await user.keyboard('4');
    expect(within(board).getByText('この絞り込みに当たる見込み客はいません。')).toBeInTheDocument();
  });

  it('turns the pages with the buttons and the arrow keys, and goes back to the first on a new view', async () => {
    const { user, board } = await enterRoom();
    await user.keyboard('7');
    expect(within(board).getByText('12 件中 1〜8 件')).toBeInTheDocument();
    expect(within(board).getByRole('button', { name: /前へ/ })).toHaveAttribute(
      'aria-disabled',
      'true'
    );

    await user.click(within(board).getByRole('button', { name: /次へ/ }));
    expect(within(board).getByText('12 件中 9〜12 件')).toBeInTheDocument();
    expect(within(board).getAllByRole('button', { name: /見本商事/ })).toHaveLength(4);
    // The button keeps the focus at the last page, so the keys go on working
    expect(within(board).getByRole('button', { name: /次へ/ })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    expect(within(board).getByRole('button', { name: /次へ/ })).toHaveFocus();

    await user.keyboard('{ArrowLeft}');
    expect(within(board).getByText('12 件中 1〜8 件')).toBeInTheDocument();
    await user.keyboard('{ArrowRight}');
    await user.keyboard('3');
    expect(within(board).getByText('3 件中 1〜3 件')).toBeInTheDocument();
  });

  it('moves over the rows with the arrow keys', async () => {
    const { user, board } = await enterRoom();
    const rows = within(board).getAllByRole('button', { name: /見本商事/ });
    await user.keyboard('{ArrowDown}');
    expect(rows[0]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(rows[1]).toHaveFocus();
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(rows[0]).toHaveFocus();
  });

  it('shows the MQL level and the status of a row as words, not only colours', async () => {
    const { board } = await enterRoom();
    const row = within(board).getAllByRole('button', { name: /見本商事/ })[0];
    expect(within(row).getByText('関心あり（MQL）')).toBeInTheDocument();
    expect(within(row).getByText('新規')).toBeInTheDocument();
  });

  it('links to the same view of the list in the normal view', async () => {
    const { user, board } = await enterRoom();
    expect(within(board).getByRole('link', { name: '通常の表示の一覧で開く' })).toHaveAttribute(
      'href',
      '/ja/leads?status=new'
    );
    await user.keyboard('7');
    expect(within(board).getByRole('link', { name: '通常の表示の一覧で開く' })).toHaveAttribute(
      'href',
      '/ja/leads'
    );
  });

  it('tells a member without the permission so, instead of the board', async () => {
    mocks.mode = 'forbidden';
    const { office, board } = await enterRoom();
    expect(
      within(board).getByText('見込み客を見る権限がありません。管理者に確かめてください。')
    ).toBeInTheDocument();
    // The report says the same, not that reading failed
    expect(
      within(office).getAllByText('見込み客を見る権限がありません。管理者に確かめてください。')
    ).toHaveLength(2);
    expect(within(board).queryByRole('button', { name: /見本商事/ })).not.toBeInTheDocument();
  });

  it('tells a member without the permission so on the boards of figures too, with no figure', async () => {
    mocks.mode = 'forbidden';
    const { user, office } = await enterMarketing();
    for (const [key, name] of [
      ['1', '流入元ボード'],
      ['2', '進み具合ボード'],
    ]) {
      await user.keyboard(key);
      const board = within(office).getByRole('region', { name });
      expect(
        within(board).getByText('見込み客を見る権限がありません。管理者に確かめてください。')
      ).toBeInTheDocument();
      expect(within(board).queryByRole('table')).not.toBeInTheDocument();
    }
  });

  it('shows that it is loading, and that reading failed', async () => {
    mocks.mode = 'loading';
    const loading = await enterRoom();
    expect(within(loading.board).getByText('読み込んでいます')).toBeInTheDocument();
    expect(within(loading.office).getByText('この部屋の数字を読んでいます。')).toBeInTheDocument();
    await loading.user.keyboard('1');
    expect(
      within(within(loading.office).getByRole('region', { name: '流入元ボード' })).getByText(
        '読み込んでいます'
      )
    ).toBeInTheDocument();
  });

  it('says that reading failed', async () => {
    mocks.mode = 'error';
    const { user, office, board } = await enterRoom();
    expect(
      within(board).getByText('見込み客を読めませんでした。時間をおいて、もう一度開いてください。')
    ).toBeInTheDocument();
    expect(within(office).getByText('この部屋の数字を読めませんでした。')).toBeInTheDocument();
    await user.keyboard('2');
    expect(
      within(within(office).getByRole('region', { name: '進み具合ボード' })).getByText(
        '数字を読めませんでした。時間をおいて、もう一度開いてください。'
      )
    ).toBeInTheDocument();
  });

  it('leaves a key of a Japanese conversion (IME) alone: the board does not change', async () => {
    const { office } = await enterMarketing();
    fireEvent.keyDown(office, { key: '2', isComposing: true });
    fireEvent.keyDown(office, { key: '3', keyCode: 229 });
    expect(within(office).getByRole('region', { name: '流入元ボード' })).toBeInTheDocument();
  });
});

describe('the customer file in the room', () => {
  beforeEach(reset);

  async function openFile() {
    const room = await enterRoom();
    await room.user.keyboard('{ArrowDown}{Enter}');
    const file = within(room.office).getByRole('region', { name: '見本商事1のファイル' });
    return { ...room, file };
  }

  it('opens inside the room: the office stays open and the board gives way to the file', async () => {
    const { office, file, onExit } = await openFile();
    expect(onExit).not.toHaveBeenCalled();
    expect(within(office).queryByRole('region', { name: '見込み客ボード' })).not.toBeInTheDocument();
    expect(within(file).getByRole('heading', { name: /見本商事1.*見本 1郎/ })).toBeInTheDocument();
    expect(within(file).getByText('新規')).toBeInTheDocument();
    expect(within(file).getByText(/MQL段階：関心あり（MQL）/)).toBeInTheDocument();
    expect(within(file).getByText('まだ記録がありません。')).toBeInTheDocument();
    expect(
      within(office).getByText('この見込み客には、まだ連絡の記録がありません。')
    ).toBeInTheDocument();
    // The focus is on the report: Enter pressed once too often records nothing
    expect(document.activeElement?.textContent).toContain('まだ連絡の記録がありません');
    // Esc now closes the file, so only the file shows the key; the way to the floor is a button
    expect(within(office).getByRole('button', { name: 'フロアへ戻る' })).toBeInTheDocument();
    expect(within(office).getByRole('button', { name: /Esc.*ボードに戻る/ })).toBeInTheDocument();
  });

  it('goes back to the board with Esc, the focus on the row it came from, then to the floor', async () => {
    const { user, office } = await openFile();
    await user.keyboard('{Escape}');
    const board = within(office).getByRole('region', { name: '見込み客ボード' });
    expect(within(board).getAllByRole('button', { name: /見本商事/ })[0]).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(within(office).getByRole('navigation', { name: 'フロア案内' })).toBeInTheDocument();
  });

  it('records a contact with a choice, for this lead of this organization', async () => {
    const { user, office, file } = await openFile();
    await user.click(within(office).getByRole('button', { name: /メールした/ }));
    expect(mocks.recorded).toEqual([
      { organizationId: ORG_ID, leadId: '00000000-0000-4000-8000-000000000001', kind: 'email' },
    ]);
    expect(
      within(office).getByText('「メールした」を記録しました。間違えたときは、取り消せます。')
    ).toBeInTheDocument();
    // The record shows in the file, and what shows contacts elsewhere is refreshed
    expect(within(file).getByText('メールした')).toBeInTheDocument();
    expect(within(file).getByText(/山田 太郎が記録/)).toBeInTheDocument();
    expect(mocks.refreshed).toHaveBeenCalled();
  });

  it('records with the number keys, and no key records twice or turns into the undo', async () => {
    const { user, office } = await openFile();
    await user.keyboard('1');
    expect(mocks.recorded.map((input) => input.kind)).toEqual(['call']);
    // The contacts keep their places and keys, closed; the undo has its own key; Esc goes back
    const called = within(office).getByRole('button', { name: /電話した/ });
    expect(called).toHaveTextContent('1電話した');
    expect(called).toHaveAttribute('aria-disabled', 'true');
    expect(within(office).getByRole('button', { name: /メールした/ })).toHaveTextContent(
      '2メールした'
    );
    expect(within(office).getByRole('button', { name: /いまの記録を取り消す/ })).toHaveTextContent(
      'Zいまの記録を取り消す'
    );
    // The focus is on the report, off the closed button
    expect(document.activeElement?.textContent).toContain('「電話した」を記録しました');

    await user.keyboard('123');
    await user.click(called);
    expect(mocks.recorded).toHaveLength(1);
    expect(mocks.deleted).toHaveLength(0);
    // Nothing went back either: the file is still open
    expect(within(office).getByRole('region', { name: '見本商事1のファイル' })).toBeInTheDocument();
  });

  it('takes the record back with its own key, and opens the answers again', async () => {
    const { user, office, file } = await openFile();
    await user.keyboard('z');
    expect(mocks.deleted).toHaveLength(0);
    await user.keyboard('3');
    expect(mocks.recorded.map((input) => input.kind)).toEqual(['no_answer']);
    await user.keyboard('z');
    expect(mocks.deleted).toEqual([{ organizationId: ORG_ID, id: 'contact-1' }]);
    expect(within(office).getByText('記録を取り消しました。')).toBeInTheDocument();
    expect(within(file).getByText('まだ記録がありません。')).toBeInTheDocument();
    expect(within(office).getByRole('button', { name: /電話した/ })).not.toHaveAttribute(
      'aria-disabled'
    );
    expect(
      within(office).queryByRole('button', { name: /いまの記録を取り消す/ })
    ).not.toBeInTheDocument();
  });

  it('keeps the record in hand when the undo fails, so it can be asked for again', async () => {
    const { user, office } = await openFile();
    await user.keyboard('2');
    mocks.failDelete = true;
    await user.click(within(office).getByRole('button', { name: /いまの記録を取り消す/ }));
    expect(
      within(office).getByText('取り消せませんでした。記録は残っています。もう一度お願いします。')
    ).toBeInTheDocument();
    expect(within(office).getByRole('button', { name: /メールした/ })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    mocks.failDelete = false;
    await user.keyboard('Z');
    expect(mocks.deleted).toEqual([{ organizationId: ORG_ID, id: 'contact-1' }]);
    expect(mocks.recorded).toHaveLength(1);
  });

  it('shows who holds the room over the file too', async () => {
    const { office } = await openFile();
    expect(
      within(office).getByText('マーケターは空席です。数字は記録から読み上げています。')
    ).toBeInTheDocument();
  });

  it('records nothing and stays open on a key of a Japanese conversion (IME) (#1140)', async () => {
    const { office } = await openFile();
    fireEvent.keyDown(office, { key: '1', isComposing: true });
    fireEvent.keyDown(office, { key: '3', keyCode: 229 });
    expect(mocks.recorded).toHaveLength(0);
    fireEvent.keyDown(office, { key: 'Escape', isComposing: true });
    expect(within(office).getByRole('region', { name: '見本商事1のファイル' })).toBeInTheDocument();
  });

  it('reads the last contact from the records', async () => {
    mocks.records = [
      {
        id: 'old',
        leadId: '00000000-0000-4000-8000-000000000001',
        kind: 'no_answer',
        note: '折り返しを待つ',
        contactedAt: new Date('2026-11-12T01:00:00Z'),
        durationMinutes: null,
        outcome: null,
        createdBy: null,
      },
    ];
    const { office, file } = await openFile();
    expect(
      within(office).getByText(
        /最後の連絡は 11\/12 10:00 の「つながらなかった」です。連絡の記録は 1 件あります。/
      )
    ).toBeInTheDocument();
    expect(within(file).getByText('1 件（つながらなかった 1 回）')).toBeInTheDocument();
    expect(within(file).getByText('折り返しを待つ')).toBeInTheDocument();
  });

  it('says so when the record fails, and leaves the answers', async () => {
    mocks.failRecord = true;
    const { user, office } = await openFile();
    await user.keyboard('1');
    expect(
      within(office).getByText(
        'すみません、うまくいきませんでした。時間をおいて、もう一度お願いします。'
      )
    ).toBeInTheDocument();
    expect(within(office).getByRole('button', { name: /電話した/ })).toBeInTheDocument();
  });

  it('offers only the way back to a member who may not change leads', async () => {
    mocks.canEdit = false;
    const { user, office } = await openFile();
    expect(within(office).getByText('連絡を記録する権限がありません。')).toBeInTheDocument();
    expect(within(office).queryByRole('button', { name: /電話した/ })).not.toBeInTheDocument();
    await user.keyboard('123z');
    expect(mocks.recorded).toHaveLength(0);
    // The numbers never go back: only Esc does
    expect(within(office).getByRole('region', { name: '見本商事1のファイル' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(within(office).getByRole('region', { name: '見込み客ボード' })).toBeInTheDocument();
  });

  it('says that the contact records could not be read', async () => {
    mocks.contactsFail = true;
    const { office, file } = await openFile();
    expect(within(file).getAllByText(/連絡の記録を読めませんでした。/).length).toBeGreaterThan(0);
    expect(within(office).queryByRole('button', { name: /電話した/ })).not.toBeInTheDocument();
  });

  it('opens the lead\u2019s page in the normal view from the file, and closes the office', async () => {
    const { user, file, onExit } = await openFile();
    const link = within(file).getByRole('link', { name: '通常の表示で詳細を開く' });
    expect(link).toHaveAttribute('href', '/ja/leads/00000000-0000-4000-8000-000000000001');
    link.addEventListener('click', (event) => event.preventDefault());
    await user.click(link);
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
