/**
 * The marketing room of the full-screen office (#1127): entering it from the floor, the room's
 * figures and who reads them, the lead board with its views, pages and states, and the keys.
 * Real next-intl messages; tRPC mocked.
 */
import { OfficeImmersive } from '@/components/features/ai-employees/office-immersive';
import { LEAD_BOARD_PAGE_SIZE } from '@/components/features/ai-employees/office-rooms';
import { MESSAGE_FILES, mergeMessageFiles } from '@/lib/i18n/messages';
import { render, screen, within } from '@testing-library/react';
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

const mocks = vi.hoisted(() => ({
  inputs: [] as unknown[],
  /** What leads.list answers: 'ok', 'forbidden', 'error' or 'loading' */
  mode: 'ok' as 'ok' | 'forbidden' | 'error' | 'loading',
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

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({ aiEmployees: { office: { invalidate: vi.fn() } } }),
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
});

async function enterRoom(employees: ReturnType<typeof marketer>[] = []) {
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
  const board = within(office).getByRole('region', { name: '見込み客ボード' });
  return { user, office, board, onExit };
}

describe('the marketing room', () => {
  beforeEach(() => {
    mocks.inputs.length = 0;
    mocks.mode = 'ok';
  });

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
    expect(within(office).getByRole('region', { name: '見込み客ボード' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(within(office).queryByRole('region', { name: '見込み客ボード' })).not.toBeInTheDocument();
    expect(within(office).getByRole('navigation', { name: 'フロア案内' })).toBeInTheDocument();
  });

  it('asks only for the leads of the organization', async () => {
    await enterRoom();
    expect(mocks.inputs.length).toBeGreaterThan(0);
    for (const input of mocks.inputs) {
      expect((input as ListInput).organizationId).toBe(ORG_ID);
    }
  });

  it('reads the real totals, and says that the seat is vacant', async () => {
    const { office } = await enterRoom();
    expect(
      within(office).getByText(
        '今週の新しい見込み客は 5 件です。相談の申込は 0 件、まだ着手していないものは 3 件あります。'
      )
    ).toBeInTheDocument();
    expect(
      within(office).getByText('マーケターは空席です。数字はボードから読み上げています。')
    ).toBeInTheDocument();
  });

  it('does not put a report in the mouth of an AI employee in training or paused', async () => {
    const training = await enterRoom([marketer('training')]);
    expect(
      within(training.office).getByText(
        'AIマーケターは研修中で、まだこの部屋の仕事を受け持っていません。数字はボードから読み上げています。'
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

  it('opens on what nobody has started on, the focus on the report', async () => {
    const { office, board } = await enterRoom();
    expect(within(board).getByText(/まだ着手していない（新規）・3 件/)).toBeInTheDocument();
    expect(within(board).getAllByRole('link', { name: /見本商事/ })).toHaveLength(3);
    expect(
      within(office).getByRole('button', { name: /まだ着手していないものを見せて/ })
    ).toHaveAttribute('aria-pressed', 'true');
    // Enter pressed once too often opens nothing: the focus is on the report, not on a row
    expect(document.activeElement?.textContent).toContain('今週の新しい見込み客');
  });

  it('switches the view with a choice or its number key', async () => {
    const { user, office, board } = await enterRoom();
    await user.click(within(office).getByRole('button', { name: /全部見せて/ }));
    expect(within(board).getByText(/すべて・12 件/)).toBeInTheDocument();
    expect(within(board).getAllByRole('link', { name: /見本商事/ })).toHaveLength(
      LEAD_BOARD_PAGE_SIZE
    );

    await user.keyboard('4');
    expect(within(board).getByText(/自分の担当・1 件/)).toBeInTheDocument();
    expect(within(board).getByText('山田 太郎')).toBeInTheDocument();
  });

  it('says so when a view holds no leads', async () => {
    const { user, board } = await enterRoom();
    await user.keyboard('2');
    expect(within(board).getByText('この絞り込みに当たる見込み客はいません。')).toBeInTheDocument();
  });

  it('turns the pages with the buttons and the arrow keys, and goes back to the first on a new view', async () => {
    const { user, board } = await enterRoom();
    await user.keyboard('5');
    expect(within(board).getByText('12 件中 1〜8 件')).toBeInTheDocument();
    expect(within(board).getByRole('button', { name: /前へ/ })).toHaveAttribute(
      'aria-disabled',
      'true'
    );

    await user.click(within(board).getByRole('button', { name: /次へ/ }));
    expect(within(board).getByText('12 件中 9〜12 件')).toBeInTheDocument();
    expect(within(board).getAllByRole('link', { name: /見本商事/ })).toHaveLength(4);
    // The button keeps the focus at the last page, so the keys go on working
    expect(within(board).getByRole('button', { name: /次へ/ })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    expect(within(board).getByRole('button', { name: /次へ/ })).toHaveFocus();

    await user.keyboard('{ArrowLeft}');
    expect(within(board).getByText('12 件中 1〜8 件')).toBeInTheDocument();
    await user.keyboard('{ArrowRight}');
    await user.keyboard('1');
    expect(within(board).getByText('3 件中 1〜3 件')).toBeInTheDocument();
  });

  it('moves over the rows with the arrow keys', async () => {
    const { user, board } = await enterRoom();
    const rows = within(board).getAllByRole('link', { name: /見本商事/ });
    await user.keyboard('{ArrowDown}');
    expect(rows[0]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(rows[1]).toHaveFocus();
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(rows[0]).toHaveFocus();
  });

  it('opens a lead on its page in the normal view, and closes the office', async () => {
    const { user, board, onExit } = await enterRoom();
    const row = within(board).getAllByRole('link', { name: /見本商事/ })[0];
    expect(row).toHaveAttribute('href', '/ja/leads/00000000-0000-4000-8000-000000000001');
    // The MQL level and the status are words, not only colours
    expect(within(row).getByText('関心あり（MQL）')).toBeInTheDocument();
    expect(within(row).getByText('新規')).toBeInTheDocument();
    row.addEventListener('click', (event) => event.preventDefault());
    await user.click(row);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('links to the same view of the list in the normal view', async () => {
    const { user, board } = await enterRoom();
    expect(within(board).getByRole('link', { name: '通常の表示の一覧で開く' })).toHaveAttribute(
      'href',
      '/ja/leads?status=new'
    );
    await user.keyboard('5');
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
    expect(within(office).getByText('ボードの数字を読めませんでした。')).toBeInTheDocument();
    expect(within(board).queryByRole('link', { name: /見本商事/ })).not.toBeInTheDocument();
  });

  it('shows that it is loading, and that reading failed', async () => {
    mocks.mode = 'loading';
    const loading = await enterRoom();
    expect(within(loading.board).getByText('読み込んでいます')).toBeInTheDocument();
    expect(within(loading.office).getByText('ボードの数字を読んでいます。')).toBeInTheDocument();
  });

  it('says that reading failed', async () => {
    mocks.mode = 'error';
    const { board } = await enterRoom();
    expect(
      within(board).getByText('見込み客を読めませんでした。時間をおいて、もう一度開いてください。')
    ).toBeInTheDocument();
  });
});
