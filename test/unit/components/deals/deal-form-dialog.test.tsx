/**
 * The deal form (#436): editing sends only the fields changed in the dialog, a close date box
 * holding text that is not a date, or a date outside 2000-2100, holds the save, and a new deal
 * created as won says what it does to the lead (real next-intl messages and UI components; tRPC
 * mocked)
 */
import { DealFormDialog } from '@/components/features/deals/deal-form-dialog';
import type { DealView } from '@/lib/features/deals/service';
import messages from '@/locales/ja/common.json';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '770e8400-e29b-41d4-a716-446655440001';
const DEAL_ID = '880e8400-e29b-41d4-a716-446655440002';

type MutateOptions = { onSuccess?: (result: unknown) => void };

const mocks = vi.hoisted(() => ({
  creates: [] as unknown[],
  updates: [] as unknown[],
}));

vi.mock('@/lib/trpc/client', () => {
  const invalidate = { invalidate: vi.fn() };
  const mutation = (sent: unknown[]) => ({
    isPending: false,
    mutate: (input: unknown, options?: MutateOptions) => {
      sent.push(input);
      options?.onSuccess?.(input);
    },
  });
  return {
    trpc: {
      useUtils: () => ({ deals: invalidate, leads: invalidate, leadActivity: invalidate }),
      deals: {
        create: { useMutation: () => mutation(mocks.creates) },
        update: { useMutation: () => mutation(mocks.updates) },
        delete: { useMutation: () => mutation([]) },
      },
      leads: {
        assignees: {
          useQuery: () => ({ data: [{ userId: 'user-1', displayName: '営業 花子' }] }),
        },
      },
      leadSearch: { suggest: { useQuery: () => ({ data: [], isFetching: false }) } },
    },
  };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture ??= () => false;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const deal: DealView = {
  id: DEAL_ID,
  leadId: LEAD_ID,
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
};

function renderForm(props: { deal?: DealView; leadId?: string } = {}) {
  const onOpenChange = vi.fn();
  const onSaved = vi.fn();
  render(
    <NextIntlClientProvider locale="ja" messages={messages}>
      <DealFormDialog
        open
        onOpenChange={onOpenChange}
        organizationId={ORG_ID}
        onSaved={onSaved}
        {...props}
      />
    </NextIntlClientProvider>
  );
  return { onOpenChange, onSaved };
}

beforeEach(() => {
  mocks.creates = [];
  mocks.updates = [];
});

describe('DealFormDialog', () => {
  it('sends only the fields changed in the dialog when editing', async () => {
    const user = userEvent.setup();
    const { onOpenChange, onSaved } = renderForm({ deal });
    await user.clear(screen.getByLabelText('金額（税抜）'));
    await user.type(screen.getByLabelText('金額（税抜）'), '3500000');
    await user.clear(screen.getByLabelText('次の一手'));
    await user.click(screen.getByRole('button', { name: '保存' }));
    // Not the probability, kind or owner it was opened with: a stage move made elsewhere
    // meanwhile resets the probability, and this save must not write the old one back
    expect(mocks.updates).toEqual([
      { organizationId: ORG_ID, dealId: DEAL_ID, amount: 3_500_000, nextStep: null },
    ]);
    expect(onSaved).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes without a request when nothing was changed', async () => {
    const user = userEvent.setup();
    const { onOpenChange, onSaved } = renderForm({ deal });
    await user.type(screen.getByLabelText('商談名 必須'), ' ');
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(mocks.updates).toEqual([]);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does not save while the close date box holds text that is not a date', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderForm({ deal });
    const date = screen.getByLabelText('受注予定日');
    await user.clear(date);
    await user.type(date, '2026/13/45');
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(mocks.updates).toEqual([]);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(date).toHaveAccessibleDescription(messages.leadHearings.editor.dateInvalid);

    await user.clear(date);
    await user.type(date, '2026/12/15');
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(mocks.updates).toEqual([
      { organizationId: ORG_ID, dealId: DEAL_ID, expectedCloseOn: '2026-12-15' },
    ]);
  });

  it('does not save a close date the deals do not take (outside 2000 to 2100)', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderForm({ deal });
    const date = screen.getByLabelText('受注予定日');
    await user.clear(date);
    await user.type(date, '1999/12/31');
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(mocks.updates).toEqual([]);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(date).toHaveAccessibleDescription('受注予定日は2000〜2100年の日付で入力してください');
  });

  it('does not create a deal with text that is not a date either', async () => {
    const user = userEvent.setup();
    renderForm({ leadId: LEAD_ID });
    await user.type(screen.getByLabelText('商談名 必須'), 'AS/400 移行');
    await user.type(screen.getByLabelText('受注予定日'), '来月末');
    await user.click(screen.getByRole('button', { name: '作成' }));
    expect(mocks.creates).toEqual([]);
  });

  it('marks the required fields and leaves the owner of a new deal to the lead', async () => {
    const user = userEvent.setup();
    renderForm({});
    expect(screen.getByLabelText('リード 必須')).toBeInTheDocument();
    expect(screen.getByLabelText('商談名 必須')).toBeInTheDocument();
    // The server makes the lead's assignee the owner when none is chosen
    expect(screen.getByRole('combobox', { name: '担当' })).toHaveTextContent('リードの担当者');
    await user.click(screen.getByRole('combobox', { name: '担当' }));
    expect(screen.getByRole('option', { name: '担当未定' })).toBeInTheDocument();
  });

  it('says what creating a deal as won does to the lead', async () => {
    const user = userEvent.setup();
    renderForm({ leadId: LEAD_ID });
    await user.type(screen.getByLabelText('商談名 必須'), 'AS/400 移行');
    await user.click(screen.getByRole('combobox', { name: 'ステージ' }));
    await user.click(screen.getByRole('option', { name: '受注' }));
    expect(screen.getByRole('combobox', { name: 'ステージ' })).toHaveAccessibleDescription(
      'このリードは成約になります。商談を開き直しても、リードは成約のままです。 受注日は今日になります。'
    );
    await user.click(screen.getByRole('button', { name: '作成' }));
    expect(mocks.creates).toEqual([
      {
        organizationId: ORG_ID,
        leadId: LEAD_ID,
        stage: 'won',
        name: 'AS/400 移行',
        kind: 'survey',
        amount: null,
        expectedCloseOn: null,
        nextStep: null,
        forecastOverride: null,
      },
    ]);
  });
});
