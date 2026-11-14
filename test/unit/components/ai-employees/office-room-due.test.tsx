/**
 * The reception of the full-screen office (#1133): what is due comes to the president one at a
 * time; an answer marks it as done or leaves it for later, and can be undone. Real next-intl
 * messages; tRPC mocked.
 */
import { OfficeImmersive } from '@/components/features/ai-employees/office-immersive';
import { DEFAULT_AI_EMPLOYEE_PROFILE } from '@/lib/features/ai-employees/types/profile';
import { MESSAGE_FILES, mergeMessageFiles } from '@/lib/i18n/messages';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const TODAY = '2026-11-13';

const task = (n: number, over: Partial<Record<string, unknown>> = {}) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  leadId: `00000000-0000-4000-8000-0000000000a${n}`,
  title: `見本の次の行動${n}`,
  note: null,
  dueOn: TODAY,
  done: false,
  completedAt: null,
  source: 'manual',
  sourceHearingId: null,
  kind: 'next_action',
  checkWith: null,
  checkWithUser: null,
  assigneeId: null,
  lead: { name: `見本 ${n}郎`, company: `見本商事${n}` },
  mine: true,
  ...over,
});

const mocks = vi.hoisted(() => ({
  inputs: [] as unknown[],
  mode: 'ok' as 'ok' | 'forbidden' | 'error' | 'loading',
  items: [] as unknown[],
  total: null as number | null,
  canEdit: true,
  fail: false,
  updates: [] as { organizationId: string; id: string; done: boolean }[],
  refreshed: vi.fn(),
}));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      aiEmployees: { office: { invalidate: vi.fn() } },
      leadFollowUp: {
        tasks: { invalidate: vi.fn() },
        dueTasks: { invalidate: mocks.refreshed },
      },
      deals: { board: { invalidate: vi.fn() } },
    }),
    aiEmployees: {
      hire: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
      update: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
    },
    leadFollowUp: {
      dueTasks: {
        useQuery: (input: unknown) => {
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
          return {
            data: {
              items: mocks.items,
              total: mocks.total ?? mocks.items.length,
              counts: { mine: mocks.items.length, all: mocks.items.length },
              scope: 'mine',
              today: TODAY,
              canEdit: mocks.canEdit,
            },
            error: null,
            isError: false,
            isFetching: false,
          };
        },
      },
      updateTask: {
        useMutation: (
          options: {
            onSuccess?: (saved: unknown, input: { id: string; done?: boolean }) => void;
            onError?: (error: unknown, input: { id: string; done?: boolean }) => void;
          } = {}
        ) => ({
          isPending: false,
          mutate: (input: { organizationId: string; id: string; done: boolean }) => {
            if (mocks.fail) {
              options.onError?.(new Error('failed'), input);
              return;
            }
            mocks.updates.push(input);
            // The server's list no longer holds what was done: the room must keep its own queue
            mocks.items = mocks.items.filter(
              (entry) => !(input.done && (entry as { id: string }).id === input.id)
            );
            options.onSuccess?.({}, input);
          },
        }),
      },
    },
  },
}));

const messages = mergeMessageFiles(MESSAGE_FILES.ja);

async function enterReception(deskStatus: 'vacant' | 'idle' = 'vacant') {
  const user = userEvent.setup();
  const onExit = vi.fn();
  const employees =
    deskStatus === 'vacant'
      ? []
      : [
          {
            id: '770e8400-e29b-41d4-a716-446655440005',
            role: 'back_office' as const,
            name: 'AIバックオフィス',
            status: 'active' as const,
            createdAt: new Date('2026-11-01T00:00:00Z'),
            deskStatus,
            lastRun: null,
            processedToday: 0,
            profile: DEFAULT_AI_EMPLOYEE_PROFILE,
          },
        ];
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
  await user.keyboard('5');
  const board = within(office).getByRole('region', { name: '今日の期限' });
  return { user, office, board, onExit };
}

describe('the reception', () => {
  beforeEach(() => {
    mocks.inputs.length = 0;
    mocks.mode = 'ok';
    mocks.items = [task(1, { dueOn: '2026-11-10' }), task(2), task(3)];
    mocks.total = null;
    mocks.canEdit = true;
    mocks.fail = false;
    mocks.updates.length = 0;
    mocks.refreshed.mockClear();
  });

  it('is entered from the floor guide, and asks for the user’s own due actions of the organization', async () => {
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
    await user.click(within(guide).getByRole('button', { name: /総務・受付.*今日の期限/ }));

    expect(within(office).getByRole('region', { name: '今日の期限' })).toBeInTheDocument();
    expect(mocks.inputs.at(-1)).toMatchObject({ organizationId: ORG_ID, scope: 'mine' });
    await user.keyboard('{Escape}');
    expect(within(office).getByRole('navigation', { name: 'フロア案内' })).toBeInTheDocument();
  });

  it('hands over the first one, oldest first, with whom it is for and how late it is', async () => {
    const { office, board } = await enterReception();
    expect(
      within(office).getByText(
        'あなたの、期限が今日までの次の行動は 3 件です。1 件目をお渡しします。'
      )
    ).toBeInTheDocument();
    expect(
      within(office).getByText('バックオフィスは空席です。数字は記録から読み上げています。')
    ).toBeInTheDocument();
    const card = within(board).getByRole('article', { name: '見本の次の行動1' });
    expect(within(card).getByText('期限を 3 日過ぎています')).toBeInTheDocument();
    expect(within(card).getByText(/見本商事1\s見本 1郎/)).toBeInTheDocument();
    expect(within(board).getByText('3 件中 1 件目')).toBeInTheDocument();
    // Enter pressed once too often marks nothing: the focus is on the report
    expect(document.activeElement?.textContent).toContain('1 件目をお渡しします');
  });

  it('marks one as done with its key, and the same key marks nothing more until the president goes on', async () => {
    const { user, office, board } = await enterReception();
    expect(within(office).getByRole('button', { name: /済みにする/ })).toHaveTextContent(
      '1済みにする'
    );
    expect(within(office).getByRole('button', { name: /あとで/ })).toHaveTextContent(
      '2あとで（次の件へ）'
    );
    await user.keyboard('1');
    expect(mocks.updates).toEqual([
      { organizationId: ORG_ID, id: '00000000-0000-4000-8000-000000000001', done: true },
    ]);
    expect(
      within(office).getByText('済みにしました。間違えたときは、取り消せます。')
    ).toBeInTheDocument();
    expect(mocks.refreshed).toHaveBeenCalled();
    // The card stays in hand until the president goes on, though the server's list dropped it
    expect(within(board).getByRole('article', { name: '見本の次の行動1' })).toBeInTheDocument();
    // Marking keeps its place and key, closed; going on and the undo are offered
    expect(within(office).getByRole('button', { name: /済みにする/ })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    expect(within(office).getByRole('button', { name: /次の件へ/ })).toHaveTextContent('2次の件へ');
    expect(within(office).getByRole('button', { name: /いまのを取り消す/ })).toHaveTextContent(
      'Zいまのを取り消す'
    );
    expect(document.activeElement?.textContent).toContain('済みにしました');

    await user.keyboard('111');
    expect(mocks.updates).toHaveLength(1);
    expect(within(board).getByRole('article', { name: '見本の次の行動1' })).toBeInTheDocument();

    await user.keyboard('2');
    expect(within(board).getByRole('article', { name: '見本の次の行動2' })).toBeInTheDocument();
    expect(within(board).getByText('3 件中 2 件目')).toBeInTheDocument();
    expect(within(office).getByText('3 件中 2 件目をお渡しします。')).toBeInTheDocument();
    expect(within(office).getByRole('button', { name: /済みにする/ })).not.toHaveAttribute(
      'aria-disabled'
    );
  });

  it('takes the mark back with its own key, and opens the answers for the same one again', async () => {
    const { user, office, board } = await enterReception();
    await user.keyboard('z');
    expect(mocks.updates).toHaveLength(0);
    await user.keyboard('1');
    await user.keyboard('z');
    expect(mocks.updates.at(-1)).toEqual({
      organizationId: ORG_ID,
      id: '00000000-0000-4000-8000-000000000001',
      done: false,
    });
    expect(within(office).getByText('済みを取り消しました。')).toBeInTheDocument();
    expect(within(board).getByRole('article', { name: '見本の次の行動1' })).toBeInTheDocument();
    expect(within(office).getByRole('button', { name: /済みにする/ })).not.toHaveAttribute(
      'aria-disabled'
    );
    expect(
      within(office).queryByRole('button', { name: /いまのを取り消す/ })
    ).not.toBeInTheDocument();
  });

  it('keeps the mark in hand when the undo fails, so it can be asked for again', async () => {
    const { user, office } = await enterReception();
    await user.keyboard('1');
    mocks.fail = true;
    await user.click(within(office).getByRole('button', { name: /いまのを取り消す/ }));
    expect(
      within(office).getByText('取り消せませんでした。済みのままです。もう一度お願いします。')
    ).toBeInTheDocument();
    expect(within(office).getByRole('button', { name: /済みにする/ })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    mocks.fail = false;
    await user.keyboard('Z');
    expect(mocks.updates.at(-1)).toMatchObject({ done: false });
  });

  it('leaves one for later without changing it, and sums up at the end', async () => {
    const { user, office, board } = await enterReception();
    await user.keyboard('2'); // later
    await user.keyboard('1'); // done (2nd)
    await user.keyboard('2'); // next
    await user.keyboard('2'); // later (3rd)
    expect(mocks.updates.map((update) => update.id)).toEqual([
      '00000000-0000-4000-8000-000000000002',
    ]);
    expect(
      within(office).getByText('これで全部です。1 件を済みにしました。残りは 2 件です。')
    ).toBeInTheDocument();
    const order = within(board).getByRole('list');
    expect(within(order).getAllByText('あとで')).toHaveLength(2);
    expect(within(order).getAllByText('済み')).toHaveLength(1);

    // The numbers do nothing any more, and never go back: Esc and its button do
    await user.keyboard('12');
    expect(mocks.updates).toHaveLength(1);
    expect(within(office).getByRole('region', { name: '今日の期限' })).toBeInTheDocument();
    expect(within(office).queryByRole('button', { name: /済みにする/ })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(within(office).getByRole('navigation', { name: 'フロア案内' })).toBeInTheDocument();
  });

  it('shows a takeaway with whom to check, and the note', async () => {
    mocks.items = [task(1, { kind: 'takeaway', checkWith: '情報システム部', note: '契約の条件' })];
    const { board } = await enterReception();
    const card = within(board).getByRole('article', { name: '見本の次の行動1' });
    expect(within(card).getByText('持ち帰り事項')).toBeInTheDocument();
    expect(within(card).getByText('確かめる相手：情報システム部')).toBeInTheDocument();
    expect(within(card).getByText('契約の条件')).toBeInTheDocument();
    expect(within(card).getByText('期限は今日')).toBeInTheDocument();
  });

  it('names a next action that kept the default title of a hearing', async () => {
    mocks.items = [task(1, { title: null })];
    const { board } = await enterReception();
    expect(within(board).getByRole('article', { name: '次回の打ち合わせ' })).toBeInTheDocument();
  });

  it('says so when nothing is due', async () => {
    mocks.items = [];
    const { office, board } = await enterReception();
    expect(
      within(board).getByText('あなたの、期限が今日までの次の行動は、ありません。')
    ).toBeInTheDocument();
    expect(within(office).queryByRole('button', { name: /済みにする/ })).not.toBeInTheDocument();
  });

  it('says how many more there are than it can hand over', async () => {
    mocks.total = 210;
    const { board } = await enterReception();
    expect(
      within(board).getByText(
        'このほかに 207 件あります。通常の表示の「今日」で確かめてください。'
      )
    ).toBeInTheDocument();
  });

  it('lets a member who may not change leads only look and go on', async () => {
    mocks.canEdit = false;
    const { user, office, board } = await enterReception();
    expect(within(office).getByText('次の行動を済みにする権限がありません。')).toBeInTheDocument();
    expect(within(office).queryByRole('button', { name: /済みにする/ })).not.toBeInTheDocument();
    await user.keyboard('1');
    expect(mocks.updates).toHaveLength(0);
    expect(within(board).getByRole('article', { name: '見本の次の行動1' })).toBeInTheDocument();
    await user.keyboard('2');
    expect(within(board).getByRole('article', { name: '見本の次の行動2' })).toBeInTheDocument();
  });

  it('says so when marking fails, and leaves the answers', async () => {
    mocks.fail = true;
    const { user, office } = await enterReception();
    await user.keyboard('1');
    expect(
      within(office).getByText(
        'すみません、うまくいきませんでした。時間をおいて、もう一度お願いします。'
      )
    ).toBeInTheDocument();
    expect(within(office).getByRole('button', { name: /済みにする/ })).toBeInTheDocument();
  });

  it('tells a member without the permission so, and shows loading and failure', async () => {
    mocks.mode = 'forbidden';
    const forbidden = await enterReception();
    expect(
      within(forbidden.board).getByText(
        '次の行動を見る権限がありません。管理者に確かめてください。'
      )
    ).toBeInTheDocument();
  });

  it('shows that it is reading, and that reading failed', async () => {
    mocks.mode = 'loading';
    const loading = await enterReception();
    expect(within(loading.board).getByText('期限を確かめています。')).toBeInTheDocument();
  });

  it('says that reading failed', async () => {
    mocks.mode = 'error';
    const { board } = await enterReception();
    expect(
      within(board).getByText('期限を読めませんでした。時間をおいて、もう一度開いてください。')
    ).toBeInTheDocument();
  });

  it('names the AI employee that holds the room once it works', async () => {
    const { office } = await enterReception('idle');
    expect(
      within(office).getByText('AIバックオフィスが、この部屋を受け持っています。')
    ).toBeInTheDocument();
  });

  it('opens the lead and Today in the normal view, closing the office', async () => {
    const { user, board, onExit } = await enterReception();
    const lead = within(board).getByRole('link', { name: /通常の表示でリードを開く/ });
    expect(lead).toHaveAttribute('href', '/ja/leads/00000000-0000-4000-8000-0000000000a1');
    expect(within(board).getByRole('link', { name: '通常の表示の「今日」を開く' })).toHaveAttribute(
      'href',
      '/ja/today'
    );
    lead.addEventListener('click', (event) => event.preventDefault());
    await user.click(lead);
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
