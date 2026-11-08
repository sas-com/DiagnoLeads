/**
 * The lead's comments and notes on the lead page (#555, #722): the list comes a page at a time
 * of the chosen type, the heading and the filters count every type from the server, read-only
 * members get no form and are told so, a write refreshes the list and the lead's activity and
 * keeps the text when it fails (said under the field, not in a toast), a failed read is no
 * empty list (and a type that fails keeps the rest of the card), reading on moves the focus to
 * what was read, and deleting asks first, naming the replies it takes and saying a failure in
 * the dialog. Names and texts are made up.
 */
import { CommentsSection } from '@/components/features/comments/comments-section';
import messages from '@/locales/ja/common.json';
import { act, render, screen, waitFor, within } from '@testing-library/react';
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
type InfiniteOptions = {
  getNextPageParam: (last: { nextCursor: number | null }) => unknown;
  retry: (failureCount: number, error: unknown) => boolean;
};

const mocks = vi.hoisted(() => ({
  pages: [] as unknown[],
  error: null as unknown,
  isPlaceholderData: false,
  hasNextPage: false,
  isFetchingNextPage: false,
  isFetchNextPageError: false,
  queryInput: undefined as unknown,
  queryOptions: undefined as unknown,
  options: {} as Record<string, Callbacks>,
  mutate: {} as Record<string, ReturnType<typeof vi.fn>>,
  pending: {} as Record<string, boolean>,
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
      return {
        mutate: mocks.mutate[name],
        mutateAsync: mocks.mutate[name],
        isPending: mocks.pending[name] ?? false,
      };
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
              isFetchingNextPage: mocks.isFetchingNextPage,
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

const section = () => (
  <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
    <CommentsSection organizationId={ORG_ID} leadId={LEAD_ID} />
  </NextIntlClientProvider>
);
const renderSection = () => render(section());

const cardOf = (text: string) => screen.getByText(text).closest('article') as HTMLElement;
const typeChoice = () => screen.getByRole('group', { name: '種類' });
const filters = () => screen.getByRole('group', { name: '絞り込み' });
const moreButton = () => screen.queryByRole('button', { name: /^もっと見る/ });

const openDelete = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
  await user.click(within(cardOf(text)).getByRole('button', { name: /の操作$/ }));
  await user.click(await screen.findByRole('menuitem', { name: '削除' }));
  return screen.findByRole('alertdialog');
};

beforeEach(() => {
  mocks.pages = [page(WRITER)];
  mocks.error = null;
  mocks.isPlaceholderData = false;
  mocks.hasNextPage = false;
  mocks.isFetchingNextPage = false;
  mocks.isFetchNextPageError = false;
  mocks.pending = {};
  for (const fn of Object.values(mocks.mutate)) fn.mockReset();
  for (const fn of Object.values(mocks.invalidate)) fn.mockReset();
  mocks.refetch.mockReset();
  // Resolves with the query's result, as the real one: here, what is read already
  mocks.fetchNextPage
    .mockReset()
    .mockImplementation(async () => ({ data: { pages: mocks.pages, pageParams: [] } }));
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

  it('counts in the heading only when there are some, and in the filters with the badge', () => {
    const { unmount } = renderSection();
    const count = within(within(filters()).getByRole('radio', { name: 'すべて 3' })).getByText(
      '3'
    );
    // The badge's look, on a span (a button holds no div)
    expect(count.tagName).toBe('SPAN');
    expect(count).toHaveClass('rounded-full', 'bg-gray-100', 'text-gray-800');
    unmount();

    mocks.pages = [page(WRITER, { items: [], total: 0, counts: NONE })];
    renderSection();
    const heading = screen.getByRole('heading', { level: 2, name: 'コメント・メモ' });
    expect(heading.parentElement).toHaveTextContent(/^コメント・メモ$/);
  });

  it('names the filter in words of its own, apart from the type choice of the form', () => {
    renderSection();
    // The type is a fieldset of the form; the filter goes with the list, below a line
    expect(typeChoice().tagName).toBe('FIELDSET');
    const label = document.getElementById(filters().getAttribute('aria-labelledby') ?? '');
    expect(label).toHaveTextContent('絞り込み');
    expect(label).not.toHaveClass('sr-only');
    expect(filters()).not.toHaveClass('border-b');
    const group = filters().closest('.border-t') as HTMLElement;
    expect(group).toHaveClass('pt-4');
    expect(group).toContainElement(screen.getByText('先方は来月に決裁'));
    expect(group).not.toContainElement(typeChoice());
  });

  it('lists the comments, each an article', () => {
    renderSection();
    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(within(list).getAllByRole('article')).toHaveLength(3);
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

  it('reads on with "show more", each comment once, and says how many are left', async () => {
    const user = userEvent.setup();
    mocks.hasNextPage = true;
    mocks.pages = [
      page(WRITER, { total: 5, counts: { all: 5, comment: 3, note: 2, activity: 0 }, nextCursor: 3 }),
      // A comment written meanwhile moved this page by one; it counts with the latest
      page(WRITER, {
        items: [
          comment('n1', 'note', '担当は情報システム部'),
          comment('c4', 'comment', '次は役員'),
        ],
        total: 6,
        counts: { all: 6, comment: 4, note: 2, activity: 0 },
        nextCursor: 5,
      }),
    ];
    renderSection();

    const { getNextPageParam } = mocks.queryOptions as InfiniteOptions;
    expect(getNextPageParam({ nextCursor: 50 })).toBe(50);
    expect(getNextPageParam({ nextCursor: null })).toBeNull();
    expect(screen.getAllByText('担当は情報システム部')).toHaveLength(1);
    expect(screen.getByText('次は役員')).toBeInTheDocument();

    // 6 in all, 4 shown: the words of the lead's activity, with what is left
    await user.click(screen.getByRole('button', { name: 'もっと見る（残り2件）' }));
    expect(mocks.fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('moves the focus to the first comment read on, as the button goes after the last page', async () => {
    const user = userEvent.setup();
    mocks.hasNextPage = true;
    const counts = { all: 4, comment: 3, note: 1, activity: 0 };
    mocks.pages = [page(WRITER, { total: 4, counts, nextCursor: 3 })];
    const { rerender } = renderSection();
    const more = screen.getByRole('button', { name: 'もっと見る（残り1件）' });
    mocks.fetchNextPage.mockImplementation(async () => {
      mocks.pages = [
        ...mocks.pages,
        page(WRITER, { items: [comment('c4', 'comment', '次は役員')], total: 4, counts }),
      ];
      mocks.hasNextPage = false;
      return { data: { pages: mocks.pages, pageParams: [] } };
    });

    await user.click(more);
    expect(more).toHaveFocus();
    // The query hands the page over in a render of its own
    rerender(section());
    await waitFor(() => expect(cardOf('次は役員')).toHaveFocus());
    expect(cardOf('次は役員')).toHaveAttribute('tabindex', '-1');
    expect(moreButton()).toBeNull();
  });

  it('moves the focus there too when the page shows before the read resolves', async () => {
    const user = userEvent.setup();
    mocks.hasNextPage = true;
    const counts = { all: 4, comment: 3, note: 1, activity: 0 };
    mocks.pages = [page(WRITER, { total: 4, counts, nextCursor: 3 })];
    const { rerender } = renderSection();
    let finish: () => void = () => {};
    mocks.fetchNextPage.mockImplementation(
      () =>
        new Promise((done) => {
          finish = () => done({ data: { pages: mocks.pages, pageParams: [] } });
        })
    );

    await user.click(screen.getByRole('button', { name: 'もっと見る（残り1件）' }));
    mocks.pages = [
      ...mocks.pages,
      page(WRITER, { items: [comment('c4', 'comment', '次は役員')], total: 4, counts }),
    ];
    mocks.hasNextPage = false;
    rerender(section());
    expect(cardOf('次は役員')).not.toHaveFocus();
    await act(async () => finish());
    expect(cardOf('次は役員')).toHaveFocus();
  });

  it('keeps the button (and the focus) while reading on, and reads once', async () => {
    const user = userEvent.setup();
    mocks.hasNextPage = true;
    mocks.isFetchingNextPage = true;
    renderSection();
    const more = moreButton() as HTMLElement;
    expect(more).toBeEnabled();
    expect(more).toHaveAttribute('aria-disabled', 'true');
    expect(more.querySelector('.animate-spin')).not.toBeNull();
    await user.click(more);
    expect(more).toHaveFocus();
    expect(mocks.fetchNextPage).not.toHaveBeenCalled();
  });

  it('keeps what was read when the next page fails, and says so', () => {
    mocks.hasNextPage = true;
    mocks.isFetchNextPageError = true;
    mocks.error = { data: { code: 'INTERNAL_SERVER_ERROR' } };
    renderSection();
    expect(screen.getByText('先方は来月に決裁')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('続きを読み込めませんでした');
    expect(moreButton()).toBeEnabled();
    expect(moreButton()).not.toHaveAttribute('aria-disabled');
  });

  it('offers no more when the last page is read', () => {
    renderSection();
    expect(moreButton()).toBeNull();
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
    expect(screen.getByText('閲覧のみの権限のため、書き込めません')).toBeInTheDocument();
    expect(screen.queryByText('最初のコメントやメモを追加しましょう')).not.toBeInTheDocument();
    unmount();

    mocks.pages = [page(WRITER, { items: [], total: 0, counts: NONE })];
    renderSection();
    expect(screen.getByText('最初のコメントやメモを追加しましょう')).toBeInTheDocument();
    expect(screen.queryByText('閲覧のみの権限のため、書き込めません')).not.toBeInTheDocument();
  });

  it('says the chosen type has none yet, by its type', async () => {
    const user = userEvent.setup();
    // The activity counts but none comes: the words of every branch
    mocks.pages = [
      page(WRITER, { items: [], total: 0, counts: { all: 3, comment: 0, note: 0, activity: 3 } }),
    ];
    renderSection();
    expect(screen.getByText('該当するものはありません')).toBeInTheDocument();
    await user.click(within(filters()).getByRole('radio', { name: 'コメント' }));
    expect(screen.getByText('コメントはまだありません')).toBeInTheDocument();
    await user.click(within(filters()).getByRole('radio', { name: 'メモ' }));
    expect(screen.getByText('メモはまだありません')).toBeInTheDocument();
    await user.click(within(filters()).getByRole('radio', { name: 'アクティビティ 3' }));
    expect(screen.getByText('アクティビティはまだありません')).toBeInTheDocument();
    expect(screen.queryByText('コメント・メモはまだありません')).not.toBeInTheDocument();
  });

  it('shows the parent organization the notice the deals show, not the form', () => {
    mocks.pages = [];
    mocks.error = { data: { code: 'FORBIDDEN' } };
    const { container } = renderSection();
    expect(
      screen.getByRole('heading', { level: 4, name: 'コメント・メモを見る権限がありません' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'コメント・メモは、リードを閲覧できるメンバーだけが見られます（親組織からの閲覧者は除く）。'
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('says the comments could not be read when none ever were, rather than that there are none', async () => {
    const user = userEvent.setup();
    mocks.pages = [];
    mocks.error = { data: { code: 'INTERNAL_SERVER_ERROR' } };
    const { container } = renderSection();
    expect(
      screen.getByRole('heading', { level: 4, name: 'コメント・メモを読み込めませんでした' })
    ).toBeInTheDocument();
    expect(screen.queryByText('コメント・メモはまだありません')).not.toBeInTheDocument();
    for (const icon of container.querySelectorAll('svg')) {
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    }
    await user.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(mocks.refetch).toHaveBeenCalled();
  });

  it('keeps the heading, the form with its text and the filter when another type fails', async () => {
    const user = userEvent.setup();
    renderSection();
    const box = screen.getByRole('textbox', { name: 'コメント' });
    await user.type(box, '見積は来週');

    // Once failed, the notes have nothing to hold their place
    mocks.pages = [];
    mocks.error = { data: { code: 'INTERNAL_SERVER_ERROR' } };
    await user.click(within(filters()).getByRole('radio', { name: 'メモ 1' }));

    expect(screen.getByRole('alert')).toHaveTextContent('コメント・メモを読み込めませんでした');
    expect(box).toBeInTheDocument();
    expect(box).toHaveValue('見積は来週');
    expect(within(filters()).getByRole('radio', { name: 'メモ 1' })).toBeChecked();
    const heading = screen.getByRole('heading', { level: 2, name: 'コメント・メモ' });
    expect(within(heading.parentElement as HTMLElement).getByText('3')).toBeInTheDocument();
    expect(screen.queryByText('先方は来月に決裁')).not.toBeInTheDocument();
    expect(screen.queryByText('コメント・メモはまだありません')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(mocks.refetch).toHaveBeenCalled();
  });

  it('gives way to the notice when refused, even after a read', async () => {
    const user = userEvent.setup();
    renderSection();
    mocks.pages = [];
    mocks.error = { data: { code: 'FORBIDDEN' } };
    await user.click(within(filters()).getByRole('radio', { name: 'メモ 1' }));
    expect(
      screen.getByRole('heading', { level: 4, name: 'コメント・メモを見る権限がありません' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('reads again twice when a read fails, but not when it is refused', () => {
    renderSection();
    const { retry } = mocks.queryOptions as InfiniteOptions;
    const failure = { data: { code: 'INTERNAL_SERVER_ERROR' } };
    expect(retry(0, failure)).toBe(true);
    expect(retry(1, failure)).toBe(true);
    expect(retry(2, failure)).toBe(false);
    expect(retry(0, { data: { code: 'FORBIDDEN' } })).toBe(false);
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

  it('shows what was written: a note written under the comment filter turns it to all', async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(within(filters()).getByRole('radio', { name: 'コメント 2' }));
    expect(mocks.queryInput).toMatchObject({ type: 'comment' });

    // A comment shows under the comments
    await user.type(screen.getByRole('textbox', { name: 'コメント' }), '電話で確認');
    await user.click(screen.getByRole('button', { name: '送信' }));
    expect(mocks.queryInput).toMatchObject({ type: 'comment' });

    // A note does not, once it is written (not when the write fails)
    await user.click(within(typeChoice()).getByRole('radio', { name: 'メモ' }));
    await user.type(screen.getByRole('textbox', { name: 'メモ' }), '担当は情報システム部');
    mocks.mutate.create.mockRejectedValueOnce(new Error('network'));
    await user.click(screen.getByRole('button', { name: '送信' }));
    expect(mocks.queryInput).toMatchObject({ type: 'comment' });
    await user.click(screen.getByRole('button', { name: '送信' }));
    expect(mocks.queryInput).toMatchObject({ type: 'all' });
    expect(within(filters()).getByRole('radio', { name: 'すべて 3' })).toBeChecked();
  });

  it('keeps the text when the write fails, says so under the field only, and clears it once saved', async () => {
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
    // Not a toast as well
    mocks.options.create.onError?.(new Error('network'), { type: 'comment' });
    expect(toast.error).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '送信' }));
    expect(mocks.mutate.create).toHaveBeenCalledTimes(2);
    expect(box).toHaveValue('');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says a failed reply under the reply field, not in a toast', async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(within(cardOf('先方は来月に決裁')).getByRole('button', { name: '返信' }));
    const field = screen.getByRole('textbox', { name: '営業 太郎さんへの返信' });
    mocks.mutate.create.mockRejectedValueOnce(new Error('network'));
    await user.type(field, '承知しました');
    await user.keyboard('{Control>}{Enter}{/Control}');

    expect(mocks.mutate.create).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      leadId: LEAD_ID,
      content: '承知しました',
      type: 'comment',
      parentId: 'c1',
    });
    expect(field).toHaveValue('承知しました');
    expect(screen.getByRole('alert')).toHaveTextContent('コメントの追加に失敗しました');
    expect(field).toHaveAccessibleDescription('コメントの追加に失敗しました');
    mocks.options.create.onError?.(new Error('network'), { type: 'comment', parentId: 'c1' });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('leaves the form above writable while a reply is sent', () => {
    mocks.pending.create = true;
    renderSection();
    expect(screen.getByRole('textbox', { name: 'コメント' })).not.toHaveAttribute('readonly');
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
    await openDelete(user, '先方は来月に決裁');
    expect(
      await screen.findByText('このコメントと、返信1件を削除します。この操作は取り消せません。')
    ).toBeInTheDocument();
  });

  it("keeps the delete of a comment with others' replies reachable, saying why it does nothing", async () => {
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
    await user.click(
      within(cardOf('先方は来月に決裁')).getByRole('button', { name: 'コメントの操作' })
    );
    const item = await screen.findByRole('menuitem', { name: '削除' });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(item).toHaveAccessibleDescription(
      'ほかの人の返信があるコメントは、組織のオーナーだけが削除できます'
    );

    // The keyboard reaches it (a disabled item is skipped, and its reason with it)
    await user.keyboard('{End}');
    expect(item).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(mocks.mutate.delete).not.toHaveBeenCalled();
  });

  it('asks before deleting, and deletes the chosen comment', async () => {
    const user = userEvent.setup();
    renderSection();
    const dialog = await openDelete(user, '先方は来月に決裁');
    expect(dialog).toHaveAccessibleName('このコメントを削除しますか？');
    expect(mocks.mutate.delete).not.toHaveBeenCalled();
    // 44px on phones, as the rest of the tab
    expect(within(dialog).getByRole('button', { name: 'キャンセル' })).toHaveClass('min-h-11');
    const remove = within(dialog).getByRole('button', { name: '削除' });
    expect(remove).toHaveClass('min-h-11');
    await user.click(remove);
    expect(mocks.mutate.delete).toHaveBeenCalledWith({ organizationId: ORG_ID, id: 'c1' });
  });

  it('shows a spinner on the delete while deleting', async () => {
    const user = userEvent.setup();
    mocks.pending.delete = true;
    renderSection();
    const dialog = await openDelete(user, '先方は来月に決裁');
    const remove = within(dialog).getByRole('button', { name: '削除' });
    expect(remove).toBeDisabled();
    expect(remove.querySelector('.animate-spin')).not.toBeNull();
  });

  it('says a failed delete in the dialog, not in a toast, until the dialog opens again', async () => {
    const user = userEvent.setup();
    renderSection();
    const dialog = await openDelete(user, '先方は来月に決裁');
    const remove = within(dialog).getByRole('button', { name: '削除' });
    const failWith = (code: string) =>
      mocks.mutate.delete.mockImplementationOnce((variables: unknown) =>
        mocks.options.delete.onError?.({ data: { code } }, variables)
      );

    // Someone replied meanwhile: the server refuses
    failWith('FORBIDDEN');
    await user.click(remove);
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'ほかの人の返信があるコメントは、組織のオーナーだけが削除できます'
    );
    failWith('INTERNAL_SERVER_ERROR');
    await user.click(remove);
    expect(within(dialog).getByRole('alert')).toHaveTextContent('コメントの削除に失敗しました');
    expect(toast.error).not.toHaveBeenCalled();
    expect(dialog).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'キャンセル' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    const again = await openDelete(user, '担当は情報システム部');
    expect(again).toHaveAccessibleName('このメモを削除しますか？');
    expect(within(again).queryByRole('alert')).not.toBeInTheDocument();
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
    act(() => {
      mocks.options.delete.onSuccess?.({ success: true }, { organizationId: ORG_ID, id: 'n1' });
    });
    expect(toast.success).toHaveBeenCalledWith('メモを削除しました');
  });

  it('says what an edit and a pin did, a note as a note; a failed pin in a toast only', () => {
    renderSection();
    mocks.options.update.onSuccess?.({ type: 'note' }, { organizationId: ORG_ID, id: 'n1' });
    expect(toast.success).toHaveBeenCalledWith('メモを更新しました');
    // A failed edit is said under its field, which stays open
    mocks.options.update.onError?.(new Error('network'), { organizationId: ORG_ID, id: 'n1' });
    expect(toast.error).not.toHaveBeenCalled();
    mocks.options.togglePin.onSuccess?.({ type: 'note', isPinned: true }, { id: 'n1' });
    expect(toast.success).toHaveBeenCalledWith('メモをピン留めしました');
    mocks.options.togglePin.onSuccess?.({ type: 'note', isPinned: false }, { id: 'n1' });
    expect(toast.success).toHaveBeenCalledWith('ピン留めを解除しました');
    // The menu has closed: nowhere else to say it
    mocks.options.togglePin.onError?.(new Error('network'), { id: 'n1' });
    expect(toast.error).toHaveBeenCalledWith('ピン留めの更新に失敗しました');
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
    expect(screen.getByRole('button', { name: '送信' })).toHaveClass('min-h-11');
    expect(moreButton()).toHaveClass('min-h-11');
    const first = cardOf('先方は来月に決裁');
    expect(within(first).getByRole('button', { name: 'コメントの操作' })).toHaveClass(
      'min-h-11',
      'min-w-11'
    );
    expect(within(first).getByRole('button', { name: '返信' })).toHaveClass('min-h-11');
  });
});
