/**
 * The sales floor of the full-screen office (#1171): the open deals on the room's board, and a
 * deal file in which the deal is moved by one stage and its next action is settled, with an undo.
 * Real next-intl messages; tRPC mocked.
 */
import { OfficeImmersive } from '@/components/features/ai-employees/office-immersive';
import { MESSAGE_FILES, mergeMessageFiles } from '@/lib/i18n/messages';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
// A Friday in Japan: the week ends on Sunday the 15th
const TODAY = '2026-11-13';

type Deal = Record<string, unknown> & { id: string; stage: string; probability: number };

const deal = (n: number, over: Partial<Record<string, unknown>> = {}): Deal => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  leadId: `00000000-0000-4000-8000-0000000000a${n}`,
  name: `見本の商談${n}`,
  kind: 'survey',
  stage: 'discovery',
  amount: 1_000_000,
  probability: 20,
  expectedCloseOn: null,
  ownerName: '山田 太郎',
  leadName: `見本 ${n}郎`,
  company: `見本商事${n}`,
  nextTask: null,
  hasOpenTask: false,
  leadSqlDecision: 'qualified',
  ...over,
});
const nextTask = (n: number, dueOn: string) => ({
  id: `00000000-0000-4000-8000-0000000000b${n}`,
  title: `見本の次の行動${n}`,
  dueOn,
  kind: 'next_action',
  source: 'manual',
});

const mocks = vi.hoisted(() => ({
  inputs: [] as { owner: string; organizationId: string }[],
  mode: 'ok' as 'ok' | 'forbidden' | 'loading',
  deals: [] as (Record<string, unknown> & { id: string; stage: string; probability: number })[],
  mine: [] as (Record<string, unknown> & { id: string; stage: string; probability: number })[],
  canEdit: true,
  truncated: false,
  fail: false,
  handedOff: false,
  moves: [] as Record<string, unknown>[],
  marks: [] as { id: string; done: boolean }[],
  added: [] as Record<string, unknown>[],
  left: vi.fn(),
}));

type Callbacks = {
  onSuccess?: (saved: never, input: never) => void;
  onError?: (error: unknown, input: never) => void;
};
/** A mutation whose hook-level and call-level callbacks both hear the answer, as tRPC's do */
function mutation<Input>(run: (input: Input) => unknown) {
  return (options: Callbacks = {}) => ({
    isPending: false,
    isError: false,
    mutate: (input: Input, own: Callbacks = {}) => {
      if (mocks.fail) {
        options.onError?.(new Error('failed'), input as never);
        own.onError?.(new Error('failed'), input as never);
        return;
      }
      const saved = run(input);
      options.onSuccess?.(saved as never, input as never);
      own.onSuccess?.(saved as never, input as never);
    },
  });
}

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/ja/office',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/trpc/client', () => {
  const invalidate = () => ({ invalidate: vi.fn() });
  return {
    trpc: {
      useUtils: () => ({
        aiEmployees: { office: invalidate() },
        deals: { ...invalidate(), board: invalidate() },
        leads: invalidate(),
        leadActivity: invalidate(),
        leadFollowUp: { tasks: invalidate(), dueTasks: invalidate() },
      }),
      aiEmployees: {
        hire: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
        update: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
      },
      deals: {
        board: {
          useQuery: (
            input: { owner: string; organizationId: string },
            options?: { enabled?: boolean }
          ) => {
            if (options?.enabled === false) {
              return { data: undefined, error: null, isError: false, isFetching: false };
            }
            mocks.inputs.push(input);
            if (mocks.mode === 'loading') {
              return { data: undefined, error: null, isError: false, isFetching: true };
            }
            if (mocks.mode === 'forbidden') {
              return {
                data: undefined,
                error: { data: { code: 'FORBIDDEN' } },
                isError: true,
                isFetching: false,
              };
            }
            const deals = input.owner === 'mine' ? mocks.mine : mocks.deals;
            const stages = ['qualification', 'discovery', 'proposal', 'negotiation', 'won', 'lost'];
            return {
              data: {
                columns: stages.map((stage) => {
                  const held = deals.filter((entry) => entry.stage === stage);
                  return {
                    stage,
                    count: held.length,
                    amount: held.length * 1_000_000,
                    weightedAmount: 0,
                    deals: held,
                  };
                }),
                truncated: mocks.truncated,
                today: '2026-11-13',
                canEdit: mocks.canEdit,
                canDelete: false,
              },
              error: null,
              isError: false,
              isFetching: false,
            };
          },
        },
        create: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
        delete: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
        update: {
          useMutation: mutation(
            (input: { dealId: string; stage: string; probability?: number }) => {
              mocks.moves.push(input);
              // The board holds the deal in its new stage once it is read again
              const moved = mocks.deals.find((entry) => entry.id === input.dealId);
              const probability =
                input.probability ??
                { qualification: 10, discovery: 20, proposal: 40, negotiation: 70 }[input.stage] ??
                0;
              if (moved) Object.assign(moved, { stage: input.stage, probability });
              return { probability, handedOff: mocks.handedOff, sqlUndecided: false };
            }
          ),
        },
      },
      leadFollowUp: {
        updateTask: {
          useMutation: mutation((input: { id: string; done: boolean }) => {
            mocks.marks.push(input);
            return {};
          }),
        },
        createTask: {
          useMutation: mutation((input: Record<string, unknown>) => {
            mocks.added.push(input);
            return { id: 'new-task' };
          }),
        },
      },
    },
  };
});

const messages = mergeMessageFiles(MESSAGE_FILES.ja);

async function enterSalesFloor() {
  const user = userEvent.setup();
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <OfficeImmersive
        organizationId={ORG_ID}
        companyName="テスト商事"
        presidentName="山田 太郎"
        employees={[]}
        canManage
        onExit={mocks.left}
      />
    </NextIntlClientProvider>
  );
  const office = screen.getByRole('dialog', { name: 'AI社員オフィス（全画面）' });
  await user.click(within(office).getByRole('button', { name: /^出社する/ }));
  await user.keyboard('3');
  const board = within(office).getByRole('region', { name: '商談ボード' });
  return { user, office, board };
}

async function openFile(name: string) {
  const entered = await enterSalesFloor();
  await entered.user.keyboard('4');
  await entered.user.click(within(entered.board).getByRole('button', { name: new RegExp(name) }));
  const file = within(entered.office).getByRole('region', { name: `「${name}」の商談ファイル` });
  return { ...entered, file };
}

const choice = (office: HTMLElement, name: RegExp) =>
  within(office).getByRole('button', { name });

describe('the sales floor', () => {
  beforeEach(() => {
    mocks.inputs.length = 0;
    mocks.mode = 'ok';
    mocks.deals = [
      deal(1, { stage: 'qualification', leadSqlDecision: null }),
      deal(2, { nextTask: nextTask(2, '2026-11-10'), hasOpenTask: true }),
      deal(3, { stage: 'proposal', probability: 55, expectedCloseOn: '2026-11-15' }),
      deal(4, {
        stage: 'negotiation',
        probability: 70,
        nextTask: nextTask(4, '2026-11-20'),
        hasOpenTask: true,
      }),
    ];
    mocks.mine = [mocks.deals[1]];
    mocks.canEdit = true;
    mocks.truncated = false;
    mocks.fail = false;
    mocks.handedOff = false;
    mocks.moves.length = 0;
    mocks.marks.length = 0;
    mocks.added.length = 0;
    mocks.left.mockClear();
  });

  it('is entered from the floor guide with its key, and reads the open deals of the organization', async () => {
    const { user, office } = await enterSalesFloor();
    expect(mocks.inputs[0]).toEqual({ organizationId: ORG_ID, owner: 'all', closedWithinDays: 0 });
    expect(mocks.inputs.every((input) => input.owner === 'all')).toBe(true);
    await user.keyboard('{Escape}');
    const guide = within(office).getByRole('navigation', { name: 'フロア案内' });
    expect(within(guide).getByRole('button', { name: /営業フロア.*商談/ })).toHaveTextContent('3');
  });

  it('reports the figures of the board, and says who holds the room', async () => {
    const { office, board } = await enterSalesFloor();
    const report = within(office).getByText(/開いている商談は 4 件/);
    expect(report).toHaveTextContent(
      '開いている商談は 4 件、金額の合計は ￥4,000,000 です。今週中に動かすものは 2 件、次の行動が決まっていないものは 2 件あります。'
    );
    expect(
      within(office).getByText('セールスは空席です。数字は記録から読み上げています。')
    ).toBeInTheDocument();
    // Enter pressed once too often opens nothing: the focus is on the report
    expect(document.activeElement).toContainElement(report);
    const stages = within(board).getByRole('list', { name: '段ごとの件数と金額（開いている商談すべて）' });
    expect(within(stages).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      expect.stringMatching(/^見極め1 件/),
      expect.stringMatching(/^課題の確認1 件/),
      expect.stringMatching(/^提案1 件/),
      expect.stringMatching(/^条件の調整1 件/),
    ]);
  });

  it('opens on what has to move this week, earliest first, and switches the view with the number keys', async () => {
    const { user, board } = await enterSalesFloor();
    const names = () =>
      within(board)
        .getAllByRole('button', { name: /見本の商談/ })
        .map((row) => row.textContent?.match(/見本の商談\d/)?.[0]);
    expect(names()).toEqual(['見本の商談2', '見本の商談3']);
    expect(within(board).getByRole('button', { name: /見本の商談2/ })).toHaveTextContent(
      '2026/11/10期限を過ぎています見本の次の行動2'
    );

    await user.keyboard('2');
    expect(names()).toEqual(['見本の商談1', '見本の商談3']);
    expect(within(board).getAllByText('決まっていません')).toHaveLength(2);

    await user.keyboard('3');
    expect(mocks.inputs.at(-1)).toMatchObject({ organizationId: ORG_ID, owner: 'mine' });
    expect(names()).toEqual(['見本の商談2']);

    await user.keyboard('4');
    expect(names()).toEqual(['見本の商談1', '見本の商談2', '見本の商談3', '見本の商談4']);
  });

  it('says so when there are no open deals', async () => {
    mocks.deals = [];
    const { board, office } = await enterSalesFloor();
    expect(within(office).getByText('開いている商談はありません。')).toBeInTheDocument();
    expect(within(board).getByText('今週中に動かす商談はありません。')).toBeInTheDocument();
  });

  it('shows no deals to who may not read them', async () => {
    mocks.mode = 'forbidden';
    const { board, office } = await enterSalesFloor();
    expect(within(office).getByText('ボードの数字を読めませんでした。')).toBeInTheDocument();
    expect(
      within(board).getByText('商談を見る権限がありません。管理者に確かめてください。')
    ).toBeInTheDocument();
    expect(within(board).queryByRole('button', { name: /見本の商談/ })).not.toBeInTheDocument();
  });

  it('leads to the pages the room does not hold yet, closing the office', async () => {
    mocks.truncated = true;
    const { board } = await enterSalesFloor();
    const pages = within(board).getByRole('navigation', { name: '通常の表示で開くページ' });
    const links = within(pages).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/ja/deals',
      '/ja/forecast',
      '/ja/prospects',
    ]);
    expect(within(board).getByText(/先頭の 500 件まで/)).toBeInTheDocument();
    // Following the link is the browser's; the office only has to close
    links[0].addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(links[0]);
    expect(mocks.left).toHaveBeenCalled();
  });

  it('says why a deal is listed for this week when it is its expected close date', async () => {
    const { board } = await enterSalesFloor();
    expect(within(board).getByRole('button', { name: /見本の商談3/ })).toHaveTextContent(
      '決まっていません受注予定 2026/11/15'
    );
    expect(within(board).getByRole('button', { name: /見本の商談2/ })).not.toHaveTextContent(
      '受注予定'
    );
  });

  it('does not report counts it cannot count when the board lists only a part of the deals', async () => {
    mocks.truncated = true;
    const { office } = await enterSalesFloor();
    const report = within(office).getByText(/開いている商談は 4 件/);
    expect(report).toHaveTextContent('通常の表示の商談で確かめてください');
    expect(report).not.toHaveTextContent('今週中に動かすものは 2 件');
  });

  it('moves over the rows with the arrow keys and opens the focused one with Enter', async () => {
    const { user, office, board } = await enterSalesFloor();
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(within(board).getByRole('button', { name: /見本の商談2/ }));
    await user.keyboard('{ArrowDown}{Enter}');
    expect(
      within(office).getByRole('region', { name: '「見本の商談3」の商談ファイル' })
    ).toBeInTheDocument();
  });
});

describe('a deal file on the sales floor', () => {
  beforeEach(() => {
    mocks.mode = 'ok';
    mocks.deals = [
      deal(1, { stage: 'qualification', probability: 10, leadSqlDecision: null }),
      deal(2, { nextTask: nextTask(2, '2026-11-10'), hasOpenTask: true }),
      deal(3, { stage: 'proposal', probability: 55, expectedCloseOn: '2026-11-15' }),
      deal(4, { stage: 'negotiation', probability: 70 }),
    ];
    mocks.mine = [];
    mocks.canEdit = true;
    mocks.truncated = false;
    mocks.fail = false;
    mocks.handedOff = false;
    mocks.moves.length = 0;
    mocks.marks.length = 0;
    mocks.added.length = 0;
    mocks.left.mockClear();
  });

  it('says where the deal stands and what comes next, from the board', async () => {
    const { office, file } = await openFile('見本の商談2');
    const report = within(office).getByText(/この商談は「課題の確認」の段にあります/);
    expect(report).toHaveTextContent(
      'この商談は「課題の確認」の段にあります（確度 20%）。次の行動は 2026/11/10 の「見本の次の行動2」です。'
    );
    expect(document.activeElement).toContainElement(report);
    const stages = within(file).getByRole('list', { name: '商談の段' });
    expect(within(stages).getByText('課題の確認').closest('li')).toHaveAttribute(
      'aria-current',
      'step'
    );
    expect(within(file).getByRole('link', { name: '通常の表示で商談を開く' })).toHaveAttribute(
      'href',
      `/ja/deals/${mocks.deals[1].id}`
    );
  });

  it('moves the deal on by one stage with its key; the same key moves nothing more', async () => {
    const { user, office } = await openFile('見本の商談2');
    expect(choice(office, /「提案」へ進める/)).toHaveTextContent('1');
    await user.keyboard('1');
    expect(mocks.moves).toEqual([
      { organizationId: ORG_ID, dealId: mocks.deals[1].id, stage: 'proposal' },
    ]);
    expect(
      within(office).getByText('「提案」に移しました（確度 40%）。間違えたときは、取り消せます。')
    ).toBeInTheDocument();
    // The file follows the board: the next stage is named now, and every answer but the undo is closed
    expect(choice(office, /「条件の調整」へ進める/)).toHaveAttribute('aria-disabled', 'true');
    await user.keyboard('112');
    expect(mocks.moves).toHaveLength(1);
  });

  it('takes a move back with Z: the stage and the probability the deal had', async () => {
    const { user, office } = await openFile('見本の商談3');
    await user.keyboard('2');
    expect(mocks.moves.at(-1)).toMatchObject({ stage: 'discovery' });
    await user.keyboard('z');
    expect(mocks.moves.at(-1)).toEqual({
      organizationId: ORG_ID,
      dealId: mocks.deals[2].id,
      stage: 'proposal',
      probability: 55,
    });
    expect(within(office).getByText('取り消しました。')).toBeInTheDocument();
    // After the undo the answers are open again
    expect(choice(office, /「条件の調整」へ進める/)).not.toHaveAttribute('aria-disabled');
    expect(within(office).queryByRole('button', { name: /いまのを取り消す/ })).not.toBeInTheDocument();
  });

  it('offers no undo for a move that handed the lead off, and says why', async () => {
    mocks.handedOff = true;
    const { user, office } = await openFile('見本の商談2');
    await user.keyboard('1');
    expect(within(office).getByText(/技術担当に引き継ぎ書を送りました。.*取り消せません/)).toBeInTheDocument();
    expect(within(office).queryByRole('button', { name: /いまのを取り消す/ })).not.toBeInTheDocument();
    await user.keyboard('z');
    expect(mocks.moves).toHaveLength(1);
  });

  it('asks for the SQL decision before the deal leaves 見極め, and no number key answers it', async () => {
    const { user, office } = await openFile('見本の商談1');
    await user.keyboard('1');
    expect(mocks.moves).toHaveLength(0);
    const question = within(office).getByText(
      '「課題の確認」に進める前に、初回ヒアリングの結果からリード「見本商事1」の SQL判定を記録してください。'
    );
    // The question holds the focus, not an answer
    expect(document.activeElement).toBe(question);
    await user.keyboard('1234z{Enter}');
    expect(mocks.moves).toHaveLength(0);
    expect(within(office).getByRole('link', { name: /不適格：商談のページで失注にする/ })).toHaveAttribute(
      'href',
      `/ja/deals/${mocks.deals[0].id}`
    );

    await user.click(choice(office, /適格：「課題の確認」へ進める/));
    expect(mocks.moves).toEqual([
      {
        organizationId: ORG_ID,
        dealId: mocks.deals[0].id,
        stage: 'discovery',
        sqlDecision: 'qualified',
      },
    ]);
    expect(within(office).getByText(/「課題の確認」に移しました（確度 20%）/)).toBeInTheDocument();
    // The undo puts the stage back and sends no SQL decision
    await user.keyboard('z');
    expect(mocks.moves.at(-1)).toEqual({
      organizationId: ORG_ID,
      dealId: mocks.deals[0].id,
      stage: 'qualification',
      probability: 10,
    });
  });

  it('closes the SQL question with Esc and stays in the file', async () => {
    const { user, office, file } = await openFile('見本の商談1');
    await user.keyboard('1{Escape}');
    expect(within(office).queryByText(/SQL判定を記録してください/)).not.toBeInTheDocument();
    expect(file).toBeInTheDocument();
    expect(choice(office, /「課題の確認」へ進める/)).not.toHaveAttribute('aria-disabled');
    expect(mocks.moves).toHaveLength(0);
  });

  it('does not move a deal on from the last open stage: a win is recorded on the deal’s page', async () => {
    const { user, office } = await openFile('見本の商談4');
    expect(choice(office, /次の段へ進める（受注は商談のページで）/)).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    await user.keyboard('1');
    expect(mocks.moves).toHaveLength(0);
  });

  it('marks the next action as done with its key, and reopens it with Z', async () => {
    const { user, office } = await openFile('見本の商談2');
    await user.keyboard('3');
    const taskId = (mocks.deals[1].nextTask as { id: string }).id;
    expect(mocks.marks).toEqual([{ organizationId: ORG_ID, id: taskId, done: true }]);
    expect(
      within(office).getByText(
        '次の行動「見本の次の行動2」を済みにしました。間違えたときは、取り消せます。'
      )
    ).toBeInTheDocument();
    await user.keyboard('3');
    expect(mocks.marks).toHaveLength(1);
    await user.keyboard('Z');
    expect(mocks.marks.at(-1)).toEqual({ organizationId: ORG_ID, id: taskId, done: false });
  });

  it('takes the answers of one sitting: mark the next action, set a new one, move the deal on', async () => {
    const { user, office } = await openFile('見本の商談2');
    await user.keyboard('3');
    expect(mocks.marks).toHaveLength(1);
    await user.keyboard('4');
    await user.keyboard('提案書を送る{Enter}');
    expect(mocks.added).toHaveLength(1);
    // The report holds the focus once the field is gone, and the new one is not marked by a key
    expect(document.activeElement).toContainElement(
      within(office).getByText(/次の行動「提案書を送る」を、期限 2026\/11\/14 で決めました。/)
    );
    await user.keyboard('3');
    expect(mocks.marks).toHaveLength(1);
    await user.keyboard('1');
    expect(mocks.moves).toEqual([
      { organizationId: ORG_ID, dealId: mocks.deals[1].id, stage: 'proposal' },
    ]);
    // Z takes back the last answer: the move
    await user.keyboard('z');
    expect(mocks.moves.at(-1)).toMatchObject({ stage: 'discovery', probability: 20 });
    expect(mocks.marks).toHaveLength(1);
  });

  it('says what is missing when a next action is sent without it', async () => {
    const { user, office } = await openFile('見本の商談3');
    await user.keyboard('4');
    await user.keyboard('{Enter}');
    expect(within(office).getByRole('alert')).toHaveTextContent(
      '次にすることと、期限の日付を入れてください。'
    );
    expect(mocks.added).toHaveLength(0);
  });

  it('keeps an answer in hand when its undo fails, to be undone again', async () => {
    const { user, office } = await openFile('見本の商談2');
    await user.keyboard('3');
    mocks.fail = true;
    await user.keyboard('z');
    expect(
      within(office).getByText('取り消せませんでした。変更は残っています。もう一度お願いします。')
    ).toBeInTheDocument();
    mocks.fail = false;
    await user.keyboard('z');
    expect(mocks.marks.at(-1)).toMatchObject({ done: false });
    expect(within(office).getByText('取り消しました。')).toBeInTheDocument();
  });

  it('sets a next action in a field, where the number keys are what is typed', async () => {
    const { user, office } = await openFile('見本の商談3');
    expect(choice(office, /次の行動を済みにする/)).toHaveAttribute('aria-disabled', 'true');
    await user.keyboard('4');
    const what = within(office).getByLabelText('次にすること（必須）');
    expect(document.activeElement).toBe(what);
    expect(within(office).getByLabelText('期限（必須）')).toHaveValue('2026-11-14');
    await user.keyboard('123 見積を送る{Enter}');
    expect(mocks.moves).toHaveLength(0);
    expect(mocks.added).toEqual([
      {
        organizationId: ORG_ID,
        leadId: mocks.deals[2].leadId,
        title: '123 見積を送る',
        dueOn: '2026-11-14',
        dealId: mocks.deals[2].id,
      },
    ]);
    expect(
      within(office).getByText(/次の行動「123 見積を送る」を、期限 2026\/11\/14 で決めました。/)
    ).toBeInTheDocument();
    expect(within(office).queryByLabelText('次にすること（必須）')).not.toBeInTheDocument();
  });

  it('keeps what was typed and says so when a next action could not be saved', async () => {
    const { user, office } = await openFile('見本の商談3');
    await user.keyboard('4');
    mocks.fail = true;
    await user.keyboard('見積を送る{Enter}');
    expect(within(office).getByLabelText('次にすること（必須）')).toHaveValue('見積を送る');
  });

  it('goes back one step with Esc: the field, the file, the room', async () => {
    const { user, office, board } = await openFile('見本の商談3');
    await user.keyboard('4');
    await user.keyboard('{Escape}');
    expect(within(office).queryByLabelText('次にすること（必須）')).not.toBeInTheDocument();
    expect(
      within(office).getByRole('region', { name: '「見本の商談3」の商談ファイル' })
    ).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(board).not.toBeInTheDocument();
    const again = within(office).getByRole('region', { name: '商談ボード' });
    // The focus is back on the row the file was opened from
    expect(document.activeElement).toBe(within(again).getByRole('button', { name: /見本の商談3/ }));
    await user.keyboard('{Escape}');
    expect(within(office).getByRole('navigation', { name: 'フロア案内' })).toBeInTheDocument();
  });

  it('shows the file without the answers to who may not change deals', async () => {
    mocks.canEdit = false;
    const { user, office } = await openFile('見本の商談2');
    expect(within(office).getByText('商談を変える権限がありません。')).toBeInTheDocument();
    expect(within(office).queryByRole('button', { name: /へ進める/ })).not.toBeInTheDocument();
    await user.keyboard('123');
    expect(mocks.moves).toHaveLength(0);
    expect(mocks.marks).toHaveLength(0);
    expect(choice(office, /ボードに戻る/)).toHaveTextContent('Esc');
  });

  it('says so when a move did not go through, and leaves the deal where it was', async () => {
    mocks.fail = true;
    const { user, office } = await openFile('見本の商談2');
    await user.keyboard('1');
    expect(
      within(office).getByText(
        'すみません、うまくいきませんでした。時間をおいて、もう一度お願いします。'
      )
    ).toBeInTheDocument();
    expect(choice(office, /「提案」へ進める/)).not.toHaveAttribute('aria-disabled');
  });
});
