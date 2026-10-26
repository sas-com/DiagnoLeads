/**
 * The deals list (#436, #720): a passed close date said with an icon and words (not only in red),
 * the lead's company and name, the next step and the board card's marks on each row, the days
 * written like the date boxes, a lost deal's badge with an icon, the headers that sort the list
 * (named by their column, the order in aria-sort and the caption), and how long won and lost
 * deals stay listed (real next-intl messages)
 */
import { DealTable } from '@/components/features/deals/deal-table';
import type { DealSort } from '@/components/features/deals/deal-list-sort';
import type { DealCard } from '@/lib/features/deals/service';
import messages from '@/locales/ja/common.json';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

const TODAY = '2026-10-24';

const card = (overrides: Partial<DealCard>): DealCard => ({
  id: 'deal-1',
  leadId: 'lead-1',
  name: 'AS/400 現行調査',
  kind: 'survey',
  stage: 'proposal',
  amount: 3_000_000,
  probability: 40,
  weightedAmount: 1_200_000,
  forecastOverride: null,
  forecastCategory: 'best_case',
  expectedCloseOn: '2026-11-30',
  closedOn: null,
  lostReason: null,
  lostNote: null,
  competitor: null,
  targetSystem: null,
  nextStep: '見積を送る',
  ownerUserId: 'user-1',
  ownerName: '営業 花子',
  previousDealId: null,
  stageChangedAt: new Date('2026-10-20T00:00:00Z'),
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-20T00:00:00Z'),
  leadName: '山田 太郎',
  company: '架空商事',
  hasOpenTask: true,
  ...overrides,
});

function renderTable(deals: DealCard[], sort: DealSort = { by: 'stage', order: 'asc' }) {
  const onSort = vi.fn();
  const view = render(
    <NextIntlClientProvider locale="ja" messages={messages}>
      <DealTable deals={deals} today={TODAY} closedWithinDays={30} sort={sort} onSort={onSort} />
    </NextIntlClientProvider>
  );
  return { onSort, container: view.container };
}

const rowOf = (name: string) =>
  screen.getByRole('link', { name }).closest('tr') as HTMLTableRowElement;

describe('DealTable', () => {
  it('shows each deal with its next step and the marks of its board card', () => {
    renderTable([
      card({}),
      card({ id: 'deal-2', name: '移行', nextStep: null, hasOpenTask: false, amount: null }),
    ]);
    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent);
    expect(headers).toEqual([
      '商談名',
      '会社・氏名',
      'ステージ',
      '金額（税抜）',
      '確度',
      '受注予定日',
      '注意',
      '担当',
      '次の一手',
    ]);
    const first = rowOf('AS/400 現行調査');
    expect(within(first).getByText('見積を送る')).toBeInTheDocument();
    expect(within(first).getByText('2026/11/30')).toBeInTheDocument();
    // The company and the name on two lines, as on the board's cards
    const lead = within(first).getByRole('link', { name: '架空商事 山田 太郎' });
    expect(lead).toHaveAttribute('href', '/ja/leads/lead-1');
    expect(within(lead).getByText('架空商事')).toBeInTheDocument();
    expect(within(lead).getByText('山田 太郎')).toBeInTheDocument();

    const second = rowOf('移行');
    expect(within(second).getByText('リードに次の行動（タスク）がありません')).toBeInTheDocument();
    expect(within(second).getAllByText('—')).toHaveLength(2);
  });

  it('says a passed close date with an icon and words, not only in red', () => {
    renderTable([card({ expectedCloseOn: '2026-10-01' })]);
    const row = rowOf('AS/400 現行調査');
    const date = within(row).getByText('2026/10/01');
    expect(date).toHaveClass('text-red-700');
    expect(date.querySelector('svg')).not.toBeNull();
    const mark = within(row).getByText('受注予定日を過ぎています');
    expect(mark.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('does not mark closed deals, and gives a lost deal an icon besides its grey', () => {
    renderTable([
      card({ stage: 'lost', probability: 0, expectedCloseOn: '2026-10-01', hasOpenTask: false }),
    ]);
    const row = rowOf('AS/400 現行調査');
    expect(within(row).queryByText('受注予定日を過ぎています')).not.toBeInTheDocument();
    expect(within(row).queryByText('リードに次の行動（タスク）がありません')).not.toBeInTheDocument();
    expect(within(row).getByText('失注').querySelector('svg')).not.toBeNull();
    expect(within(row).getByText('2026/10/01')).not.toHaveClass('text-red-700');
  });

  it('links the name alone, or the company alone, and links neither when the lead has none', () => {
    renderTable([
      card({ id: 'deal-2', name: '移行', company: null }),
      card({ id: 'deal-3', name: 'AX 化', leadName: null }),
      card({ id: 'deal-4', name: '保守', company: null, leadName: null }),
    ]);
    expect(within(rowOf('移行')).getByRole('link', { name: '山田 太郎' })).toBeInTheDocument();
    expect(within(rowOf('AX 化')).getByRole('link', { name: '架空商事' })).toBeInTheDocument();
    const none = rowOf('保守');
    expect(within(none).getAllByRole('link')).toHaveLength(1);
    expect(within(none).getAllByRole('cell')[1]).toHaveTextContent('—');
  });

  it('sorts by stage, amount and expected close date from headers named by their column', async () => {
    const user = userEvent.setup();
    const { onSort } = renderTable([card({})], { by: 'amount', order: 'desc' });
    expect(screen.getByRole('columnheader', { name: /金額/ })).toHaveAttribute(
      'aria-sort',
      'descending'
    );
    expect(screen.getByRole('columnheader', { name: /ステージ/ })).toHaveAttribute(
      'aria-sort',
      'none'
    );
    expect(screen.getByRole('columnheader', { name: '確度' })).not.toHaveAttribute('aria-sort');
    // The order is in aria-sort and the caption, not in the buttons' names (#720)
    expect(screen.getByRole('table', { name: '商談の一覧（金額の大きい順）' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '金額（税抜）' }));
    expect(onSort).toHaveBeenLastCalledWith('amount');
    await user.click(screen.getByRole('button', { name: '受注予定日' }));
    expect(onSort).toHaveBeenLastCalledWith('expectedCloseOn');
    await user.click(screen.getByRole('button', { name: 'ステージ' }));
    expect(onSort).toHaveBeenLastCalledWith('stage');
  });

  it.each([
    [{ by: 'stage', order: 'asc' }, '商談の一覧（ステージの順）'],
    [{ by: 'amount', order: 'asc' }, '商談の一覧（金額の小さい順）'],
    [{ by: 'expectedCloseOn', order: 'asc' }, '商談の一覧（受注予定日の早い順）'],
    [{ by: 'expectedCloseOn', order: 'desc' }, '商談の一覧（受注予定日の遅い順）'],
  ] as const)('names the table by its order %o', (sort, name) => {
    renderTable([card({})], sort);
    expect(screen.getByRole('table', { name })).toBeInTheDocument();
  });

  it('says above the table that won and lost deals are those of the last 30 days', () => {
    renderTable([card({})]);
    expect(screen.getByText('受注・失注は直近30日の商談を表示しています')).toBeVisible();
  });

  it('writes no text under 14px and gives its links and buttons 44px on phones', () => {
    const { container } = renderTable([card({ expectedCloseOn: '2026-10-01', hasOpenTask: false })]);
    expect(container.querySelector('.text-xs')).toBeNull();
    expect(screen.getByRole('link', { name: 'AS/400 現行調査' })).toHaveClass('min-h-11');
    expect(screen.getByRole('link', { name: '架空商事 山田 太郎' })).toHaveClass('min-h-11');
    expect(screen.getByRole('button', { name: 'ステージ' })).toHaveClass('h-11');
  });

  it('says when there is nothing to list, in the dark theme too', () => {
    renderTable([]);
    expect(screen.getByText('条件に合う商談はありません')).toHaveClass('dark:text-gray-300');
  });
});
