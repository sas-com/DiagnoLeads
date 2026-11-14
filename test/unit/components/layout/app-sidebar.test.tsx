/**
 * The side menu of the normal view follows the places of the office (#1163, Epic #1161): the
 * office first, then each place with the pages of its work, under the names of the floor guide.
 */
import AppSidebar from '@/components/layout/AppSidebar';
import { MESSAGE_FILES, mergeMessageFiles } from '@/lib/i18n/messages';
import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/context/SidebarContext', () => ({
  useSidebar: () => ({
    isExpanded: true,
    isMobileOpen: false,
    isHovered: false,
    setIsHovered: vi.fn(),
  }),
}));
vi.mock('@/components/layout/SidebarWidget', () => ({ default: () => null }));

const messages = mergeMessageFiles(MESSAGE_FILES.ja);

function renderSidebar() {
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <AppSidebar />
    </NextIntlClientProvider>
  );
  return screen.getByRole('navigation');
}

describe('the side menu (#1163)', () => {
  it('puts the office first, then the places of the office in the order of the floor guide', () => {
    const nav = renderSidebar();
    expect(within(nav).getAllByRole('heading').map((heading) => heading.textContent)).toEqual([
      '社長のデスク',
      'マーケティング室',
      '営業フロア',
      '総務・受付',
    ]);
    const links = within(nav).getAllByRole('link');
    expect(links[0]).toHaveTextContent('AI社員オフィス');
    expect(links[0]).toHaveAttribute('href', '/ja/office');
  });

  it('lists the pages of each place under it', () => {
    const nav = renderSidebar();
    const section = (name: string) =>
      within(within(nav).getByRole('heading', { name }).parentElement as HTMLElement);
    expect(section('社長のデスク').getAllByRole('link').map((link) => link.textContent)).toEqual([
      '今日',
      'ダッシュボード',
    ]);
    expect(
      section('マーケティング室').getAllByRole('link').map((link) => link.textContent)
    ).toEqual(['リード管理', '分析']);
    expect(section('営業フロア').getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(
      ['/ja/deals', '/ja/forecast', '/ja/prospects']
    );
    expect(section('総務・受付').getByRole('button', { name: /設定/ })).toBeInTheDocument();
  });
});
