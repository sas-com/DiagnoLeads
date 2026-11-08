/**
 * One comment of the lead page (#722): an article with its type (not on a reply) and pin in
 * words, when it was written as a time element (the relative time as its title), no gray
 * lighter than gray-600, an avatar and icons left out of what is read, buttons described by
 * who wrote it and when, long names and texts that wrap on phones, a reply at the end of the
 * thread that takes the focus as it opens, and an edit that does too (Esc gives it up, Ctrl or
 * ⌘ + Enter saves it, not the keys of a conversion; a failure is said under the field). Names and
 * texts are made up.
 */
import { CommentItem, type CommentWithUser } from '@/components/features/comments/comment-item';
import messages from '@/locales/ja/common.json';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

const withReply = () =>
  comment({
    replies: [
      comment({
        id: 'r1',
        content: '承知',
        parentId: 'c1',
        user: { id: ME, name: '営業 花子', email: 'hanako@example.com', image: null },
      }),
    ],
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

const articleOf = (text: string) => screen.getByText(text).closest('article') as HTMLElement;

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

  it('leaves the type out of a reply: a reply is always a comment', () => {
    renderItem(withReply());
    expect(within(articleOf('先方は来月に決裁')).getByText('コメント')).toBeInTheDocument();
    expect(within(articleOf('承知')).queryByText('コメント')).toBeNull();
  });

  it('is an article, with its replies in a list of their own', () => {
    renderItem(withReply());
    const [first, reply] = screen.getAllByRole('article');
    expect(first).toHaveTextContent('先方は来月に決裁');
    expect(reply).toHaveTextContent('承知');
    const replies = screen.getByRole('list');
    expect(within(replies).getByRole('listitem')).toContainElement(reply);
    expect(replies).not.toContainElement(first);
  });

  it('shows when it was written in Japan time, the relative time as its title', () => {
    renderItem(comment());
    const time = screen.getByText('2026/10/22 14:30');
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('datetime', '2026-10-22T05:30:00.000Z');
    expect(time).toHaveAttribute('title', '3 時間前');
    expect(screen.queryByText(/編集済み/)).toBeNull();
  });

  it('says it was edited, the parentheses being the message’s', () => {
    renderItem(comment({ updatedAt: new Date('2026-10-22T06:00:00Z') }));
    expect(screen.getByText('（編集済み）')).toBeInTheDocument();
    expect(screen.getByText('（編集済み）').textContent).toBe('2026/10/22 14:30（編集済み）');
  });

  it('writes no gray lighter than gray-600 in the light theme', () => {
    const { container } = renderItem(withReply(), { onReply: vi.fn(), onEdit: vi.fn() });
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

  it('wraps a long address and a long text rather than widening the page on phones', () => {
    const address = 'a-very-long-mailbox-name-of-the-sales-team@subsidiary.example.co.jp';
    const text = 'https://example.com/a/very/long/link/to/the/proposal/without/any/spaces';
    const { container } = renderItem(
      comment({ content: text, user: { id: ME, name: '', email: address, image: '/a.png' } })
    );
    expect(screen.getByText(text)).toHaveClass('[overflow-wrap:anywhere]', 'whitespace-pre-wrap');
    const name = screen.getByText(address);
    expect(name).toHaveClass('break-all');
    // Every flex box around the name may shrink below its content
    expect(name.parentElement).toHaveClass('min-w-0');
    expect(name.parentElement?.parentElement).toHaveClass('min-w-0');
    expect(name.parentElement?.parentElement?.parentElement).toHaveClass('min-w-0');
    expect(container.querySelector('img')).toHaveClass('shrink-0');
    expect(screen.getByRole('button', { name: 'コメントの操作' })).toHaveClass('shrink-0');
  });

  it('describes its menu and its reply by who wrote it and when', () => {
    renderItem(comment(), { onReply: vi.fn(), onEdit: vi.fn() });
    for (const name of ['コメントの操作', '返信']) {
      expect(screen.getByRole('button', { name })).toHaveAccessibleDescription(
        '営業 太郎 2026/10/22 14:30'
      );
    }
  });

  it('leaves every icon out of what is read, the menu’s too', async () => {
    const user = userEvent.setup();
    renderItem(comment({ isPinned: true }), { onReply: vi.fn(), onEdit: vi.fn() });
    await user.click(screen.getByRole('button', { name: 'コメントの操作' }));
    await screen.findByRole('menu');
    const icons = [...document.querySelectorAll('svg')];
    expect(icons.length).toBeGreaterThan(5);
    for (const icon of icons) expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('opens a reply with the focus in its field, and gives the focus back on cancel', async () => {
    const user = userEvent.setup();
    renderItem(comment(), { onReply: vi.fn() });
    const reply = screen.getByRole('button', { name: '返信' });
    await user.click(reply);
    expect(reply).toHaveAttribute('aria-expanded', 'true');
    // Named for whom it answers, not by its placeholder
    expect(screen.getByRole('textbox', { name: '営業 太郎さんへの返信' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(reply).toHaveFocus();
  });

  it('closes an empty reply with Esc, back to the reply button', async () => {
    const user = userEvent.setup();
    renderItem(comment(), { onReply: vi.fn() });
    const reply = screen.getByRole('button', { name: '返信' });
    await user.click(reply);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(reply).toHaveFocus();
  });

  it('names the reply of a deleted author just a reply', async () => {
    const user = userEvent.setup();
    renderItem(comment({ userId: null, user: null }), { onReply: vi.fn() });
    await user.click(screen.getByRole('button', { name: '返信' }));
    expect(screen.getByRole('textbox', { name: '返信' })).toHaveFocus();
  });

  it('opens the reply field at the end of the thread, after the replies', async () => {
    const user = userEvent.setup();
    renderItem(withReply(), { onReply: vi.fn() });
    await user.click(screen.getByRole('button', { name: '返信' }));
    const field = screen.getByRole('textbox', { name: '営業 太郎さんへの返信' });
    const lastReply = articleOf('承知');
    // The field follows the last reply in the document
    expect(lastReply.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
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

    // The Esc that cancels a conversion keeps the edit, Safari's (keyCode 229) too
    fireEvent.keyDown(field, { key: 'Escape', isComposing: true });
    fireEvent.keyDown(field, { key: 'Escape', keyCode: 229 });
    expect(field).toBeInTheDocument();

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

    // Not the Enter that confirms a conversion
    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true, keyCode: 229 });
    expect(onEdit).not.toHaveBeenCalled();

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

  it('shows a spinner on save while saving', async () => {
    const user = userEvent.setup();
    let resolve: () => void = () => {};
    const onEdit = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = () => done();
        })
    );
    renderItem(comment(), { onEdit });
    await openEdit(user);
    const save = screen.getByRole('button', { name: '保存' });
    expect(save.querySelector('.animate-spin')).toBeNull();
    await user.click(save);
    expect(save.querySelector('.animate-spin')).not.toBeNull();
    expect(save).toBeDisabled();

    resolve();
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument());
  });

  it('calls a note a note in its menu and its edit', async () => {
    const user = userEvent.setup();
    renderItem(comment({ type: 'note' }), { onEdit: vi.fn() });
    await openEdit(user, 'メモの操作');
    expect(screen.getByRole('textbox', { name: 'メモを編集' })).toBeInTheDocument();
    // A note takes no reply
    expect(screen.queryByRole('button', { name: '返信' })).not.toBeInTheDocument();
    const card = screen.getByRole('textbox').closest('article') as HTMLElement;
    expect(within(card).getByText('メモ')).toBeInTheDocument();
  });
});
