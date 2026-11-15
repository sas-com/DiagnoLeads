/**
 * Pre-meeting prep card on the lead page (#156): an empty card, the draft into the empty fields,
 * what is saved, the "ready" mark and read-only viewers. Made-up names and questions.
 */
import { LeadPrepCard } from '@/components/features/lead-prep/lead-prep-card';
import messages from '@/locales/ja/common.json';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  result: {} as Record<string, unknown>,
  mutate: vi.fn(),
  invalidate: vi.fn(),
  server: undefined as unknown,
  refetches: 0,
  pending: false,
  // What the card gave the mutation: called to answer a save
  hook: {} as { onSuccess?: () => void; onError?: (error: { data?: { code?: string } }) => void },
}));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({ leadPrep: { get: { invalidate: mocks.invalidate } } }),
    leadPrep: {
      get: {
        // Reading the card again hands back what the server holds (`server`), which is the
        // screen's copy unless a test says somebody saved the card meanwhile
        useQuery: () => ({
          refetch: async () => {
            mocks.refetches += 1;
            return { isSuccess: true, data: mocks.server ?? mocks.result.data };
          },
          ...mocks.result,
        }),
      },
      save: {
        useMutation: (options: typeof mocks.hook) => {
          mocks.hook = options;
          return { mutate: mocks.mutate, isPending: mocks.pending };
        },
      },
    },
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '770e8400-e29b-41d4-a716-446655440000';

const draftSource = {
  targetSystem: 'as400',
  targetSystemFrom: 'diagnosis',
  primaryChallenge: 'people',
  challenges: ['people'],
  urgencyReasons: [],
  difficultyReasons: [],
  playbookQuestions: { people: ['手引きの質問1', '手引きの質問2', '手引きの質問3'] },
};

const renderCard = () =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <LeadPrepCard organizationId={ORG_ID} leadId={LEAD_ID} />
    </NextIntlClientProvider>
  );

/** Press a button that reads the card before the screen changes (編集・準備を始める・読み込む) */
const press = async (name: string) => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
};

beforeEach(() => {
  mocks.mutate.mockReset();
  mocks.invalidate.mockReset();
  mocks.server = undefined;
  mocks.refetches = 0;
  mocks.pending = false;
  mocks.result = { data: { card: null, canEdit: true, draftSource }, isError: false };
});

describe('LeadPrepCard', () => {
  it('drafts into the empty fields and saves the card', async () => {
    renderCard();
    expect(screen.getByText(/まだ準備していません/)).toBeInTheDocument();
    await press('準備を始める');
    fireEvent.change(screen.getByLabelText('最近の動き'), { target: { value: '新工場を建設中' } });
    fireEvent.click(screen.getByRole('button', { name: '下書きを作る' }));

    expect(screen.getByLabelText('推定した基幹システム')).toHaveValue('AS/400');
    expect(screen.getByLabelText('質問 1')).toHaveValue('手引きの質問1');
    // What sales typed stays
    expect(screen.getByLabelText('最近の動き')).toHaveValue('新工場を建設中');

    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(mocks.mutate).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      leadId: LEAD_ID,
      card: expect.objectContaining({
        estimatedSystem: 'AS/400',
        estimatedSystemBasis: 'Web診断の回答（移行元）',
        recentNews: '新工場を建設中',
        firstQuestions: ['手引きの質問1', '手引きの質問2', '手引きの質問3'],
      }),
      // No card was there when the editing started
      expectedUpdatedAt: null,
    });
  });

  const SAVED_AT = new Date('2026-10-18T01:00:00Z');
  const savedCard = {
    estimatedSystem: 'AS/400',
    estimatedSystemBasis: null,
    recentNews: null,
    hypotheses: {},
    firstQuestions: ['質問A'],
    updatedAt: SAVED_AT,
    updatedByName: '営業 太郎',
  };

  it('saves with the date the card had when the editing started, not a later one (#1225)', async () => {
    mocks.result = { data: { card: savedCard, canEdit: true, draftSource }, isError: false };
    const { rerender } = renderCard();
    await press('編集');
    // The card is read again while the form is open (the office saved it): a newer date arrives
    mocks.result = {
      data: {
        card: { ...savedCard, recentNews: '開発室の下書き', updatedAt: new Date('2026-10-18T02:00:00Z') },
        canEdit: true,
        draftSource,
      },
      isError: false,
    };
    rerender(
      <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
        <LeadPrepCard organizationId={ORG_ID} leadId={LEAD_ID} />
      </NextIntlClientProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ expectedUpdatedAt: SAVED_AT })
    );
  });

  it('keeps what was typed when somebody else saved first, and reads the card again on request (#1225)', async () => {
    const latest = {
      ...savedCard,
      recentNews: '同僚が書いた動き',
      updatedAt: new Date('2026-10-18T02:00:00Z'),
    };
    const refetch = vi.fn(async () => ({
      isSuccess: true,
      data: { card: latest, canEdit: true, draftSource },
    }));
    mocks.result = {
      data: { card: savedCard, canEdit: true, draftSource },
      isError: false,
      refetch,
    };
    renderCard();
    await press('編集');
    fireEvent.change(screen.getByLabelText('最近の動き'), { target: { value: '自分が書いた動き' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    act(() => mocks.hook.onError?.({ data: { code: 'CONFLICT' } }));

    // The form stays open with what was typed, and says what happened
    const notice = screen.getByRole('alert');
    expect(notice).toHaveTextContent('保存できませんでした。このカードは、編集を始めたあとに保存されています');
    expect(notice).toHaveTextContent('あなたの入力は保存されていません');
    // The notice is at the top of a long form: it takes the focus, so it is seen and read out
    expect(notice).toHaveFocus();
    expect(screen.getByLabelText('最近の動き')).toHaveValue('自分が書いた動き');
    // The same save would be refused again: it is closed, and the reason stands next to it
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
    expect(screen.getByText('保存できませんでした。上の知らせを確かめてください。')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '最新の内容を読み込む' }));
    });
    expect(screen.getByLabelText('最近の動き')).toHaveValue('同僚が書いた動き');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
    // The next save carries the date of the card just read
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(mocks.mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedUpdatedAt: latest.updatedAt })
    );
  });

  it('keeps what was typed when the latest card cannot be loaded (#1225)', async () => {
    // The read before the editing goes through; the one asked for after the refusal fails, and
    // hands back the card from before, like the query does
    const refetch = vi
      .fn()
      .mockResolvedValueOnce({
        isSuccess: true,
        data: { card: savedCard, canEdit: true, draftSource },
      })
      .mockResolvedValue({
        isSuccess: false,
        isError: true,
        data: { card: savedCard, canEdit: true, draftSource },
      });
    mocks.result = {
      data: { card: savedCard, canEdit: true, draftSource },
      isError: false,
      refetch,
    };
    renderCard();
    await press('編集');
    fireEvent.change(screen.getByLabelText('最近の動き'), { target: { value: '自分が書いた動き' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    act(() => mocks.hook.onError?.({ data: { code: 'CONFLICT' } }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '最新の内容を読み込む' }));
    });
    // Nothing was refilled from the old card: the form, and the notice, are as they were
    expect(screen.getByLabelText('最近の動き')).toHaveValue('自分が書いた動き');
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('reads the card behind the form anew when a save is refused (#1225)', async () => {
    mocks.result = { data: { card: savedCard, canEdit: true, draftSource }, isError: false };
    renderCard();
    await press('編集');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    act(() => mocks.hook.onError?.({ data: { code: 'CONFLICT' } }));
    expect(mocks.invalidate).toHaveBeenCalledWith({ organizationId: ORG_ID, leadId: LEAD_ID });
  });

  it('reads the card before an editing starts, and starts from what the server holds (#1225)', async () => {
    // The screen's copy is old: somebody saved the card since the page was opened
    mocks.result = { data: { card: savedCard, canEdit: true, draftSource }, isError: false };
    const latest = {
      ...savedCard,
      recentNews: '同僚が書いた動き',
      updatedAt: new Date('2026-10-18T02:00:00Z'),
    };
    mocks.server = { card: latest, canEdit: true, draftSource };
    renderCard();
    await press('編集');
    expect(mocks.refetches).toBe(1);
    expect(screen.getByLabelText('最近の動き')).toHaveValue('同僚が書いた動き');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ expectedUpdatedAt: latest.updatedAt })
    );
  });

  it('does not open the form when the card cannot be read first (#1225)', async () => {
    mocks.result = {
      data: { card: savedCard, canEdit: true, draftSource },
      isError: false,
      refetch: async () => ({
        isSuccess: false,
        isError: true,
        data: { card: savedCard, canEdit: true, draftSource },
      }),
    };
    renderCard();
    await press('編集');
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '編集' })).toBeEnabled();
  });

  it('keeps the form open while a save is out: the cancel is closed (#1225)', async () => {
    mocks.result = { data: { card: savedCard, canEdit: true, draftSource }, isError: false };
    mocks.pending = true;
    renderCard();
    await press('編集');
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeDisabled();
  });

  it('gives the focus to the first field when the form opens (#1225)', async () => {
    mocks.result = { data: { card: savedCard, canEdit: true, draftSource }, isError: false };
    renderCard();
    await press('編集');
    expect(screen.getByLabelText('推定した基幹システム')).toHaveFocus();
  });

  it('shows a card saved empty as none, and still saves over that row with its date (#1225)', async () => {
    const emptyAt = new Date('2026-10-18T03:00:00Z');
    mocks.result = {
      data: {
        card: {
          estimatedSystem: null,
          estimatedSystemBasis: null,
          recentNews: null,
          hypotheses: {},
          firstQuestions: [],
          updatedAt: emptyAt,
          updatedByName: '営業 太郎',
        },
        canEdit: true,
        draftSource,
      },
      isError: false,
    };
    renderCard();
    expect(screen.getByText(/まだ準備していません/)).toBeInTheDocument();
    await press('準備を始める');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ expectedUpdatedAt: emptyAt })
    );
  });

  it('shows a saved card, marked ready with three questions', () => {
    mocks.result = {
      data: {
        card: {
          estimatedSystem: 'AS/400',
          estimatedSystemBasis: '求人に RPG',
          recentNews: null,
          hypotheses: { people: '担当者が来年退職' },
          firstQuestions: ['質問A', '質問B', '質問C'],
          updatedAt: new Date('2026-10-18T01:00:00Z'),
          updatedByName: '営業 太郎',
        },
        canEdit: true,
        draftSource,
      },
      isError: false,
    };
    renderCard();
    expect(screen.getByText('準備済み')).toBeInTheDocument();
    expect(screen.getByText('（根拠：求人に RPG）')).toBeInTheDocument();
    expect(screen.getByText(/担当者が来年退職/)).toBeInTheDocument();
    expect(screen.getByText('質問C')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '編集' })).toBeInTheDocument();
  });

  it('has no draft button without material, and no editing for viewers', async () => {
    mocks.result = {
      data: {
        card: null,
        canEdit: true,
        draftSource: { ...draftSource, targetSystem: null, primaryChallenge: null, challenges: [], playbookQuestions: {} },
      },
      isError: false,
    };
    const { unmount } = renderCard();
    await press('準備を始める');
    expect(screen.queryByRole('button', { name: '下書きを作る' })).not.toBeInTheDocument();
    unmount();

    mocks.result = { data: { card: null, canEdit: false, draftSource: null }, isError: false };
    renderCard();
    expect(screen.queryByRole('button', { name: '準備を始める' })).not.toBeInTheDocument();
  });

  it('says so in the card when it could not be loaded, with a retry (#431)', () => {
    const refetch = vi.fn();
    mocks.result = { data: undefined, isError: true, error: { data: { code: 'NOT_FOUND' } }, refetch };
    renderCard();
    expect(screen.getByRole('heading', { name: '事前調査カード' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('読み込めませんでした');
    expect(screen.queryByRole('button', { name: '準備を始める' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the card on screen when a reload fails after it was shown (#431)', () => {
    mocks.result = {
      data: { card: null, canEdit: true, draftSource },
      isError: true,
      error: { data: { code: 'INTERNAL_SERVER_ERROR' } },
    };
    renderCard();
    expect(screen.getByText(/まだ準備していません/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
