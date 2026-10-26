/**
 * One comment of the lead page (#722): its type and pin in words, when it was written as a
 * time element (the relative time as its title), no gray lighter than gray-600, an avatar left
 * out of what is read, and a reply or an edit that takes the focus as it opens (Esc gives the
 * edit up, Ctrl or ⌘ + Enter saves it, a failure is said under the field). Names and texts are
 * made up.
 */
import { CommentItem, type CommentWithUser } from '@/components/features/comments/comment-item';
import messages from '@/locales/ja/common.json';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '770e8400-e29b-41d4-a716-446655440000';
const ME = '880e8400-e29b-41d4-a716-446655440001';
// 14:30 in Japan, three hours before the clock of the section
const WRITTEN = new Date('2026-10-22T05:30:00Z');
const NOW = new Date('2026-10-22T08:30:00Z');

const comment = (overrides: Partial<CommentWithUser> = {}): CommentWithUser => ({
  id: 'c1',
  leadId: LEAD_ID,
  organizationId: ORG_ID,
  userId: ME,
  content: '先方は来月に決裁',
  type: 'comment',
  metadata: null,
  parentId: null,
  isPinned: false,
  createdAt: WRITTEN,
  updatedAt: WRITTEN,
  user: { id: ME, name: '営業 太郎', email: 'sales@example.com', image: null },
  replies: [],
  ...overrides,
});

type Handlers = {
  onEdit?: (id: string, content: string) => Promise<void>;
  onReply?: (parentId: string, content: string) => Promise<void>;
};

const renderItem = (item: CommentWithUser, handlers: Handlers = {}) =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <CommentItem
        comment={item}
        now={NOW}
        currentUserId={ME}
        organizationId={ORG_ID}
        leadId={LEAD_ID}
        onEdit={handlers.onEdit}
        onReply={handlers.onReply}
        onDelete={vi.fn()}
        onTogglePin={vi.fn()}
      />
    </NextIntlClientProvider>
  );

const openEdit = async (user: ReturnType<typeof userEvent.setup>, menu = 'コメントの操作') => {
  await user.click(screen.getByRole('button', { name: menu }));
  await user.click(await screen.findByRole('menuitem', { name: '編集' }));
};

describe('CommentItem', () => {
  it('says its type and its pin in words, not by icon and color alone', () => {
    const { unmount } = renderItem(comment({ type: 'note', isPinned: true }));
    expect(screen.getByText('メモ')).toBeInTheDocument();
    expect(screen.getByText('ピン留め中')).toBeInTheDocument();
    unmount();

    renderItem(comment());
    expect(screen.getByText('コメント')).toBeInTheDocument();
    expect(screen.queryByText('ピン留め中')).not.toBeInTheDocument();
  });

  it('shows when it was written in Japan time, the relative time as its title', () => {
    renderItem(comment());
    const time = screen.getByText('2026/10/22 14:30');
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('datetime', '2026-10-22T05:30:00.000Z');
    expect(time).toHaveAttribute('title', '3 時間前');
  });

  it('writes no gray lighter than gray-600 in the light theme', () => {
    const { container } = renderItem(
      comment({ replies: [comment({ id: 'r1', content: '承知', type: 'comment' })] }),
      { onReply: vi.fn(), onEdit: vi.fn() }
    );
    const light = [...container.querySelectorAll('[class]')].flatMap((element) =>
      [...element.classList].filter((name) =>
        /^(text-gray-(300|400|500)|text-muted-foreground)$/.test(name)
      )
    );
    expect(light).toEqual([]);
  });

  it('leaves the avatar out of what is read: the name is next to it', () => {
    const { container } = renderItem(
      comment({
        user: { id: ME, name: '営業 太郎', email: 'sales@example.com', image: '/avatar.png' },
      })
    );
    expect(container.querySelector('img')).toHaveAttribute('alt', '');
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('営業 太郎')).toBeInTheDocument();
  });

  it('opens a reply with the focus in its field, and gives the focus back on cancel', async () => {
    const user = userEvent.setup();
    renderItem(comment(), { onReply: vi.fn() });
    const reply = screen.getByRole('button', { name: '返信' });
    await user.click(reply);
    expect(reply).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('textbox', { name: '返信を入力…' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(reply).toHaveFocus();
  });

  it('opens the edit with the focus in its field, and gives it up with Esc', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn().mockResolvedValue(undefined);
    renderItem(comment(), { onEdit });
    await openEdit(user);

    const field = screen.getByRole('textbox', { name: 'コメントを編集' });
    await waitFor(() => expect(field).toHaveFocus());
    // The shared text area of the screens
    expect(field).toHaveClass('focus-visible:ring-teal-500');
    await user.keyboard('（確認中）');
    expect(field).toHaveValue('先方は来月に決裁（確認中）');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText('先方は来月に決裁')).toBeInTheDocument();
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'コメントの操作' })).toHaveFocus();
  });

  it('saves the edit with Ctrl+Enter, and says a failure under the field', async () => {
    const user = userEvent.setup();
    const onEdit = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(undefined);
    renderItem(comment(), { onEdit });
    await openEdit(user);
    const field = screen.getByRole('textbox', { name: 'コメントを編集' });
    await waitFor(() => expect(field).toHaveFocus());
    await user.clear(field);
    await user.paste('先方は再来月に決裁');

    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(onEdit).toHaveBeenCalledWith('c1', '先方は再来月に決裁');
    // Kept open with the text
    expect(field).toHaveValue('先方は再来月に決裁');
    expect(screen.getByRole('alert')).toHaveTextContent('コメントの更新に失敗しました');
    expect(field).toHaveAttribute('aria-describedby', screen.getByRole('alert').id);

    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(onEdit).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('calls a note a note in its menu and its edit', async () => {
    const user = userEvent.setup();
    renderItem(comment({ type: 'note' }), { onEdit: vi.fn() });
    await openEdit(user, 'メモの操作');
    expect(screen.getByRole('textbox', { name: 'メモを編集' })).toBeInTheDocument();
    // A note takes no reply
    expect(screen.queryByRole('button', { name: '返信' })).not.toBeInTheDocument();
    const card = screen.getByRole('textbox').closest('div.rounded-lg') as HTMLElement;
    expect(within(card).getByText('メモ')).toBeInTheDocument();
  });
});
