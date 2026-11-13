/**
 * The marketing room of the full-screen office (#1127): entering it from the floor, the room's
 * figures and who reads them, the lead board with its views, pages and states, the keys, and
 * the customer file that opens inside the room and records a contact (#1128).
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
  /** What leads.list answers: 'ok', 'forbidden', 'error' or 'loading' */
  mode: 'ok' as 'ok' | 'forbidden' | 'error' | 'loading',
  /** The contact records of the open lead, newest first */
  records: [] as ContactRecord[],
  recorded: [] as { organizationId: string; leadId: string; kind: string }[],
  deleted: [] as { organizationId: string; id: string }[],
  canEdit: true,
  failRecord: false,
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

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
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
        useMutation: (options: { onSuccess?: () => void } = {}) => ({
          isPending: false,
          mutate: (input: { organizationId: string; id: string }) => {
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
    mocks.records = [];
    mocks.recorded.length = 0;
    mocks.deleted.length = 0;
    mocks.canEdit = true;
    mocks.failRecord = false;
    mocks.contactsFail = false;
    mocks.refreshed.mockClear();
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
    expect(within(board).getAllByRole('button', { name: /見本商事/ })).toHaveLength(3);
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
    expect(within(board).getAllByRole('button', { name: /見本商事/ })).toHaveLength(
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
    await user.keyboard('1');
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
    expect(within(board).queryByRole('button', { name: /見本商事/ })).not.toBeInTheDocument();
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

describe('the customer file in the room', () => {
  beforeEach(() => {
    mocks.inputs.length = 0;
    mocks.mode = 'ok';
    mocks.records = [];
    mocks.recorded.length = 0;
    mocks.deleted.length = 0;
    mocks.canEdit = true;
    mocks.failRecord = false;
    mocks.contactsFail = false;
    mocks.refreshed.mockClear();
  });

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
    expect(within(file).getByRole('button', { name: /Esc.*ボードに戻る/ })).toBeInTheDocument();
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

  it('records with the number keys, and the same key pressed again goes back instead of recording twice', async () => {
    const { user, office } = await openFile();
    await user.keyboard('1');
    expect(mocks.recorded.map((input) => input.kind)).toEqual(['call']);
    const choices = within(office)
      .getAllByRole('button')
      .filter((button) => /ボードに戻る|取り消す|電話した/.test(button.textContent ?? ''));
    expect(choices.map((button) => button.textContent)).toEqual(
      expect.arrayContaining(['1ボードに戻る', '2いまの記録を取り消す'])
    );
    expect(within(office).queryByRole('button', { name: /電話した/ })).not.toBeInTheDocument();

    await user.keyboard('1');
    expect(mocks.recorded).toHaveLength(1);
    expect(mocks.deleted).toHaveLength(0);
    expect(within(office).getByRole('region', { name: '見込み客ボード' })).toBeInTheDocument();
  });

  it('takes the record back, and offers the answers again', async () => {
    const { user, office, file } = await openFile();
    await user.keyboard('3');
    expect(mocks.recorded.map((input) => input.kind)).toEqual(['no_answer']);
    await user.click(within(office).getByRole('button', { name: /いまの記録を取り消す/ }));
    expect(mocks.deleted).toEqual([{ organizationId: ORG_ID, id: 'contact-1' }]);
    expect(within(office).getByText('記録を取り消しました。')).toBeInTheDocument();
    expect(within(file).getByText('まだ記録がありません。')).toBeInTheDocument();
    expect(within(office).getByRole('button', { name: /電話した/ })).toBeInTheDocument();
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
    await user.keyboard('2');
    await user.keyboard('3');
    expect(mocks.recorded).toHaveLength(0);
    await user.keyboard('1');
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
