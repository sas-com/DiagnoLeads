/**
 * The lead's comments and notes on the lead page (#555, #722): the list comes a page at a time
 * of the chosen type, the heading and the filters count every type from the server, read-only
 * members get no form and are told so, a write refreshes the list and the lead's activity and
 * keeps the text when it fails (said under the field too), a failed read is no empty list, and
 * deleting asks first, naming the replies it takes. Names and texts are made up.
 */
import { CommentsSection } from '@/components/features/comments/comments-section';
import messages from '@/locales/ja/common.json';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '770e8400-e29b-41d4-a716-446655440000';
const ME = '880e8400-e29b-41d4-a716-446655440001';
const OTHER = '880e8400-e29b-41d4-a716-446655440002';

type Callbacks = {
  onSuccess?: (data: unknown, variables: unknown) => void;
  onError?: (error: unknown, variables: unknown) => void;
};
type InfiniteOptions = { getNextPageParam: (last: { nextCursor: number | null }) => unknown };

const mocks = vi.hoisted(() => ({
  pages: [] as unknown[],
  error: null as unknown,
  isPlaceholderData: false,
  hasNextPage: false,
  isFetchNextPageError: false,
  queryInput: undefined as unknown,
  queryOptions: undefined as unknown,
  options: {} as Record<string, Callbacks>,
  mutate: {} as Record<string, ReturnType<typeof vi.fn>>,
  refetch: vi.fn(),
  fetchNextPage: vi.fn(),
  invalidate: {
    list: vi.fn(),
    count: vi.fn(),
    activity: vi.fn(),
  },
}));

vi.mock('@/lib/trpc/client', () => {
  const mutation = (name: string) => ({
    useMutation: (options: Callbacks) => {
      mocks.options[name] = options;
      mocks.mutate[name] ??= vi.fn();
      // The section awaits its writes; mutate and mutateAsync record alike
      return { mutate: mocks.mutate[name], mutateAsync: mocks.mutate[name], isPending: false };
    },
  });
  return {
    trpc: {
      useUtils: () => ({
        comments: {
          list: { invalidate: mocks.invalidate.list },
          getCount: { invalidate: mocks.invalidate.count },
        },
        leadActivity: { list: { invalidate: mocks.invalidate.activity } },
      }),
      comments: {
        list: {
          useInfiniteQuery: (input: unknown, options: unknown) => {
            mocks.queryInput = input;
            mocks.queryOptions = options;
            return {
              data: mocks.pages.length > 0 ? { pages: mocks.pages, pageParams: [] } : undefined,
              isLoading: false,
              isPlaceholderData: mocks.isPlaceholderData,
              error: mocks.error,
              refetch: mocks.refetch,
              hasNextPage: mocks.hasNextPage,
              fetchNextPage: mocks.fetchNextPage,
              isFetchingNextPage: false,
              isFetchNextPageError: mocks.isFetchNextPageError,
            };
          },
        },
        create: mutation('create'),
        update: mutation('update'),
        delete: mutation('delete'),
        togglePin: mutation('togglePin'),
      },
    },
  };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

type Type = 'comment' | 'note' | 'activity';

const comment = (
  id: string,
  type: Type,
  content: string,
  userId = ME,
  replies: unknown[] = []
) => ({
  id,
  leadId: LEAD_ID,
  organizationId: ORG_ID,
  userId,
  content,
  type,
  metadata: null,
  parentId: null,
  isPinned: false,
  createdAt: new Date('2026-10-24T01:00:00Z'),
  updatedAt: new Date('2026-10-24T01:00:00Z'),
  user: { id: userId, name: '営業 太郎', email: 'sales@example.com', image: null },
  replies,
});

const WRITER = { canWrite: true, canModerate: false };
const READER = { canWrite: false, canModerate: false };
const NONE = { all: 0, comment: 0, note: 0, activity: 0 };

const page = (viewer: { canWrite: boolean; canModerate: boolean }, overrides = {}) => ({
  items: [
    comment('c1', 'comment', '先方は来月に決裁'),
    comment('c2', 'comment', '見積の前提を確認'),
    comment('n1', 'note', '担当は情報システム部'),
  ],
  total: 3,
  counts: { all: 3, comment: 2, note: 1, activity: 0 },
  nextCursor: null,
  viewer: { userId: ME, ...viewer },
  ...overrides,
});

const renderSection = () =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <CommentsSection organizationId={ORG_ID} leadId={LEAD_ID} />
    </NextIntlClientProvider>
  );

const cardOf = (text: string) => screen.getByText(text).closest('div.rounded-lg') as HTMLElement;
const typeChoice = () => screen.getByRole('group', { name: '種類' });
const filters = () => screen.getByRole('group', { name: '絞り込み' });

beforeEach(() => {
  mocks.pages = [page(WRITER)];
  mocks.error = null;
  mocks.isPlaceholderData = false;
  mocks.hasNextPage = false;
  mocks.isFetchNextPageError = false;
  for (const fn of Object.values(mocks.mutate)) fn.mockReset();
  for (const fn of Object.values(mocks.invalidate)) fn.mockReset();
  mocks.refetch.mockReset();
  mocks.fetchNextPage.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

describe('CommentsSection', () => {
  it('counts every type from the server, and reads the chosen type from it', async () => {
    const user = userEvent.setup();
    // 73 in all: this page shows 3 of them
    mocks.pages = [
      page(WRITER, { total: 73, counts: { all: 73, comment: 60, note: 13, activity: 0 } }),
    ];
    renderSection();
    expect(mocks.queryInput).toEqual({ organizationId: ORG_ID, leadId: LEAD_ID, type: 'all' });

    const heading = screen.getByRole('heading', { level: 2, name: 'コメント・メモ' });
    expect(within(heading.parentElement as HTMLElement).getByText('73')).toBeInTheDocument();
    expect(within(filters()).getByRole('radio', { name: 'すべて 73' })).toBeChecked();
    expect(within(filters()).getByRole('radio', { name: 'コメント 60' })).not.toBeChecked();

    const notes = within(filters()).getByRole('radio', { name: 'メモ 13' });
    await user.click(notes);
    expect(mocks.queryInput).toEqual({ organizationId: ORG_ID, leadId: LEAD_ID, type: 'note' });
    expect(notes).toBeChecked();
    // The counts are the server's, whichever type is shown
    expect(within(filters()).getByRole('radio', { name: 'すべて 73' })).toBeInTheDocument();
  });

  it('keeps the counts while another type is read, not the comments of the last one', () => {
    mocks.isPlaceholderData = true;
    renderSection();
    expect(screen.queryByText('先方は来月に決裁')).not.toBeInTheDocument();
    expect(within(filters()).getByRole('radio', { name: 'すべて 3' })).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('offers the activity filter only for a lead that has activity entries', () => {
    renderSection();
    expect(within(filters()).getAllByRole('radio')).toHaveLength(3);
    expect(within(filters()).queryByRole('radio', { name: /アクティビティ/ })).toBeNull();
  });

  it('offers the activity filter when there are some', () => {
    mocks.pages = [
      page(WRITER, {
        items: [comment('a1', 'activity', '資料を送付')],
        counts: { all: 4, comment: 2, note: 1, activity: 1 },
      }),
    ];
    renderSection();
    expect(within(filters()).getByRole('radio', { name: 'アクティビティ 1' })).toBeInTheDocument();
    // Its type is said in words
    expect(within(cardOf('資料を送付')).getByText('アクティビティ')).toBeInTheDocument();
  });

  it('reads the 51st comment on with "show more", each comment once', async () => {
    const user = userEvent.setup();
    mocks.hasNextPage = true;
    // A comment written meanwhile moved the second page by one
    mocks.pages = [
      page(WRITER, { nextCursor: 3 }),
      page(WRITER, {
        items: [
          comment('n1', 'note', '担当は情報システム部'),
          comment('c4', 'comment', '次は役員'),
        ],
        nextCursor: null,
      }),
    ];
    renderSection();

    const { getNextPageParam } = mocks.queryOptions as InfiniteOptions;
    expect(getNextPageParam({ nextCursor: 50 })).toBe(50);
    expect(getNextPageParam({ nextCursor: null })).toBeNull();
    expect(screen.getAllByText('担当は情報システム部')).toHaveLength(1);
    expect(screen.getByText('次は役員')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'さらに表示' }));
    expect(mocks.fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('keeps what was read when the next page fails, and says so', () => {
    mocks.hasNextPage = true;
    mocks.isFetchNextPageError = true;
    mocks.error = { data: { code: 'INTERNAL_SERVER_ERROR' } };
    renderSection();
    expect(screen.getByText('先方は来月に決裁')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('続きを読み込めませんでした');
    expect(screen.getByRole('button', { name: 'さらに表示' })).toBeEnabled();
  });

  it('offers no more when the last page is read', () => {
    renderSection();
    expect(screen.queryByRole('button', { name: 'さらに表示' })).toBeNull();
  });

  it('gives no form, no reply and no menu to a read-only member, even on their own comment', () => {
    mocks.pages = [page(READER)];
    renderSection();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '送信' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '返信' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'コメントの操作' })).not.toBeInTheDocument();
    expect(screen.getByText('先方は来月に決裁')).toBeInTheDocument();
  });

  it('tells a read-only member so, rather than to add the first one', () => {
    mocks.pages = [page(READER, { items: [], total: 0, counts: NONE })];
    const { unmount } = renderSection();
    expect(screen.getByText('コメント・メモはまだありません')).toBeInTheDocument();
    expect(screen.getByText('閲覧のみです')).toBeInTheDocument();
    expect(screen.queryByText('最初のコメントやメモを追加しましょう')).not.toBeInTheDocument();
    unmount();

    mocks.pages = [page(WRITER, { items: [], total: 0, counts: NONE })];
    renderSection();
    expect(screen.getByText('最初のコメントやメモを追加しましょう')).toBeInTheDocument();
    expect(screen.queryByText('閲覧のみです')).not.toBeInTheDocument();
  });

  it('says none match when the chosen type has none', () => {
    mocks.pages = [
      page(WRITER, { items: [], total: 0, counts: { all: 2, comment: 2, note: 0, activity: 0 } }),
    ];
    renderSection();
    expect(screen.getByText('該当するメモはありません')).toBeInTheDocument();
    expect(screen.queryByText('コメント・メモはまだありません')).not.toBeInTheDocument();
  });

  it('shows the parent organization the notice the deals show, not the form', () => {
    mocks.pages = [];
    mocks.error = { data: { code: 'FORBIDDEN' } };
    renderSection();
    expect(
      screen.getByRole('heading', { level: 4, name: 'メモを見る権限がありません' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'コメント・メモは、リードを閲覧できるメンバーだけが見られます（親組織からの閲覧者は除く）。'
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('says the comments could not be read, rather than that there are none', async () => {
    const user = userEvent.setup();
    mocks.pages = [];
    mocks.error = { data: { code: 'INTERNAL_SERVER_ERROR' } };
    renderSection();
    expect(screen.getByText('メモを読み込めませんでした')).toBeInTheDocument();
    expect(screen.queryByText('コメント・メモはまだありません')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(mocks.refetch).toHaveBeenCalled();
  });

  it('writes a note, says so as a note, and refreshes the list and the activity', async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(within(typeChoice()).getByRole('radio', { name: 'メモ' }));
    await user.type(screen.getByRole('textbox', { name: 'メモ' }), '次回はデモを見せる');
    await user.click(screen.getByRole('button', { name: '送信' }));
    expect(mocks.mutate.create).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      leadId: LEAD_ID,
      content: '次回はデモを見せる',
      type: 'note',
    });

    mocks.options.create.onSuccess?.(undefined, { type: 'note' });
    expect(toast.success).toHaveBeenCalledWith('メモを追加しました');
    expect(mocks.invalidate.list).toHaveBeenCalledWith({ organizationId: ORG_ID, leadId: LEAD_ID });
    expect(mocks.invalidate.activity).toHaveBeenCalled();
    // Nothing reads comments.getCount
    expect(mocks.invalidate.count).not.toHaveBeenCalled();
  });

  it('keeps the text when the write fails, says so under the field, and clears it once saved', async () => {
    const user = userEvent.setup();
    renderSection();
    const box = screen.getByRole('textbox', { name: 'コメント' });
    expect(
      screen.getByText('書いたコメント・メモは、組織のメンバーに見えます')
    ).toBeInTheDocument();

    mocks.mutate.create.mockRejectedValueOnce(new Error('network'));
    await user.type(box, '見積は来週');
    await user.click(screen.getByRole('button', { name: '送信' }));
    expect(box).toHaveValue('見積は来週');
    expect(screen.getByRole('alert')).toHaveTextContent('コメントの追加に失敗しました');
    mocks.options.create.onError?.(new Error('network'), { type: 'comment' });
    expect(toast.error).toHaveBeenCalledWith('コメントの追加に失敗しました');

    await user.click(screen.getByRole('button', { name: '送信' }));
    expect(mocks.mutate.create).toHaveBeenCalledTimes(2);
    expect(box).toHaveValue('');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('sends with Ctrl+Enter or ⌘+Enter, not with Enter alone', async () => {
    const user = userEvent.setup();
    renderSection();
    const box = screen.getByRole('textbox', { name: 'コメント' });
    expect(screen.getByText('Ctrl＋Enter（Mac は ⌘＋Enter）で送信できます')).toBeInTheDocument();

    await user.type(box, '電話で確認');
    await user.keyboard('{Enter}');
    expect(mocks.mutate.create).not.toHaveBeenCalled();
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(mocks.mutate.create).toHaveBeenCalledWith(
      expect.objectContaining({ content: '電話で確認', type: 'comment' })
    );

    await user.type(box, '資料を送付');
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(mocks.mutate.create).toHaveBeenCalledTimes(2);
    expect(mocks.mutate.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ content: '資料を送付' })
    );
  });

  it('names the replies a delete takes', async () => {
    const user = userEvent.setup();
    mocks.pages = [
      page(WRITER, {
        items: [
          comment('c1', 'comment', '先方は来月に決裁', ME, [comment('r1', 'comment', '承知', ME)]),
        ],
        total: 1,
      }),
    ];
    renderSection();
    const first = cardOf('先方は来月に決裁');
    await user.click(within(first).getByRole('button', { name: 'コメントの操作' }));
    await user.click(await screen.findByRole('menuitem', { name: '削除' }));
    expect(
      await screen.findByText('このコメントと、返信1件を削除します。この操作は取り消せません。')
    ).toBeInTheDocument();
  });

  it("does not offer a member the delete of a comment with others' replies", async () => {
    const user = userEvent.setup();
    mocks.pages = [
      page(WRITER, {
        items: [
          comment('c1', 'comment', '先方は来月に決裁', ME, [
            comment('r1', 'comment', '承知', OTHER),
          ]),
        ],
        total: 1,
      }),
    ];
    renderSection();
    const first = cardOf('先方は来月に決裁');
    await user.click(within(first).getByRole('button', { name: 'コメントの操作' }));
    const item = await screen.findByRole('menuitem', { name: '削除' });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(
      screen.getByText('ほかの人の返信があるコメントは、組織のオーナーだけが削除できます')
    ).toBeInTheDocument();
  });

  it('asks before deleting, and deletes the chosen comment', async () => {
    const user = userEvent.setup();
    renderSection();
    const first = cardOf('先方は来月に決裁');
    await user.click(within(first).getByRole('button', { name: 'コメントの操作' }));
    await user.click(await screen.findByRole('menuitem', { name: '削除' }));

    const dialog = await screen.findByRole('alertdialog', { name: 'このコメントを削除しますか？' });
    expect(mocks.mutate.delete).not.toHaveBeenCalled();
    // 44px on phones, as the rest of the tab
    expect(within(dialog).getByRole('button', { name: 'キャンセル' })).toHaveClass('min-h-11');
    const remove = within(dialog).getByRole('button', { name: '削除' });
    expect(remove).toHaveClass('min-h-11');
    await user.click(remove);
    expect(mocks.mutate.delete).toHaveBeenCalledWith({ organizationId: ORG_ID, id: 'c1' });
  });

  it('asks about a note as a note, and says it was deleted', async () => {
    const user = userEvent.setup();
    renderSection();
    const note = cardOf('担当は情報システム部');
    await user.click(within(note).getByRole('button', { name: 'メモの操作' }));
    await user.click(await screen.findByRole('menuitem', { name: '削除' }));

    const dialog = await screen.findByRole('alertdialog', { name: 'このメモを削除しますか？' });
    expect(
      within(dialog).getByText('このメモを削除してもよろしいですか？この操作は取り消せません。')
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '削除' }));
    expect(mocks.mutate.delete).toHaveBeenCalledWith({ organizationId: ORG_ID, id: 'n1' });
    mocks.options.delete.onSuccess?.({ success: true }, { organizationId: ORG_ID, id: 'n1' });
    expect(toast.success).toHaveBeenCalledWith('メモを削除しました');
  });

  it('says what an edit and a pin did, a note as a note', () => {
    renderSection();
    mocks.options.update.onSuccess?.({ type: 'note' }, { organizationId: ORG_ID, id: 'n1' });
    expect(toast.success).toHaveBeenCalledWith('メモを更新しました');
    mocks.options.update.onError?.(new Error('network'), { organizationId: ORG_ID, id: 'n1' });
    expect(toast.error).toHaveBeenCalledWith('メモの更新に失敗しました');
    mocks.options.togglePin.onSuccess?.({ type: 'note', isPinned: true }, { id: 'n1' });
    expect(toast.success).toHaveBeenCalledWith('メモをピン留めしました');
    mocks.options.togglePin.onSuccess?.({ type: 'note', isPinned: false }, { id: 'n1' });
    expect(toast.success).toHaveBeenCalledWith('ピン留めを解除しました');
  });

  it('gives each control 44px on phones, and shows the chosen toggle by border and weight too', () => {
    mocks.hasNextPage = true;
    renderSection();
    const toggles = [
      ...within(typeChoice()).getAllByRole('radio'),
      ...within(filters()).getAllByRole('radio'),
    ];
    for (const toggle of toggles) {
      expect(toggle).toHaveClass(
        'min-h-11',
        'data-[state=on]:border-gray-900',
        'data-[state=on]:font-bold'
      );
    }
    expect(within(typeChoice()).getByRole('radio', { name: 'コメント' })).toHaveAttribute(
      'data-state',
      'on'
    );
    for (const name of ['送信', 'さらに表示']) {
      expect(screen.getByRole('button', { name })).toHaveClass('min-h-11');
    }
    const first = cardOf('先方は来月に決裁');
    expect(within(first).getByRole('button', { name: 'コメントの操作' })).toHaveClass(
      'min-h-11',
      'min-w-11'
    );
    expect(within(first).getByRole('button', { name: '返信' })).toHaveClass('min-h-11');
  });
});
