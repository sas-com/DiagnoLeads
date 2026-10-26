/**
 * The form of a comment or a note (#722): the type is chosen in a toggle group that says what
 * the two differ in, Ctrl or ⌘ + Enter sends (not Enter alone, not while a conversion is open),
 * and a failed write keeps the text and is said under the field. Texts are made up.
 */
import { CommentForm } from '@/components/features/comments/comment-form';
import messages from '@/locales/ja/common.json';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '770e8400-e29b-41d4-a716-446655440000';

type Submit = (content: string, type: 'comment' | 'note') => Promise<void>;

const renderForm = (onSubmit: Submit, reply = false) =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <CommentForm
        organizationId={ORG_ID}
        leadId={LEAD_ID}
        onSubmit={onSubmit}
        onCancel={reply ? vi.fn() : undefined}
        placeholder={reply ? '返信を入力…' : undefined}
        isReply={reply}
      />
    </NextIntlClientProvider>
  );

describe('CommentForm', () => {
  it('chooses the type in a toggle group that says what the two differ in', async () => {
    const user = userEvent.setup();
    renderForm(vi.fn());
    const types = screen.getByRole('group', { name: '種類' });
    expect(types).toHaveAccessibleDescription('コメントには返信できます。メモには返信できません。');
    const comment = within(types).getByRole('radio', { name: 'コメント' });
    const note = within(types).getByRole('radio', { name: 'メモ' });
    expect(comment).toBeChecked();
    expect(screen.getByPlaceholderText('コメントを追加…')).toBeInTheDocument();

    await user.click(note);
    expect(note).toBeChecked();
    expect(comment).not.toBeChecked();
    expect(screen.getByPlaceholderText('メモを追加…')).toBeInTheDocument();
    // Choosing it again keeps it chosen: there is always a type
    await user.click(note);
    expect(note).toBeChecked();
  });

  it('sends with Ctrl+Enter, not with Enter alone nor while a conversion is open', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<Submit>().mockResolvedValue(undefined);
    renderForm(onSubmit);
    const box = screen.getByRole('textbox', { name: 'コメント' });
    expect(box).toHaveAttribute('aria-keyshortcuts', 'Control+Enter Meta+Enter');
    await user.click(box);
    await user.paste('来週に再訪');

    // Enter while converting kana to kanji confirms the conversion
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true, isComposing: true });
    await user.keyboard('{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();

    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(onSubmit).toHaveBeenCalledWith('来週に再訪', 'comment');
    expect(box).toHaveValue('');
  });

  it('keeps the text of a failed write and says so under the field', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<Submit>().mockRejectedValue(new Error('network'));
    renderForm(onSubmit);
    await user.click(
      within(screen.getByRole('group', { name: '種類' })).getByRole('radio', { name: 'メモ' })
    );
    const box = screen.getByRole('textbox', { name: 'メモ' });
    await user.click(box);
    await user.paste('担当は情報システム部');
    await user.click(screen.getByRole('button', { name: '送信' }));

    expect(onSubmit).toHaveBeenCalledWith('担当は情報システム部', 'note');
    expect(box).toHaveValue('担当は情報システム部');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('メモの追加に失敗しました');
    expect(box).toHaveAccessibleDescription('メモの追加に失敗しました');
  });

  it('sends a reply as a comment, with no type to choose, from an outline button', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<Submit>().mockRejectedValueOnce(new Error('network'));
    renderForm(onSubmit, true);
    expect(screen.queryByRole('group', { name: '種類' })).not.toBeInTheDocument();
    const box = screen.getByRole('textbox', { name: '返信を入力…' });
    await user.click(box);
    await user.paste('承知しました');
    const send = screen.getByRole('button', { name: '送信' });
    expect(send).toHaveClass('border', 'border-gray-300', 'min-h-11', 'min-w-11');
    await user.click(send);

    expect(onSubmit).toHaveBeenCalledWith('承知しました', 'comment');
    expect(screen.getByRole('alert')).toHaveTextContent('コメントの追加に失敗しました');
    expect(box).toHaveValue('承知しました');
  });
});
