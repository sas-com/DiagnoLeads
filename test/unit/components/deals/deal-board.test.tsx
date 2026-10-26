/**
 * The pipeline board (#436, #720): columns with their totals, the cards' warnings and dates,
 * moving a card with its menu (the keyboard and phone way, named with the card's stage) or by
 * dragging it, and the focus that follows a card moved from its menu. Real next-intl messages and
 * UI components.
 */
import { DealBoard } from '@/components/features/deals/deal-board';
import type { BoardColumn, DealCard } from '@/lib/features/deals/service';
import { DEAL_STAGES, type DealStage } from '@/lib/features/deals/types/pipeline';
import messages from '@/locales/ja/common.json';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture ??= () => false;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

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
  targetSystem: 'as400',
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

function columnsWith(deals: DealCard[]): BoardColumn[] {
  return DEAL_STAGES.map((stage) => {
    const inStage = deals.filter((deal) => deal.stage === stage);
    return {
      stage,
      count: inStage.length,
      amount: inStage.reduce((sum, deal) => sum + (deal.amount ?? 0), 0),
      weightedAmount: inStage.reduce((sum, deal) => sum + deal.weightedAmount, 0),
      deals: inStage,
    };
  });
}

function renderBoard(deals: DealCard[], canEdit = true) {
  const onMove = vi.fn();
  const view = render(
    <NextIntlClientProvider locale="ja" messages={messages}>
      <DealBoard
        columns={columnsWith(deals)}
        today={TODAY}
        closedWithinDays={30}
        canEdit={canEdit}
        onMove={onMove}
      />
    </NextIntlClientProvider>
  );
  return { onMove, container: view.container };
}

/** A board whose cards move when asked, as the screen shows a move between open stages */
function MovingBoard({ deals }: { deals: DealCard[] }) {
  const [shown, setShown] = useState(deals);
  const move = (deal: DealCard, stage: DealStage) =>
    setShown((all) => all.map((each) => (each.id === deal.id ? { ...each, stage } : each)));
  return (
    <NextIntlClientProvider locale="ja" messages={messages}>
      <DealBoard
        columns={columnsWith(shown)}
        today={TODAY}
        closedWithinDays={30}
        canEdit
        onMove={move}
      />
    </NextIntlClientProvider>
  );
}

/** The card's move button in an open stage's column, which is named with that stage */
const moveButtonIn = (column: string) =>
  within(screen.getByRole('region', { name: column })).getByRole('button', {
    name: `「AS/400 現行調査」のステージを移動（今：${column}）`,
  });

describe('DealBoard', () => {
  it('shows one column per stage with its count and amount', () => {
    renderBoard([
      card({ id: 'a' }),
      card({ id: 'b', name: '移行', amount: 5_000_000, weightedAmount: 2_000_000 }),
    ]);
    const proposal = screen.getByRole('region', { name: '提案' });
    expect(within(proposal).getByText(/2件/)).toBeInTheDocument();
    expect(within(proposal).getByText(/加重/)).toBeInTheDocument();
    expect(within(proposal).getAllByRole('listitem')).toHaveLength(2);
    expect(
      within(screen.getByRole('region', { name: '受注（直近30日）' })).getByText('商談はありません')
    ).toBeInTheDocument();
  });

  it('says that the won and lost columns show only the deals closed lately', () => {
    renderBoard([]);
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([
      '見極め',
      '課題の確認',
      '提案',
      '条件の調整',
      '受注（直近30日）',
      '失注（直近30日）',
    ]);
  });

  it('links each card to the deal and shows its company, close date, owner and next step', () => {
    renderBoard([card({})]);
    expect(screen.getByRole('link', { name: 'AS/400 現行調査' })).toHaveAttribute(
      'href',
      '/ja/deals/deal-1'
    );
    expect(screen.getByText('架空商事 山田 太郎')).toBeInTheDocument();
    // The day as the date boxes write it (#720)
    expect(screen.getByText('2026/11/30 · 営業 花子')).toBeInTheDocument();
    expect(screen.getByText('見積を送る')).toBeInTheDocument();
  });

  it('writes no text under 14px and gives the move button 44px on phones (#720)', () => {
    const { container } = renderBoard([card({ expectedCloseOn: '2026-10-01', hasOpenTask: false })]);
    expect(container.querySelector('.text-xs')).toBeNull();
    expect(moveButtonIn('提案')).toHaveClass(
      'h-11',
      'w-11',
      'md:h-8',
      'md:w-8'
    );
  });

  it('warns about a passed close date and a deal without a next action', () => {
    renderBoard([card({ expectedCloseOn: '2026-10-01', hasOpenTask: false })]);
    expect(screen.getByText('受注予定日を過ぎています')).toBeInTheDocument();
    // The lead's open tasks, not the deal's next step
    expect(screen.getByText('リードに次の行動（タスク）がありません')).toBeInTheDocument();
  });

  it('does not warn about won deals', () => {
    renderBoard([
      card({ stage: 'won', expectedCloseOn: '2026-10-01', hasOpenTask: false, closedOn: TODAY }),
    ]);
    expect(screen.queryByText('受注予定日を過ぎています')).not.toBeInTheDocument();
    expect(screen.queryByText('リードに次の行動（タスク）がありません')).not.toBeInTheDocument();
  });

  it('moves a card with its menu, whose button says where the card is now', async () => {
    const user = userEvent.setup();
    const { onMove } = renderBoard([
      card({}),
      card({ id: 'deal-2', name: '移行', stage: 'won', closedOn: TODAY }),
    ]);
    // The stage in the name, so the move is chosen knowing where from (#720)
    expect(
      screen.getByRole('button', { name: '「移行」のステージを移動（今：受注）' })
    ).toBeInTheDocument();
    await user.click(moveButtonIn('提案'));
    const items = screen.getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).not.toContain('「提案」に移す');
    await user.click(screen.getByRole('menuitem', { name: '「条件の調整」に移す' }));
    expect(onMove).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'deal-1' }),
      'negotiation',
      { returnFocus: expect.any(Function) }
    );
  });

  it('keeps the focus on the move button of a card moved from its menu (#720)', async () => {
    const user = userEvent.setup();
    render(<MovingBoard deals={[card({})]} />);
    await user.click(moveButtonIn('提案'));
    await user.click(screen.getByRole('menuitem', { name: '「条件の調整」に移す' }));
    expect(moveButtonIn('条件の調整')).toHaveFocus();

    // Again with the keyboard, from its new column
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('menuitem', { name: '「見極め」に移す' }));
    expect(moveButtonIn('見極め')).toHaveFocus();
  });

  it('gives the focus back to the card when the question of its move closes', async () => {
    const user = userEvent.setup();
    const { onMove } = renderBoard([card({})]);
    await user.click(moveButtonIn('提案'));
    await user.click(screen.getByRole('menuitem', { name: '「受注」に移す' }));
    const options = onMove.mock.lastCall?.[2] as { returnFocus: () => boolean };
    (document.activeElement as HTMLElement | null)?.blur();

    let returned = false;
    act(() => {
      returned = options.returnFocus();
    });
    expect(returned).toBe(true);
    expect(moveButtonIn('提案')).toHaveFocus();
  });

  it('says when the card is no longer on the board to give the focus back to (#720)', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    const board = (deals: DealCard[]) => (
      <NextIntlClientProvider locale="ja" messages={messages}>
        <DealBoard
          columns={columnsWith(deals)}
          today={TODAY}
          closedWithinDays={30}
          canEdit
          onMove={onMove}
        />
      </NextIntlClientProvider>
    );
    const { rerender } = render(board([card({})]));
    await user.click(moveButtonIn('提案'));
    await user.click(screen.getByRole('menuitem', { name: '「受注」に移す' }));
    const options = onMove.mock.lastCall?.[2] as { returnFocus: () => boolean };

    // A filter left the card out: the question puts the focus back as it would on its own
    rerender(board([]));
    expect(options.returnFocus()).toBe(false);
  });

  it('moves a card dragged to another column', () => {
    const { onMove } = renderBoard([card({})]);
    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? '',
      effectAllowed: '',
      dropEffect: '',
    };
    fireEvent.dragStart(screen.getAllByRole('listitem')[0], { dataTransfer });
    const won = screen.getByRole('region', { name: '受注（直近30日）' });
    fireEvent.dragOver(won, { dataTransfer });
    fireEvent.drop(won, { dataTransfer });
    expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ id: 'deal-1' }), 'won');
  });

  it('offers no moves to read-only viewers', () => {
    renderBoard([card({})], false);
    expect(
      screen.queryByRole('button', { name: /^「AS\/400 現行調査」のステージを移動/ })
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem')[0]).toHaveAttribute('draggable', 'false');
  });
});
