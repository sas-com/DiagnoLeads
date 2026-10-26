/**
 * The form of a comment or a note (#722): the type is chosen in a labelled fieldset that says
 * what the two differ in, Ctrl or ⌘ + Enter sends (not Enter alone, not the keys of a
 * conversion, Safari's included), a failed write keeps the text and is said under the field,
 * and an empty reply closes with Esc. Texts are made up.
 */
import { CommentForm } from '@/components/features/comments/comment-form';
import messages from '@/locales/ja/common.json';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '770e8400-e29b-41d4-a716-446655440000';

type Submit = (content: string, type: 'comment' | 'note') => Promise<void>;

const renderForm = (onSubmit: Submit, reply = false, onCancel = vi.fn()) =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <CommentForm
        organizationId={ORG_ID}
        leadId={LEAD_ID}
        onSubmit={onSubmit}
        onCancel={reply ? onCancel : undefined}
        placeholder={reply ? '返信を入力…' : undefined}
        label={reply ? '営業 太郎さんへの返信' : undefined}
        isReply={reply}
      />
    </NextIntlClientProvider>
  );

describe('CommentForm', () => {
  it('chooses the type in a fieldset with a visible legend that says what the two differ in', async () => {
    const user = userEvent.setup();
    renderForm(vi.fn());
    const types = screen.getByRole('group', { name: '種類' });
    expect(types.tagName).toBe('FIELDSET');
    expect(within(types).getByText('種類').tagName).toBe('LEGEND');
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

  it('sends with Ctrl+Enter, not with Enter alone nor with the keys of a conversion', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<Submit>().mockResolvedValue(undefined);
    renderForm(onSubmit);
    const box = screen.getByRole('textbox', { name: 'コメント' });
    expect(box).toHaveAttribute('aria-keyshortcuts', 'Control+Enter Meta+Enter');
    await user.click(box);
    await user.paste('来週に再訪');

    // Enter while converting kana to kanji confirms the conversion
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true, isComposing: true });
    // Safari sends the Enter that confirms it after compositionend, as keyCode 229
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true, keyCode: 229 });
    await user.keyboard('{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();

    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(onSubmit).toHaveBeenCalledWith('来週に再訪', 'comment');
    expect(box).toHaveValue('');
  });

  it('shows a spinner on the send button while sending, and keeps the field focusable', async () => {
    const user = userEvent.setup();
    let resolve: () => void = () => {};
    const onSubmit = vi.fn<Submit>(
      () =>
        new Promise<void>((done) => {
          resolve = () => done();
        })
    );
    renderForm(onSubmit);
    const box = screen.getByRole('textbox', { name: 'コメント' });
    await user.click(box);
    await user.paste('見積は来週');
    const send = screen.getByRole('button', { name: '送信' });
    expect(send.querySelector('.animate-spin')).toBeNull();

    await user.click(send);
    expect(send.querySelector('.animate-spin')).not.toBeNull();
    expect(box).toHaveAttribute('readonly');
    expect(box).not.toBeDisabled();

    resolve();
    await waitFor(() => expect(box).toHaveValue(''));
    expect(send.querySelector('.animate-spin')).toBeNull();
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

  it('tells who can read it, and the shortcut on wider screens only (phones have no Ctrl)', () => {
    renderForm(vi.fn());
    const box = screen.getByRole('textbox', { name: 'コメント' });
    const shortcut = screen.getByText('Ctrl＋Enter（Mac は ⌘＋Enter）で送信できます');
    expect(shortcut).toHaveClass('hidden', 'md:block');
    // The shortcut is still announced with the field
    expect(box).toHaveAttribute('aria-keyshortcuts', 'Control+Enter Meta+Enter');
    expect(box.getAttribute('aria-describedby')).toBe(
      screen.getByText('書いたコメント・メモは、組織のメンバーに見えます').parentElement?.id
    );
  });

  it('sends a reply as a comment, with no type to choose, from an outline button', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<Submit>().mockRejectedValueOnce(new Error('network'));
    renderForm(onSubmit, true);
    expect(screen.queryByRole('group', { name: '種類' })).not.toBeInTheDocument();
    // Named for whom it answers, not by its placeholder's "…"
    const box = screen.getByRole('textbox', { name: '営業 太郎さんへの返信' });
    expect(box).toHaveAttribute('placeholder', '返信を入力…');
    await user.click(box);
    await user.paste('承知しました');
    const send = screen.getByRole('button', { name: '送信' });
    expect(send).toHaveClass('border', 'border-gray-300', 'min-h-11', 'min-w-11');
    await user.click(send);

    expect(onSubmit).toHaveBeenCalledWith('承知しました', 'comment');
    expect(screen.getByRole('alert')).toHaveTextContent('コメントの追加に失敗しました');
    expect(box).toHaveValue('承知しました');
  });

  it('closes an empty reply with Esc, but not one with text nor with the Esc of a conversion', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    renderForm(vi.fn(), true, onCancel);
    const box = screen.getByRole('textbox', { name: '営業 太郎さんへの返信' });
    expect(box).toHaveAttribute('aria-keyshortcuts', 'Control+Enter Meta+Enter Escape');
    await user.click(box);

    // The Esc that cancels a conversion, as Safari sends it after compositionend
    fireEvent.keyDown(box, { key: 'Escape', keyCode: 229 });
    fireEvent.keyDown(box, { key: 'Escape', isComposing: true });
    expect(onCancel).not.toHaveBeenCalled();

    // What is written is not thrown away
    await user.paste('承知');
    await user.keyboard('{Escape}');
    expect(onCancel).not.toHaveBeenCalled();
    expect(box).toHaveValue('承知');

    await user.clear(box);
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
