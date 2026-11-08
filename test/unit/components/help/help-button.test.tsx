/**
 * The "how to use this screen" button of the header (Epic #877, #872): it opens the article of
 * the page being shown and is hidden on a page without one. The articles are made up.
 */
import { HelpButton } from '@/components/features/help/help-button';
import messages from '@/locales/ja/common.json';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ pathname: '/ja/leads' }));
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }));
vi.mock('@/lib/features/help/articles', () => ({
  helpArticleById: (id: string) =>
    id === 'related-one'
      ? { id, locale: 'ja', title: '関連の記事', summary: '', routes: [], reviewedAt: '2026-10-28', blocks: [] }
      : undefined,
  HELP_ARTICLES: [
    {
      id: 'leads',
      locale: 'ja',
      title: 'リード一覧のテスト',
      summary: '一覧の要約',
      routes: ['/leads'],
      reviewedAt: '2026-10-28',
      related: ['related-one'],
      blocks: [
        { type: 'h2', id: 'find', text: '探す' },
        {
          type: 'p',
          content: [
            { type: 'text', text: '押すのは' },
            { type: 'ui', text: '絞り込み' },
            { type: 'text', text: 'です。詳しくは' },
            { type: 'link', text: '今日', href: '/today' },
          ],
        },
        { type: 'steps', items: ['一つめ', '二つめ'] },
        { type: 'table', header: ['欄', '意味'], rows: [['状態', '進み具合']] },
        { type: 'note', tone: 'caution', content: '元に戻せません' },
        { type: 'note', tone: 'tip', content: '近道があります' },
        { type: 'roles', roles: ['member', 'parent_viewer'], content: '削除はできません' },
        { type: 'faq', items: [{ question: '質問ですか', answer: '答えです' }] },
      ],
    },
  ],
}));

const renderButton = () =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <HelpButton />
    </NextIntlClientProvider>
  );

beforeEach(() => {
  mocks.pathname = '/ja/leads';
});

describe('HelpButton', () => {
  it('links to the help center on a page without an article', () => {
    mocks.pathname = '/ja/settings';
    renderButton();
    expect(screen.queryByRole('button', { name: 'この画面の使い方' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ヘルプ' })).toHaveAttribute('href', '/ja/help');
  });

  it('shows nothing in the help center itself', () => {
    for (const pathname of ['/ja/help', '/ja/help/leads']) {
      mocks.pathname = pathname;
      const { container, unmount } = renderButton();
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });

  it('leads from the panel to the help center and the related articles', async () => {
    renderButton();
    await userEvent.click(screen.getByRole('button', { name: 'この画面の使い方' }));
    expect(screen.getByRole('link', { name: 'ヘルプセンターを開く' })).toHaveAttribute(
      'href',
      '/ja/help/leads'
    );
    expect(screen.getByRole('link', { name: '関連の記事' })).toHaveAttribute(
      'href',
      '/ja/help/related-one'
    );
  });

  it('opens the article of the page', async () => {
    renderButton();
    await userEvent.click(screen.getByRole('button', { name: 'この画面の使い方' }));
    const panel = screen.getByRole('dialog', { name: 'リード一覧のテスト' });
    expect(panel).toHaveAccessibleDescription('一覧の要約');
    expect(within(panel).getByRole('heading', { name: '探す' })).toBeInTheDocument();
    expect(within(panel).getByText('絞り込み')).toBeInTheDocument();
    const [steps] = within(panel).getAllByRole('list');
    expect(within(steps).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '一つめ',
      '二つめ',
    ]);
    expect(within(panel).getByRole('cell', { name: '進み具合' })).toBeInTheDocument();
    expect(within(panel).getByText('注意')).toBeInTheDocument();
    expect(within(panel).getByText('元に戻せません')).toBeInTheDocument();
    expect(within(panel).getByText('近道があります')).toBeInTheDocument();
    expect(within(panel).getByText('答えです')).toBeInTheDocument();
    expect(within(panel).getByText(/2026-10-28/)).toBeInTheDocument();
  });

  it('names the roles a note is about', async () => {
    renderButton();
    await userEvent.click(screen.getByRole('button', { name: 'この画面の使い方' }));
    const roles = [messages.help.roles.member, messages.help.roles.parent_viewer].join('・');
    expect(screen.getByText(messages.help.rolesTitle.replace('{roles}', roles))).toBeInTheDocument();
  });

  it('links with the locale of the page and closes when a link is followed', async () => {
    renderButton();
    await userEvent.click(screen.getByRole('button', { name: 'この画面の使い方' }));
    const link = screen.getByRole('link', { name: '今日' });
    expect(link).toHaveAttribute('href', '/ja/today');
    await userEvent.click(link);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
