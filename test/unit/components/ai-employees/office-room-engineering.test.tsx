/**
 * The engineering room of the full-screen office (#1194): the survey deals as the room's wall
 * board, and the preparation file of a deal's lead (the latest hearing and the prep card) opened
 * inside the room. The room only reads. Real next-intl messages; tRPC mocked.
 */
import { OfficeImmersive } from '@/components/features/ai-employees/office-immersive';
import { DEFAULT_AI_EMPLOYEE_PROFILE } from '@/lib/features/ai-employees/types/profile';
import { MESSAGE_FILES, mergeMessageFiles } from '@/lib/i18n/messages';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const HEARING_ID = '00000000-0000-4000-8000-0000000000b1';

const deal = (n: number, stage: string, over: Partial<Record<string, unknown>> = {}) => ({
  id: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`,
  leadId: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`,
  name: `見本の現行調査${n}`,
  kind: 'survey',
  stage,
  company: `見本商事${n}`,
  leadName: `見本 ${n}郎`,
  ownerName: '担当 花子',
  stageChangedAt: new Date(),
  nextTask: { id: `t${n}`, title: `見本の次の行動${n}`, dueOn: '2026-11-20' },
  hasOpenTask: true,
  ...over,
});

const columnsOf = (deals: ReturnType<typeof deal>[]) =>
  ['qualification', 'discovery', 'proposal', 'negotiation', 'won', 'lost'].map((stage) => {
    const own = deals.filter((entry) => entry.stage === stage);
    return { stage, count: own.length, amount: 0, weightedAmount: 0, deals: own };
  });

type Mode = 'ok' | 'forbidden' | 'error' | 'loading';

const mocks = vi.hoisted(() => ({
  boardInputs: [] as unknown[],
  summaryInputs: [] as { input: unknown; enabled: boolean }[],
  scopes: [] as unknown[],
  board: 'ok' as 'ok' | 'forbidden' | 'error' | 'loading',
  deals: [] as unknown[],
  truncated: false,
  latestHearing: null as { id: string; heldOn: string } | null,
  handedOffOn: null as string | null,
  hearing: 'ok' as 'ok' | 'forbidden' | 'error' | 'loading',
  card: null as unknown,
  canEdit: true,
  draftSource: null as unknown,
  saves: [] as { organizationId: string; leadId: string; card: Record<string, unknown> }[],
  saving: false,
  failSave: false,
  refreshed: vi.fn(),
}));

const answer = (mode: Mode, data: unknown) =>
  mode === 'loading'
    ? { data: undefined, error: null, isError: false, isFetching: true }
    : mode === 'ok'
      ? { data, error: null, isError: false, isFetching: false }
      : {
          data: undefined,
          error: { data: { code: mode === 'forbidden' ? 'FORBIDDEN' : 'INTERNAL' } },
          isError: true,
          isFetching: false,
        };

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      aiEmployees: { office: { invalidate: vi.fn() } },
      leadPrep: { get: { invalidate: mocks.refreshed } },
    }),
    aiEmployees: {
      hire: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
      update: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
    },
    deals: {
      board: {
        useQuery: (input: unknown) => {
          mocks.boardInputs.push(input);
          return answer(mocks.board, {
            columns: columnsOf(mocks.deals as ReturnType<typeof deal>[]),
            truncated: mocks.truncated,
            today: '2026-11-14',
            canEdit: true,
            canDelete: true,
          });
        },
      },
    },
    leadHandoff: {
      get: {
        useQuery: (input: unknown) => {
          mocks.scopes.push(input);
          return answer('ok', {
            lead: {
              name: null,
              company: null,
              dealPhase: null,
              handedOffOn: mocks.handedOffOn,
              assigneeName: null,
            },
            latestHearing: mocks.latestHearing,
          });
        },
      },
    },
    leadHearings: {
      summary: {
        useQuery: (input: unknown, options: { enabled: boolean }) => {
          mocks.summaryInputs.push({ input, enabled: options.enabled });
          if (!options.enabled) {
            return { data: undefined, error: null, isError: false, isFetching: false };
          }
          return answer(mocks.hearing, {
            id: HEARING_ID,
            leadId: 'lead',
            previousId: null,
            summary: {
              heldOn: '2026-11-10',
              lead: null,
              sections: [
                {
                  id: 'currentSystem',
                  title: '現状',
                  items: [
                    {
                      key: 'targetSystem',
                      label: '見本の項目A',
                      value: '見本の値A',
                      status: 'answered',
                      source: null,
                      required: true,
                      flags: { unconfirmed: false, next: false, missing: false, changed: true },
                    },
                    {
                      key: 'scale',
                      label: '見本の項目B',
                      value: null,
                      status: 'empty',
                      source: null,
                      required: true,
                      flags: { unconfirmed: false, next: false, missing: true, changed: false },
                    },
                  ],
                },
              ],
              unconfirmed: [{ key: 'u', label: 'u', section: 's' }],
              next: [],
              missing: [
                { key: 'scale', label: '見本の項目B', section: 's' },
                { key: 'm2', label: 'm2', section: 's' },
              ],
              previousHeldOn: null,
              changedSincePrevious: [],
            },
          });
        },
      },
    },
    leadPrep: {
      get: {
        useQuery: () =>
          answer('ok', {
            card: mocks.card,
            canEdit: mocks.canEdit,
            draftSource: mocks.canEdit ? mocks.draftSource : null,
          }),
      },
      save: {
        useMutation: (hook: { onSuccess?: () => void } = {}) => ({
          isPending: mocks.saving,
          mutate: (
            input: { organizationId: string; leadId: string; card: Record<string, unknown> },
            options: { onSuccess?: () => void; onError?: () => void } = {}
          ) => {
            mocks.saves.push(input);
            if (mocks.failSave) {
              options.onError?.();
              return;
            }
            // The server now holds what was saved
            mocks.card = { ...input.card, updatedAt: new Date(), updatedByName: null };
            hook.onSuccess?.();
            options.onSuccess?.();
          },
        }),
      },
    },
  },
}));

const messages = mergeMessageFiles(MESSAGE_FILES.ja);

async function enterRoom(deskStatus: 'vacant' | 'idle' | 'training' = 'vacant') {
  const user = userEvent.setup();
  const onExit = vi.fn();
  const employees =
    deskStatus === 'vacant'
      ? []
      : [
          {
            id: '770e8400-e29b-41d4-a716-446655440004',
            role: 'engineer' as const,
            name: 'AIエンジニア',
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
  await user.keyboard('4');
  const board = within(office).getByRole('region', { name: '現行調査ボード' });
  return { user, office, board, onExit };
}

const rowNames = (board: HTMLElement) =>
  Array.from(board.querySelectorAll('[data-deal-row]')).map(
    (row) => row.querySelector('span span')?.textContent
  );

describe('the engineering room', () => {
  beforeEach(() => {
    mocks.boardInputs.length = 0;
    mocks.summaryInputs.length = 0;
    mocks.scopes.length = 0;
    mocks.board = 'ok';
    mocks.truncated = false;
    mocks.deals = [
      deal(1, 'qualification'),
      deal(2, 'proposal', { nextTask: null, hasOpenTask: false }),
      deal(3, 'discovery'),
      deal(4, 'won'),
    ];
    mocks.latestHearing = { id: HEARING_ID, heldOn: '2026-11-10' };
    mocks.handedOffOn = '2026-11-12';
    mocks.hearing = 'ok';
    mocks.canEdit = true;
    mocks.draftSource = null;
    mocks.saves.length = 0;
    mocks.saving = false;
    mocks.failSave = false;
    mocks.refreshed.mockClear();
    mocks.card = {
      estimatedSystem: '見本のシステム',
      estimatedSystemBasis: '見本の根拠',
      recentNews: null,
      hypotheses: { cost: '見本の仮説' },
      firstQuestions: ['見本の質問1', '見本の質問2'],
      updatedAt: new Date(),
      updatedByName: null,
    };
  });

  it('is entered with the key 4, and reads the organization’s surveys from the deals API', async () => {
    const { office, board } = await enterRoom();
    expect(within(office).getByRole('heading', { name: '現行調査' })).toBeInTheDocument();
    expect(mocks.boardInputs.at(-1)).toEqual({
      organizationId: ORG_ID,
      owner: 'all',
      kinds: ['survey'],
      closedWithinDays: 0,
    });
    // The open deals in the order of the pipeline; the won one is not on the board
    expect(rowNames(board)).toEqual(['見本商事1', '見本商事3', '見本商事2']);
    expect(within(board).getByText('未定')).toBeInTheDocument();
  });

  it('reports the figures of the board, and says who holds the room', async () => {
    const { office } = await enterRoom('idle');
    expect(
      within(office).getByText(
        '進行中の現行調査は 3 件です。提案の段にあるものは 1 件、次の行動が決まっていないものは 1 件あります。'
      )
    ).toBeInTheDocument();
    expect(within(office).getByText('AIエンジニアが、この部屋を受け持っています。')).toBeInTheDocument();
  });

  it('does not say what it counts from the listed deals when the board is cut at its limit', async () => {
    mocks.truncated = true;
    const { office, board } = await enterRoom();
    expect(
      within(office).getByText(
        '進行中の現行調査は 3 件です。提案の段にあるものは 1 件あります。商談が多く、ボードには一部しか出せないため、次の行動が決まっていないものの件数は、通常の表示の商談で確かめてください。'
      )
    ).toBeInTheDocument();
    expect(
      within(board).getByText(
        '商談が多いため、ボードには先頭の 500 件までを出しています。段ごとの件数は、すべての商談を数えています。'
      )
    ).toBeInTheDocument();
  });

  it('does not put words in the mouth of an engineer that is not hired or in training', async () => {
    const vacant = await enterRoom('vacant');
    expect(
      within(vacant.office).getByText('エンジニアは空席です。数字は記録から読み上げています。')
    ).toBeInTheDocument();
  });

  it('switches the view with the number keys, and goes back to the floor with Esc', async () => {
    const { user, office, board } = await enterRoom();
    await user.keyboard('4');
    expect(rowNames(board)).toEqual(['見本商事2']);
    expect(
      within(office).getByRole('button', { name: /提案の段のものを見せて/ })
    ).toHaveAttribute('aria-pressed', 'true');
    await user.keyboard('5');
    expect(within(board).getByText('この絞り込みに当たる現行調査の商談はありません。')).toBeInTheDocument();
    await user.keyboard('1');
    expect(rowNames(board)).toHaveLength(3);
    await user.keyboard('{Escape}');
    expect(within(office).queryByRole('region', { name: '現行調査ボード' })).not.toBeInTheDocument();
    expect(within(office).getByRole('navigation', { name: 'フロア案内' })).toBeInTheDocument();
  });

  it('moves over the rows with the arrow keys and turns the pages', async () => {
    mocks.deals = Array.from({ length: 10 }, (_entry, index) => deal(index + 1, 'qualification'));
    const { user, board } = await enterRoom();
    expect(rowNames(board)).toHaveLength(8);
    await user.keyboard('{ArrowDown}');
    expect(board.querySelectorAll('[data-deal-row]')[0]).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(rowNames(board)).toEqual(['見本商事9', '見本商事10']);
    expect(within(board).getByText('2 / 2')).toBeInTheDocument();
    await user.keyboard('{ArrowRight}');
    expect(within(board).getByText('2 / 2')).toBeInTheDocument();
    await user.keyboard('{ArrowLeft}');
    expect(within(board).getByText('1 / 2')).toBeInTheDocument();
  });

  it('ignores the keys of a Japanese conversion', async () => {
    const { office, board } = await enterRoom();
    fireEvent.keyDown(office, { key: '4', isComposing: true });
    expect(rowNames(board)).toHaveLength(3);
  });

  it('says so when the deals may not be read or cannot be read', async () => {
    mocks.board = 'forbidden';
    const forbidden = await enterRoom();
    expect(
      within(forbidden.board).getByText('商談を見る権限がありません。管理者に確かめてください。')
    ).toBeInTheDocument();
    expect(within(forbidden.office).getByText('ボードの数字を読めませんでした。')).toBeInTheDocument();
  });

  it('opens the preparation file of a row inside the room: the hearing, then the prep card', async () => {
    const { user, office, board, onExit } = await enterRoom();
    await user.click(board.querySelectorAll<HTMLElement>('[data-deal-row]')[0]);
    const file = within(office).getByRole('region', { name: '見本商事1の準備ファイル' });
    // The records of the deal's lead, scoped to the organization
    expect(mocks.scopes.at(-1)).toEqual({
      organizationId: ORG_ID,
      leadId: '00000000-0000-4000-8000-000000000101',
    });
    expect(mocks.summaryInputs.at(-1)).toEqual({
      input: { organizationId: ORG_ID, id: HEARING_ID, locale: 'ja' },
      enabled: true,
    });
    expect(
      within(office).getByText(
        '最新のヒアリングは 2026/11/10 の記録です。必須でまだ埋まっていない項目は 2 件、未確認は 1 件、次回に確かめる項目は 0 件です。'
      )
    ).toBeInTheDocument();
    expect(within(office).getByText('初回商談の事前調査カードは、用意されています。')).toBeInTheDocument();
    expect(
      within(office).getByText('2026/11/12 に初回ヒアリングから次の段階へ進み、引き継ぎ書ができています。')
    ).toBeInTheDocument();
    expect(within(file).getByText('見本の値A')).toBeInTheDocument();
    expect(within(file).getByText('前回から変更')).toBeInTheDocument();
    expect(within(file).getByText('必須・未入力')).toBeInTheDocument();

    await user.keyboard('2');
    expect(within(file).getByText('見本のシステム')).toBeInTheDocument();
    expect(within(file).getByText('見本の質問2')).toBeInTheDocument();
    expect(within(file).queryByText('見本の値A')).not.toBeInTheDocument();

    expect(within(file).getByRole('link', { name: '商談の画面で開く' })).toHaveAttribute(
      'href',
      '/ja/deals/00000000-0000-4000-8000-000000000001'
    );
    expect(within(file).getByRole('link', { name: '引き継ぎ書を開く' })).toHaveAttribute(
      'href',
      '/ja/leads/00000000-0000-4000-8000-000000000101/handoff'
    );

    // Esc closes the file, not the room; the row it was opened from has the focus again
    await user.keyboard('{Escape}');
    const back = within(office).getByRole('region', { name: '現行調査ボード' });
    expect(back.querySelectorAll('[data-deal-row]')[0]).toHaveFocus();
    expect(onExit).not.toHaveBeenCalled();
  });

  it('says what is not there instead of showing an empty file', async () => {
    mocks.latestHearing = null;
    mocks.handedOffOn = null;
    mocks.card = {
      estimatedSystem: null,
      estimatedSystemBasis: null,
      recentNews: null,
      hypotheses: {},
      firstQuestions: [],
      updatedAt: new Date(),
      updatedByName: null,
    };
    const { user, office, board } = await enterRoom();
    await user.click(board.querySelectorAll<HTMLElement>('[data-deal-row]')[0]);
    const file = within(office).getByRole('region', { name: '見本商事1の準備ファイル' });
    // No hearing: its summary is never asked for
    expect(mocks.summaryInputs.every((entry) => !entry.enabled)).toBe(true);
    expect(within(office).getByText('ヒアリングは、まだ記録されていません。')).toBeInTheDocument();
    expect(
      within(office).getByText('初回商談の事前調査カードは、まだ用意されていません。')
    ).toBeInTheDocument();
    expect(within(office).getByText('まだ初回ヒアリングから先へ進んでいません。')).toBeInTheDocument();
    expect(within(file).queryByRole('link', { name: '引き継ぎ書を開く' })).not.toBeInTheDocument();
    await user.keyboard('2');
    expect(
      within(file).getByText('事前調査カードは、まだ書かれていません。リードの画面で用意できます。')
    ).toBeInTheDocument();
  });

  it('says so when the hearing may not be read', async () => {
    mocks.hearing = 'forbidden';
    const { user, office, board } = await enterRoom();
    await user.click(board.querySelectorAll<HTMLElement>('[data-deal-row]')[0]);
    const file = within(office).getByRole('region', { name: '見本商事1の準備ファイル' });
    expect(
      within(file).getByText('ヒアリングを見る権限がありません。管理者に確かめてください。')
    ).toBeInTheDocument();
    expect(within(office).getByText('ヒアリングの記録を読めませんでした。')).toBeInTheDocument();
  });
  describe('the draft of the prep card (#1212)', () => {
    const SOURCE = {
      targetSystem: 'as400',
      targetSystemFrom: 'diagnosis',
      primaryChallenge: 'cost',
      challenges: ['cost', 'people'],
      urgencyReasons: [],
      difficultyReasons: [],
      playbookQuestions: { cost: ['見本の手引きの質問1', '見本の手引きの質問2'] },
    };
    const openFile = async () => {
      const room = await enterRoom();
      await room.user.click(room.board.querySelectorAll<HTMLElement>('[data-deal-row]')[0]);
      const file = within(room.office).getByRole('region', { name: '見本商事1の準備ファイル' });
      return { ...room, file };
    };

    beforeEach(() => {
      mocks.draftSource = SOURCE;
      // Somebody wrote the hypothesis on cost; the rest is empty
      mocks.card = {
        estimatedSystem: null,
        estimatedSystemBasis: null,
        recentNews: null,
        hypotheses: { cost: '人が書いた仮説' },
        firstQuestions: [],
        updatedAt: new Date(),
        updatedByName: null,
      };
    });

    it('fills the empty fields with the key 3, saves the card of the lead and keeps what was written', async () => {
      const { user, office, file } = await openFile();
      await user.keyboard('3');
      expect(mocks.saves).toHaveLength(1);
      const saved = mocks.saves[0];
      expect(saved.organizationId).toBe(ORG_ID);
      expect(saved.leadId).toBe('00000000-0000-4000-8000-000000000101');
      expect(saved.card.hypotheses).toMatchObject({ cost: '人が書いた仮説' });
      expect((saved.card.hypotheses as Record<string, string>).people).toBeTruthy();
      expect(saved.card.estimatedSystem).toBeTruthy();
      expect(saved.card.firstQuestions).toEqual(['見本の手引きの質問1', '見本の手引きの質問2']);
      expect(mocks.refreshed).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        leadId: '00000000-0000-4000-8000-000000000101',
      });
      // The file turns to the card, and the report (which has the focus) says what was done
      expect(within(file).getByText('見本の手引きの質問2')).toBeInTheDocument();
      const report = within(office).getByText(/下書きを入れて保存しました/);
      expect(report.parentElement).toHaveFocus();
      // It is the president's answer, not the work of the AI engineer
      expect(within(office).queryByText(/エンジニアが.*(用意|下書き)/)).not.toBeInTheDocument();
    });

    it('takes the draft once: the same key pressed again saves nothing', async () => {
      const { user, office } = await openFile();
      await user.keyboard('3');
      await user.keyboard('3');
      expect(mocks.saves).toHaveLength(1);
      expect(
        within(office).getByRole('button', { name: /事前調査カードの下書きを用意して/ })
      ).toHaveAttribute('aria-disabled', 'true');
    });

    it('undoes the draft with Z: the card is saved back as it was read', async () => {
      const { user, office, file } = await openFile();
      expect(within(office).queryByRole('button', { name: /いまの下書きを取り消す/ })).toBeNull();
      await user.keyboard('3');
      await user.keyboard('z');
      expect(mocks.saves).toHaveLength(2);
      expect(mocks.saves[1].card).toEqual({
        estimatedSystem: null,
        estimatedSystemBasis: null,
        recentNews: null,
        hypotheses: { cost: '人が書いた仮説' },
        firstQuestions: [],
      });
      expect(
        within(office).getByText('下書きを取り消し、事前調査カードを元に戻しました。')
      ).toBeInTheDocument();
      expect(within(file).queryByText('見本の手引きの質問2')).not.toBeInTheDocument();
      // Undone, the draft can be asked for again
      await user.keyboard('3');
      expect(mocks.saves).toHaveLength(3);
    });

    it('drafts and undoes for a lead without a card: the card is empty again, which the file shows as none', async () => {
      mocks.card = null;
      const { user, office, file } = await openFile();
      expect(
        within(office).getByText('初回商談の事前調査カードは、まだ用意されていません。')
      ).toBeInTheDocument();
      await user.keyboard('3');
      expect(within(file).getByText('見本の手引きの質問1')).toBeInTheDocument();
      await user.keyboard('z');
      expect(mocks.saves[1].card).toEqual({
        estimatedSystem: null,
        estimatedSystemBasis: null,
        recentNews: null,
        hypotheses: {},
        firstQuestions: [],
      });
      expect(
        within(office).getByText('初回商談の事前調査カードは、まだ用意されていません。')
      ).toBeInTheDocument();
    });

    it('does not undo over a card somebody changed after the draft', async () => {
      const { user, office } = await openFile();
      await user.keyboard('3');
      // Somebody edits the card on the lead's page; the file reads it again (turning to the
      // other part draws the file anew)
      mocks.card = { ...(mocks.card as object), recentNews: 'あとから人が書いた動き' };
      await user.keyboard('1');
      expect(within(office).getByText(/下書きのあとに、事前調査カードが書き換えられました/)).toBeInTheDocument();
      expect(
        within(office).getByRole('button', { name: /いまの下書きを取り消す/ })
      ).toHaveAttribute('aria-disabled', 'true');
      await user.keyboard('z');
      expect(mocks.saves).toHaveLength(1);
    });

    it('keeps the undo open when it did not go through', async () => {
      const { user, office } = await openFile();
      await user.keyboard('3');
      mocks.failSave = true;
      await user.keyboard('z');
      expect(
        within(office).getByText(
          '取り消せませんでした。下書きは保存されたままです。もう一度、取り消せます。'
        )
      ).toBeInTheDocument();
      mocks.failSave = false;
      await user.keyboard('z');
      expect(
        within(office).getByText('下書きを取り消し、事前調査カードを元に戻しました。')
      ).toBeInTheDocument();
    });

    it('says so when the draft could not be saved, and saves nothing more by itself', async () => {
      mocks.failSave = true;
      const { user, office } = await openFile();
      await user.keyboard('3');
      expect(
        within(office).getByText(
          'すみません、うまくいきませんでした。時間をおいて、もう一度お願いします。'
        )
      ).toBeInTheDocument();
      expect(within(office).queryByRole('button', { name: /いまの下書きを取り消す/ })).toBeNull();
    });

    it('does not offer the draft to someone who may not change the card', async () => {
      mocks.canEdit = false;
      const { user, office } = await openFile();
      expect(
        within(office).queryByRole('button', { name: /事前調査カードの下書きを用意して/ })
      ).toBeNull();
      await user.keyboard('3');
      expect(mocks.saves).toHaveLength(0);
    });

    it('closes the draft and says why when there is nothing to draft from or nothing to fill', async () => {
      mocks.draftSource = {
        ...SOURCE,
        targetSystem: null,
        targetSystemFrom: null,
        primaryChallenge: null,
        challenges: [],
        playbookQuestions: {},
      };
      const none = await openFile();
      expect(
        within(none.office).getByText(
          '下書きにできる材料（Web診断の回答・営業の手引き）が、このお客様にはありません。'
        )
      ).toBeInTheDocument();
      await none.user.keyboard('3');
      expect(mocks.saves).toHaveLength(0);
    });

    it('says that no empty field is left when the card is already filled', async () => {
      mocks.card = {
        estimatedSystem: '見本のシステム',
        estimatedSystemBasis: '見本の根拠',
        recentNews: null,
        hypotheses: { cost: '人が書いた仮説', people: '人が書いた仮説2' },
        firstQuestions: ['見本の質問'],
        updatedAt: new Date(),
        updatedByName: null,
      };
      const { user, office } = await openFile();
      expect(
        within(office).getByText('下書きで埋められる空欄は、事前調査カードにありません。')
      ).toBeInTheDocument();
      await user.keyboard('3');
      expect(mocks.saves).toHaveLength(0);
    });

    it('keeps the file open while the card is being saved: Esc and the way back are closed', async () => {
      mocks.saving = true;
      const { user, office } = await openFile();
      await user.keyboard('{Escape}');
      expect(
        within(office).getByRole('region', { name: '見本商事1の準備ファイル' })
      ).toBeInTheDocument();
      const back = within(office).getByRole('button', { name: /ボードに戻る/ });
      expect(back).toHaveAttribute('aria-disabled', 'true');
      await user.click(back);
      expect(
        within(office).getByRole('region', { name: '見本商事1の準備ファイル' })
      ).toBeInTheDocument();
      // Nothing is taken while it saves
      await user.keyboard('3');
      expect(mocks.saves).toHaveLength(0);
    });
  });
});
