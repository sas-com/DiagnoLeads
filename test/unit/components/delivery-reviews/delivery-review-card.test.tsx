/**
 * Delivery review card on the lead page (#159): the diagnosis checkpoints with their outcomes,
 * a checkpoint the diagnosis missed, the effort against the estimate, saving, and read-only.
 */
import { DeliveryReviewCard } from '@/components/features/delivery-reviews/delivery-review-card';
import messages from '@/locales/ja/common.json';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ result: {} as Record<string, unknown>, mutate: vi.fn() }));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      deliveryReviews: { get: { invalidate: vi.fn() }, report: { invalidate: vi.fn() } },
    }),
    deliveryReviews: {
      get: { useQuery: () => mocks.result },
      save: { useMutation: () => ({ mutate: mocks.mutate, isPending: false }) },
    },
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '770e8400-e29b-41d4-a716-446655440000';

const data = (values: Record<string, unknown> = {}) => ({
  review: null,
  diagnosis: { checkpoints: ['gaiji', 'legacy_edi'], difficulty: 'medium' },
  canEdit: true,
  ...values,
});

const renderCard = () =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <DeliveryReviewCard organizationId={ORG_ID} leadId={LEAD_ID} />
    </NextIntlClientProvider>
  );

async function choose(trigger: HTMLElement, option: string) {
  fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name: option }));
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});

beforeEach(() => {
  mocks.mutate.mockReset();
  mocks.result = { data: data(), isError: false };
});

describe('DeliveryReviewCard', () => {
  it('records how the diagnosis checkpoints turned out, a missed one and the effort', async () => {
    renderCard();
    expect(screen.getByText('診断の移行難易度：中程度')).toBeInTheDocument();
    const save = screen.getByRole('button', { name: '保存' });
    expect(save).toBeDisabled();

    await choose(screen.getByRole('combobox', { name: '外字 の結果' }), '実際に難しかった');
    await choose(screen.getByRole('combobox', { name: '注意点を追加' }), '連携先の多さ');
    expect(screen.getByRole('combobox', { name: '連携先の多さ の結果' })).toHaveTextContent(
      '実際に難しかった'
    );
    fireEvent.change(screen.getByLabelText('見積もり工数（人月）'), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText('実績工数（人月）'), { target: { value: '10' } });
    expect(screen.getByText('見積もりとのずれ：+25%')).toBeInTheDocument();

    fireEvent.click(save);
    expect(mocks.mutate).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      leadId: LEAD_ID,
      review: {
        checkpointOutcomes: { gaiji: 'hard', integrations_many: 'hard' },
        actualDifficulty: null,
        estimatedEffort: 8,
        actualEffort: 10,
        note: null,
      },
    });
  });

  it('removes a checkpoint it added', async () => {
    mocks.result = {
      data: data({
        review: {
          checkpointOutcomes: { integrations_many: 'hard' },
          actualDifficulty: 'high',
          estimatedEffort: null,
          actualEffort: null,
          note: null,
          updatedAt: new Date('2026-10-20T00:00:00Z'),
          updatedByName: '営業 太郎',
        },
      }),
      isError: false,
    };
    renderCard();
    expect(screen.getByText(/営業 太郎・2026\/10\/20 に更新/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '連携先の多さ を外す' }));
    expect(screen.queryByRole('combobox', { name: '連携先の多さ の結果' })).not.toBeInTheDocument();
  });

  it('only shows the review to those who may not edit it', () => {
    mocks.result = {
      data: data({
        canEdit: false,
        diagnosis: null,
        review: {
          checkpointOutcomes: { gaiji: 'hard' },
          actualDifficulty: null,
          estimatedEffort: 5,
          actualEffort: 5,
          note: '外字が多かった',
          updatedAt: new Date('2026-10-20T00:00:00Z'),
          updatedByName: null,
        },
      }),
      isError: false,
    };
    renderCard();
    expect(screen.getByText(/AX 診断の回答がありません/)).toBeInTheDocument();
    const others = screen.getByRole('region', { name: '診断になかったが記録した注意点' });
    expect(within(others).getByText('実際に難しかった')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('メモ（ずれの理由など）')).toHaveAttribute('readonly');
  });

  it('hides itself when the review cannot be read', () => {
    mocks.result = { data: undefined, isError: true };
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });
});
