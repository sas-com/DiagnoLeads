/**
 * The reception of the full-screen office (#1133): what is due comes to the president one at a
 * time; an answer marks it as done or leaves it for later, and can be undone. Real next-intl
 * messages; tRPC mocked.
 */
import { OfficeImmersive } from '@/components/features/ai-employees/office-immersive';
import { DEFAULT_AI_EMPLOYEE_PROFILE } from '@/lib/features/ai-employees/types/profile';
import { MESSAGE_FILES, mergeMessageFiles } from '@/lib/i18n/messages';
import { fireEvent, render, screen, within } from '@testing-library/react';
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
  members: [] as unknown[],
  membersTotal: null as number | null,
  membersInputs: [] as unknown[],
  invitations: 'forbidden' as 'forbidden' | 'error' | unknown[],
  revoked: [] as { organizationId: string; invitationId: string }[],
  revokeFails: null as null | 'NOT_FOUND' | 'INTERNAL',
  revokePending: false,
  invitationsRefreshed: vi.fn(),
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
      members: { listInvitations: { invalidate: mocks.invitationsRefreshed } },
    }),
    aiEmployees: {
      hire: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
      update: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
    },
    members: {
      list: {
        useQuery: (input: unknown) => {
          mocks.membersInputs.push(input);
          return {
            data: { members: mocks.members, total: mocks.membersTotal ?? mocks.members.length },
            error: null,
            isError: false,
            isFetching: false,
          };
        },
      },
      revokeInvitation: {
        useMutation: () => ({
          isPending: mocks.revokePending,
          mutate: (
            input: { organizationId: string; invitationId: string },
            options: {
              onSuccess?: () => void;
              onError?: (error: { data: { code: string } }) => void;
              onSettled?: () => void;
            } = {}
          ) => {
            mocks.revoked.push(input);
            if (mocks.revokeFails) options.onError?.({ data: { code: mocks.revokeFails } });
            else options.onSuccess?.();
            options.onSettled?.();
          },
        }),
      },
      listInvitations: {
        useQuery: () =>
          Array.isArray(mocks.invitations)
            ? { data: mocks.invitations, error: null, isError: false, isFetching: false }
            : {
                data: undefined,
                error: {
                  data: { code: mocks.invitations === 'forbidden' ? 'FORBIDDEN' : 'INTERNAL' },
                },
                isError: true,
                isFetching: false,
              },
      },
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

async function enterCounter(deskStatus: 'vacant' | 'idle' = 'vacant') {
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
  return { user, office, onExit };
}

/** Into the reception, and from its counter to the shelf of what is due */
async function enterReception(deskStatus: 'vacant' | 'idle' = 'vacant') {
  const entered = await enterCounter(deskStatus);
  await entered.user.keyboard('1');
  const board = within(entered.office).getByRole('region', { name: '今日の期限' });
  return { ...entered, board };
}

const member = (n: number, role: string, name: string | null = `見本 ${n}子`) => ({
  id: `00000000-0000-4000-8000-0000000000b${n}`,
  role,
  user: { id: `u${n}`, email: `member${n}@example.com`, name, image: null },
});

const invitation = (n: number, expired = false) => ({
  id: `00000000-0000-4000-8000-0000000000c${n}`,
  email: `invited${n}@example.com`,
  role: 'member',
  expiresAt: new Date('2026-11-15T03:00:00Z'),
  createdAt: new Date('2026-11-13T03:00:00Z'),
  expired,
});

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
    mocks.members = [member(1, 'owner'), member(2, 'member')];
    mocks.membersTotal = null;
    mocks.membersInputs.length = 0;
    mocks.invitations = 'forbidden';
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
    await user.click(within(guide).getByRole('button', { name: /総務・受付.*総務の窓口/ }));

    expect(within(office).getByRole('region', { name: '総務の窓口' })).toBeInTheDocument();
    expect(mocks.inputs.at(-1)).toMatchObject({ organizationId: ORG_ID, scope: 'mine' });
    expect(mocks.membersInputs.at(-1)).toMatchObject({ organizationId: ORG_ID });
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
    // Esc steps back one at a time: the counter, then the floor
    await user.keyboard('{Escape}');
    expect(within(office).getByRole('region', { name: '総務の窓口' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(within(office).getByRole('navigation', { name: 'フロア案内' })).toBeInTheDocument();
  });

  it('takes no key of a Japanese conversion (IME) as an answer or as the way back (#1140)', async () => {
    const { office, board } = await enterReception();
    fireEvent.keyDown(office, { key: '1', isComposing: true });
    fireEvent.keyDown(office, { key: '1', keyCode: 229 });
    fireEvent.keyDown(office, { key: '2', isComposing: true });
    expect(mocks.updates).toHaveLength(0);
    expect(within(board).getByRole('article', { name: '見本の次の行動1' })).toBeInTheDocument();
    fireEvent.keyDown(office, { key: 'Escape', isComposing: true });
    fireEvent.keyDown(office, { key: 'Escape', keyCode: 229 });
    expect(within(office).getByRole('region', { name: '今日の期限' })).toBeInTheDocument();
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

describe('the counter of the reception (#1196)', () => {
  beforeEach(() => {
    mocks.inputs.length = 0;
    mocks.mode = 'ok';
    mocks.items = [task(1, { dueOn: '2026-11-10' }), task(2), task(3)];
    mocks.total = null;
    mocks.canEdit = true;
    mocks.fail = false;
    mocks.updates.length = 0;
    mocks.members = [member(1, 'owner'), member(2, 'member', null)];
    mocks.membersTotal = null;
    mocks.invitations = [invitation(1), invitation(2, true)];
    mocks.revoked.length = 0;
    mocks.revokeFails = null;
    mocks.revokePending = false;
    mocks.invitationsRefreshed.mockClear();
  });

  it('reports what is recorded, and carries nothing out', async () => {
    const { user, office } = await enterCounter();
    expect(
      within(office).getByText(
        'あなたの、期限が今日までの次の行動は 3 件で、うち 1 件は期限を過ぎています。メンバーは 2 人、招待中は 1 件です。どの棚を開きますか。'
      )
    ).toBeInTheDocument();
    const counter = within(office).getByRole('region', { name: '総務の窓口' });
    expect(within(counter).getByText('3 件')).toBeInTheDocument();
    expect(within(counter).getByText('2 人')).toBeInTheDocument();
    expect(within(counter).getByText('ほかに、期限切れの招待が 1 件あります')).toBeInTheDocument();
    // The focus is on the report: Enter pressed once too often opens nothing
    expect(document.activeElement?.textContent).toContain('どの棚を開きますか');
    await user.keyboard('{Enter}');
    expect(within(office).getByRole('region', { name: '総務の窓口' })).toBeInTheDocument();
    expect(mocks.updates).toHaveLength(0);
  });

  it('does not say the invitations to who may not see them', async () => {
    mocks.invitations = 'forbidden';
    mocks.items = [];
    const { office } = await enterCounter();
    expect(
      within(office).getByText(
        'あなたの、期限が今日までの次の行動は、ありません。メンバーは 2 人です。どの棚を開きますか。'
      )
    ).toBeInTheDocument();
    expect(
      within(office).getByText('招待は、管理者とオーナーだけが見られます。')
    ).toBeInTheDocument();
  });

  it('does not say what is due to who may not see it', async () => {
    mocks.mode = 'forbidden';
    const { office } = await enterCounter();
    expect(
      within(office).getByText(/次の行動を見る権限がないので、期限の数字はお伝えできません。/)
    ).toBeInTheDocument();
  });

  it('leaves the overdue count out when not every due one was read', async () => {
    mocks.total = 250;
    const { office } = await enterCounter();
    expect(
      within(office).getByText(/期限が今日までの次の行動は 250 件です。/)
    ).toBeInTheDocument();
    expect(within(office).queryByText(/期限を過ぎています/)).not.toBeInTheDocument();
  });

  it('opens the members shelf with its key: members, roles and invitations, read only', async () => {
    const { user, office } = await enterCounter();
    await user.keyboard('2');
    const shelf = within(office).getByRole('region', { name: 'メンバーと招待' });
    expect(within(shelf).getByText('見本 1子')).toBeInTheDocument();
    expect(within(shelf).getByText('オーナー')).toBeInTheDocument();
    // A member without a name is shown by the email
    expect(within(shelf).getByText('member2@example.com')).toBeInTheDocument();
    expect(within(shelf).getByText('invited1@example.com')).toBeInTheDocument();
    expect(within(shelf).getByText('期限切れ')).toBeInTheDocument();
    expect(within(shelf).getByRole('link', { name: '通常の表示でメンバーを開く' })).toHaveAttribute(
      'href',
      '/ja/settings/members'
    );
    expect(within(shelf).queryAllByRole('button')).toHaveLength(0);
    // The other numbers do nothing in this shelf; Esc goes back to the counter, not to the floor
    await user.keyboard('23');
    expect(within(office).getByRole('region', { name: 'メンバーと招待' })).toBeInTheDocument();
    expect(within(office).queryByRole('textbox')).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(within(office).getByRole('region', { name: '総務の窓口' })).toBeInTheDocument();
    expect(document.activeElement?.textContent).toContain('どの棚を開きますか');
  });

  it('hides the invitations of the shelf from who may not see them', async () => {
    mocks.invitations = 'forbidden';
    const { user, office } = await enterCounter();
    await user.keyboard('2');
    const shelf = within(office).getByRole('region', { name: 'メンバーと招待' });
    expect(within(shelf).queryByText(/invited/)).not.toBeInTheDocument();
    expect(
      within(shelf).getByText('招待は、管理者とオーナーだけが見られます。')
    ).toBeInTheDocument();
    expect(within(office).getByText('メンバーは 2 人です。')).toBeInTheDocument();
    // Revoking is not offered either, and its key does nothing
    expect(within(office).queryByRole('button', { name: /招待を取り消す/ })).not.toBeInTheDocument();
    await user.keyboard('1');
    expect(within(office).queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('revokes an invitation only once the address of the invited person was typed (#1197)', async () => {
    const { user, office } = await enterCounter();
    await user.keyboard('2');
    expect(within(office).getByRole('button', { name: /招待を取り消す/ })).toHaveTextContent(
      '1招待を取り消す'
    );
    // The key only opens the field: nothing is revoked, however often the keys are pressed
    await user.keyboard('1');
    const field = within(office).getByRole('textbox', {
      name: '取り消す招待の、相手のメールアドレスを入力してください',
    });
    expect(field).toHaveFocus();
    await user.keyboard('11{Enter}{Enter}');
    expect(mocks.revoked).toHaveLength(0);
    expect(
      within(office).getByText('招待中の相手のメールアドレスと合っていません。')
    ).toBeInTheDocument();
    expect(within(office).getByRole('button', { name: 'この招待を取り消す' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    // The width and the case of the letters do not count
    await user.clear(field);
    await user.type(field, ' Invited1@Example.com{Enter}');
    expect(mocks.revoked).toEqual([
      { organizationId: ORG_ID, invitationId: '00000000-0000-4000-8000-0000000000c1' },
    ]);
    expect(mocks.invitationsRefreshed).toHaveBeenCalledWith({ organizationId: ORG_ID });
    expect(
      within(office).getByText('invited1@example.com への招待を取り消しました。')
    ).toBeInTheDocument();
    // The field is gone, and the focus is on what was reported
    expect(within(office).queryByRole('textbox')).not.toBeInTheDocument();
    expect(document.activeElement?.textContent).toContain('への招待を取り消しました');
  });

  it('closes the field with Esc, not the shelf, and keeps what was typed out of the next time', async () => {
    const { user, office } = await enterCounter();
    await user.keyboard('2');
    await user.keyboard('1');
    await user.keyboard('invited1');
    await user.keyboard('{Escape}');
    expect(within(office).getByRole('region', { name: 'メンバーと招待' })).toBeInTheDocument();
    expect(within(office).queryByRole('textbox')).not.toBeInTheDocument();
    expect(mocks.revoked).toHaveLength(0);
    await user.click(within(office).getByRole('button', { name: /招待を取り消す/ }));
    expect(within(office).getByRole('textbox')).toHaveValue('');
    await user.click(within(office).getByRole('button', { name: /棚に戻る/ }));
    await user.keyboard('{Escape}');
    expect(within(office).getByRole('region', { name: '総務の窓口' })).toBeInTheDocument();
  });

  it('has no way back while the revoking is being saved', async () => {
    const { user, office } = await enterCounter();
    await user.keyboard('2');
    await user.keyboard('1');
    mocks.revokePending = true;
    await user.keyboard('x');
    expect(within(office).getByRole('button', { name: /棚に戻る/ })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    await user.keyboard('{Escape}');
    await user.click(within(office).getByRole('button', { name: /棚に戻る/ }));
    expect(within(office).getByRole('textbox')).toBeInTheDocument();
    expect(within(office).getByRole('region', { name: 'メンバーと招待' })).toBeInTheDocument();
  });

  it('says so when the invitation is gone or the revoking failed, in its own words', async () => {
    mocks.revokeFails = 'NOT_FOUND';
    const { user, office } = await enterCounter();
    await user.keyboard('2');
    await user.keyboard('1');
    await user.keyboard('invited2@example.com{Enter}');
    expect(
      within(office).getByText(
        'その招待は、もう取り消されているか、承認されています。一覧を読み直しました。'
      )
    ).toBeInTheDocument();
    expect(mocks.invitationsRefreshed).toHaveBeenCalled();
    mocks.revokeFails = 'INTERNAL';
    await user.keyboard('1');
    await user.keyboard('invited2@example.com{Enter}');
    expect(
      within(office).getByText(
        'すみません、取り消せませんでした。時間をおいて、もう一度お願いします。'
      )
    ).toBeInTheDocument();
  });

  it('closes the choice while there is no invitation, and takes no key of a conversion (IME)', async () => {
    mocks.invitations = [];
    const { user, office } = await enterCounter();
    await user.keyboard('2');
    expect(within(office).getByRole('button', { name: /招待を取り消す/ })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    await user.keyboard('1');
    expect(within(office).queryByRole('textbox')).not.toBeInTheDocument();
    mocks.invitations = [invitation(1)];
    fireEvent.keyDown(office, { key: '1', isComposing: true });
    fireEvent.keyDown(office, { key: '1', keyCode: 229 });
    expect(within(office).queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('opens the settings shelf with its key: fixed doors to the normal view, moved over with the arrows', async () => {
    const { user, office, onExit } = await enterCounter();
    await user.keyboard('3');
    const shelf = within(office).getByRole('region', { name: '設定の棚' });
    const doors = within(shelf).getAllByRole('link');
    expect(doors.map((door) => door.getAttribute('href'))).toEqual([
      '/ja/settings/organization',
      '/ja/settings/members',
      '/ja/settings/webhooks',
      '/ja/settings/embed',
      '/ja/settings/qr-campaigns',
      '/ja/settings/ax-playbook',
      '/ja/settings/agency-links',
      '/ja/settings/field-glossary',
      '/ja/settings',
    ]);
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(doors[1]).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(doors[0]).toHaveFocus();
    // A door closes the office
    doors[0].addEventListener('click', (event) => event.preventDefault());
    await user.click(doors[0]);
    expect(onExit).toHaveBeenCalled();
  });

  it('shows the Esc of the room only at the counter, and takes no key of a conversion (IME)', async () => {
    const { user, office } = await enterCounter();
    fireEvent.keyDown(office, { key: '1', isComposing: true });
    fireEvent.keyDown(office, { key: '2', keyCode: 229 });
    expect(within(office).getByRole('region', { name: '総務の窓口' })).toBeInTheDocument();
    expect(within(office).getByRole('button', { name: /フロアへ戻る/ })).toHaveTextContent('Esc');
    await user.keyboard('3');
    expect(within(office).getByRole('button', { name: /フロアへ戻る/ })).not.toHaveTextContent(
      'Esc'
    );
    expect(within(office).getByRole('button', { name: /窓口へ戻る/ })).toHaveTextContent('Esc');
    fireEvent.keyDown(office, { key: 'Escape', isComposing: true });
    expect(within(office).getByRole('region', { name: '設定の棚' })).toBeInTheDocument();
    await user.click(within(office).getByRole('button', { name: /窓口へ戻る/ }));
    expect(within(office).getByRole('region', { name: '総務の窓口' })).toBeInTheDocument();
  });
});
