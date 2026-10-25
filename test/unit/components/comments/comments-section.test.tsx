/**
 * The lead's comments and notes on the lead page (#555): read-only members get no form, the
 * filter keeps each count, a write refreshes the lead's activity and keeps the text when it
 * fails, a failed read is no empty list, and deleting asks first, naming the replies it takes.
 * Names and texts are made up.
 */
import { CommentsSection } from '@/components/features/comments/comments-section';
import messages from '@/locales/ja/common.json';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '770e8400-e29b-41d4-a716-446655440000';
const ME = '880e8400-e29b-41d4-a716-446655440001';

type Options = { onSuccess?: (data: { isPinned: boolean }) => void };
const mocks = vi.hoisted(() => ({
  data: undefined as unknown,
  error: null as unknown,
  queryInput: undefined as unknown,
  options: {} as Record<string, { onSuccess?: (data: { isPinned: boolean }) => void }>,
  mutate: {} as Record<string, ReturnType<typeof vi.fn>>,
  refetch: vi.fn(),
  invalidate: {
    list: vi.fn(),
    count: vi.fn(),
    activity: vi.fn(),
  },
}));

vi.mock('@/lib/trpc/client', () => {
  const mutation = (name: string) => ({
    useMutation: (options: Options) => {
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
          useQuery: (input: unknown) => {
            mocks.queryInput = input;
            return { data: mocks.data, isLoading: false, error: mocks.error, refetch: mocks.refetch };
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

const OTHER = '880e8400-e29b-41d4-a716-446655440002';

const comment = (
  id: string,
  type: 'comment' | 'note',
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

const page = (viewer: { canWrite: boolean; canModerate: boolean }) => ({
  items: [
    comment('c1', 'comment', '先方は来月に決裁'),
    comment('c2', 'comment', '見積の前提を確認'),
    comment('n1', 'note', '担当は情報システム部'),
  ],
  total: 3,
  limit: 50,
  offset: 0,
  viewer: { userId: ME, ...viewer },
});

const renderSection = () =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <CommentsSection organizationId={ORG_ID} leadId={LEAD_ID} />
    </NextIntlClientProvider>
  );

beforeEach(() => {
  mocks.data = page({ canWrite: true, canModerate: false });
  mocks.error = null;
  for (const fn of Object.values(mocks.mutate)) fn.mockReset();
  for (const fn of Object.values(mocks.invalidate)) fn.mockReset();
  mocks.refetch.mockReset();
});

describe('CommentsSection', () => {
  it('reads every type at once and keeps each count while filtering', async () => {
    const user = userEvent.setup();
    renderSection();
    expect(mocks.queryInput).toMatchObject({ organizationId: ORG_ID, leadId: LEAD_ID, type: 'all' });

    // The filter's name carries its count ("メモ" alone is the type of a new comment)
    const notes = screen.getByRole('button', { name: 'メモ1' });
    await user.click(notes);
    expect(notes).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('担当は情報システム部')).toBeInTheDocument();
    expect(screen.queryByText('先方は来月に決裁')).not.toBeInTheDocument();
    // The other filters still count their comments
    expect(screen.getByRole('button', { name: 'コメント2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'すべて3' })).toBeInTheDocument();
  });

  it('gives no form, no reply and no menu to a read-only member, even on their own comment', () => {
    mocks.data = page({ canWrite: false, canModerate: false });
    renderSection();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '送信' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '返信' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'コメントの操作' })).not.toBeInTheDocument();
    expect(screen.getByText('先方は来月に決裁')).toBeInTheDocument();
  });

  it('says so when the comments may not be read (the parent organization)', () => {
    mocks.data = undefined;
    mocks.error = { data: { code: 'FORBIDDEN' } };
    renderSection();
    expect(screen.getByText('メモを見る権限がありません')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('writes a note and refreshes the lead activity', async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole('button', { name: 'メモ', pressed: false }));
    await user.type(screen.getByRole('textbox', { name: 'メモ' }), '次回はデモを見せる');
    await user.click(screen.getByRole('button', { name: '送信' }));
    expect(mocks.mutate.create).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      leadId: LEAD_ID,
      content: '次回はデモを見せる',
      type: 'note',
    });

    mocks.options.create.onSuccess?.({ isPinned: false });
    expect(mocks.invalidate.list).toHaveBeenCalledWith({ organizationId: ORG_ID, leadId: LEAD_ID });
    expect(mocks.invalidate.activity).toHaveBeenCalled();
  });

  it('keeps the text when the write fails, and clears it once saved', async () => {
    const user = userEvent.setup();
    renderSection();
    const box = screen.getByRole('textbox', { name: 'コメント' });
    expect(screen.getByText('書いたメモは、組織のメンバーに見えます')).toBeInTheDocument();

    mocks.mutate.create.mockRejectedValueOnce(new Error('network'));
    await user.type(box, '見積は来週');
    await user.click(screen.getByRole('button', { name: '送信' }));
    expect(box).toHaveValue('見積は来週');

    await user.click(screen.getByRole('button', { name: '送信' }));
    expect(mocks.mutate.create).toHaveBeenCalledTimes(2);
    expect(box).toHaveValue('');
  });

  it('says the comments could not be read, rather than that there are none', async () => {
    const user = userEvent.setup();
    mocks.data = undefined;
    mocks.error = { data: { code: 'INTERNAL_SERVER_ERROR' } };
    renderSection();
    expect(screen.getByText('メモを読み込めませんでした')).toBeInTheDocument();
    expect(screen.queryByText('コメントはまだありません')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(mocks.refetch).toHaveBeenCalled();
  });

  it('names the replies a delete takes', async () => {
    const user = userEvent.setup();
    mocks.data = {
      ...page({ canWrite: true, canModerate: false }),
      items: [comment('c1', 'comment', '先方は来月に決裁', ME, [comment('r1', 'comment', '承知', ME)])],
      total: 1,
    };
    renderSection();
    const first = screen.getByText('先方は来月に決裁').closest('div.rounded-lg') as HTMLElement;
    await user.click(within(first).getByRole('button', { name: 'コメントの操作' }));
    await user.click(await screen.findByRole('menuitem', { name: '削除' }));
    expect(
      await screen.findByText('このコメントと、返信1件を削除します。この操作は取り消せません。')
    ).toBeInTheDocument();
  });

  it("does not offer a member the delete of a comment with others' replies", async () => {
    const user = userEvent.setup();
    mocks.data = {
      ...page({ canWrite: true, canModerate: false }),
      items: [
        comment('c1', 'comment', '先方は来月に決裁', ME, [comment('r1', 'comment', '承知', OTHER)]),
      ],
      total: 1,
    };
    renderSection();
    const first = screen.getByText('先方は来月に決裁').closest('div.rounded-lg') as HTMLElement;
    await user.click(within(first).getByRole('button', { name: 'コメントの操作' }));
    const item = await screen.findByRole('menuitem', { name: '削除' });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(
      screen.getByText('ほかの人の返信があるコメントは、オーナーだけが削除できます')
    ).toBeInTheDocument();
  });

  it('asks before deleting, and deletes the chosen comment', async () => {
    const user = userEvent.setup();
    renderSection();
    const first = screen.getByText('先方は来月に決裁').closest('div.rounded-lg') as HTMLElement;
    await user.click(within(first).getByRole('button', { name: 'コメントの操作' }));
    await user.click(await screen.findByRole('menuitem', { name: '削除' }));

    const dialog = await screen.findByRole('alertdialog', { name: 'このコメントを削除しますか？' });
    expect(mocks.mutate.delete).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: '削除' }));
    expect(mocks.mutate.delete).toHaveBeenCalledWith({ organizationId: ORG_ID, id: 'c1' });
  });
});
