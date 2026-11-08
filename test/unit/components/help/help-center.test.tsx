/**
 * The help center (#874): the table of contents, the search over every article, and an article
 * page with its screen link and the articles to read next. Uses the real articles.
 */
import { HelpArticlePage } from '@/components/features/help/help-article-page';
import { HelpCenter } from '@/components/features/help/help-center';
import { helpArticleById } from '@/lib/features/help/articles';
import messages from '@/locales/ja/common.json';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

const wrap = (node: ReactNode) =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      {node}
    </NextIntlClientProvider>
  );

describe('HelpCenter', () => {
  it('shows the table of contents by section', () => {
    wrap(<HelpCenter />);
    const toc = screen.getByRole('navigation', { name: '目次' });
    for (const section of ['業務の流れ', '画面の使い方', '設定の使い方', '用語集']) {
      expect(within(toc).getByRole('heading', { name: section })).toBeInTheDocument();
    }
    expect(within(toc).getByRole('link', { name: /リードから受注までの流れ/ })).toHaveAttribute(
      'href',
      '/ja/help/workflow-lifecycle'
    );
  });

  it('searches the articles and says so when nothing matches', async () => {
    wrap(<HelpCenter />);
    const search = screen.getByRole('searchbox', { name: 'ヘルプを検索' });
    await userEvent.type(search, '招待');
    expect(screen.queryByRole('navigation', { name: '目次' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link')[0]).toHaveAttribute('href', '/ja/help/settings-members');

    await userEvent.clear(search);
    await userEvent.type(search, 'どこにもない言葉');
    expect(screen.getByText(/「どこにもない言葉」に合う記事はありません/)).toBeInTheDocument();
  });
});

describe('HelpArticlePage', () => {
  it('links to its screen and the articles to read next', () => {
    const article = helpArticleById('deals');
    if (!article) throw new Error('the deals article is missing');
    wrap(<HelpArticlePage article={article} />);
    expect(screen.getByRole('heading', { level: 1, name: '商談' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'この画面を開く' })).toHaveAttribute('href', '/ja/deals');
    const related = screen.getByRole('navigation', { name: 'あわせて読む' });
    expect(within(related).getByRole('link', { name: /用語集/ })).toHaveAttribute(
      'href',
      '/ja/help/glossary'
    );
    expect(screen.getByRole('link', { name: /ヘルプの目次へ/ })).toHaveAttribute('href', '/ja/help');
  });

  it('has no screen link for a page of one record or a workflow', () => {
    for (const id of ['lead-detail', 'workflow-lifecycle']) {
      const article = helpArticleById(id);
      if (!article) throw new Error(`the ${id} article is missing`);
      const { unmount } = wrap(<HelpArticlePage article={article} />);
      expect(screen.queryByRole('link', { name: 'この画面を開く' })).not.toBeInTheDocument();
      unmount();
    }
  });
});
