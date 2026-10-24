/**
 * The pipeline board (#436): columns with their totals, the cards' warnings, and moving a card
 * with its menu (the keyboard and phone way; dragging uses the same callback). Real next-intl
 * messages and UI components.
 */
import { DealBoard } from '@/components/features/deals/deal-board';
import type { BoardColumn, DealCard } from '@/lib/features/deals/service';
import { DEAL_STAGES } from '@/lib/features/deals/types/pipeline';
import messages from '@/locales/ja/common.json';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
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
  render(
    <NextIntlClientProvider locale="ja" messages={messages}>
      <DealBoard columns={columnsWith(deals)} today={TODAY} canEdit={canEdit} onMove={onMove} />
    </NextIntlClientProvider>
  );
  return { onMove };
}

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
    expect(within(screen.getByRole('region', { name: '受注' })).getByText('商談はありません'))
      .toBeInTheDocument();
  });

  it('links each card to the deal and shows its company, owner and next step', () => {
    renderBoard([card({})]);
    expect(screen.getByRole('link', { name: 'AS/400 現行調査' })).toHaveAttribute(
      'href',
      '/ja/deals/deal-1'
    );
    expect(screen.getByText('架空商事 山田 太郎')).toBeInTheDocument();
    expect(screen.getByText(/営業 花子/)).toBeInTheDocument();
    expect(screen.getByText('見積を送る')).toBeInTheDocument();
  });

  it('warns about a passed close date and a deal without a next action', () => {
    renderBoard([card({ expectedCloseOn: '2026-10-01', hasOpenTask: false })]);
    expect(screen.getByText('受注予定日を過ぎています')).toBeInTheDocument();
    expect(screen.getByText('次の行動がありません')).toBeInTheDocument();
  });

  it('does not warn about won deals', () => {
    renderBoard([
      card({ stage: 'won', expectedCloseOn: '2026-10-01', hasOpenTask: false, closedOn: TODAY }),
    ]);
    expect(screen.queryByText('受注予定日を過ぎています')).not.toBeInTheDocument();
    expect(screen.queryByText('次の行動がありません')).not.toBeInTheDocument();
  });

  it('moves a card with its menu', async () => {
    const user = userEvent.setup();
    const { onMove } = renderBoard([card({})]);
    await user.click(screen.getByRole('button', { name: '「AS/400 現行調査」のステージを移動' }));
    const items = screen.getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).not.toContain('「提案」へ移す');
    await user.click(screen.getByRole('menuitem', { name: '「条件の調整」へ移す' }));
    expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ id: 'deal-1' }), 'negotiation');
  });

  it('offers no moves to read-only viewers', () => {
    renderBoard([card({})], false);
    expect(
      screen.queryByRole('button', { name: '「AS/400 現行調査」のステージを移動' })
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem')[0]).toHaveAttribute('draggable', 'false');
  });
});
