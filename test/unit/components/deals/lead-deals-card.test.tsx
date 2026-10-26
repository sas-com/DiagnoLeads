/**
 * The deals card of the lead page (#436): the lead's deals with the open amount, the create
 * button for those who can edit, and the error state (real next-intl messages; tRPC mocked)
 */
import { LeadDealsCard } from '@/components/features/deals/lead-deals-card';
import messages from '@/locales/ja/common.json';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '770e8400-e29b-41d4-a716-446655440001';

const mocks = vi.hoisted(() => ({
  forLead: {
    data: undefined as unknown,
    isError: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
}));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    deals: { forLead: { useQuery: () => mocks.forLead } },
  },
}));
// The dialog has its own tests through the deals screen
vi.mock('@/components/features/deals/deal-form-dialog', () => ({
  DealFormDialog: ({ open, leadId }: { open: boolean; leadId?: string }) =>
    open ? <p>create dialog for {leadId}</p> : null,
}));

const deal = (overrides: Record<string, unknown>) => ({
  id: 'deal-1',
  name: '現行調査',
  stage: 'proposal',
  amount: 3_000_000,
  expectedCloseOn: '2026-11-30',
  ...overrides,
});

function renderCard() {
  return render(
    <NextIntlClientProvider locale="ja" messages={messages}>
      <LeadDealsCard organizationId={ORG_ID} leadId={LEAD_ID} />
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  mocks.forLead = { data: undefined, isError: false, error: null, refetch: vi.fn() };
});

describe('LeadDealsCard', () => {
  it('lists the deals with the amount still open', () => {
    mocks.forLead.data = {
      items: [
        deal({}),
        deal({ id: 'deal-2', name: '移行', stage: 'won', amount: 9_000_000 }),
        deal({ id: 'deal-3', name: 'AX 化', stage: 'qualification', amount: null }),
      ],
      canEdit: false,
      canDelete: false,
    };
    renderCard();
    expect(screen.getByRole('link', { name: '現行調査' })).toHaveAttribute('href', '/ja/deals/deal-1');
    expect(screen.getByText(/3件・開いている商談/)).toHaveTextContent('3,000,000');
    expect(screen.getByText('金額未定')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '商談を作成' })).not.toBeInTheDocument();
  });

  it('creates a deal for this lead', async () => {
    const user = userEvent.setup();
    mocks.forLead.data = { items: [], canEdit: true, canDelete: false };
    renderCard();
    expect(screen.getByText('このリードの商談はまだありません')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '商談を作成' }));
    expect(screen.getByText(`create dialog for ${LEAD_ID}`)).toBeInTheDocument();
  });

  it('says when the deals cannot be read and offers a retry', async () => {
    const user = userEvent.setup();
    mocks.forLead.isError = true;
    renderCard();
    expect(screen.getByText('商談を読み込めませんでした')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(mocks.forLead.refetch).toHaveBeenCalled();
  });

  it("is left out for a parent organization's viewer, who may not read deals", () => {
    mocks.forLead = {
      data: undefined,
      isError: true,
      error: { data: { code: 'FORBIDDEN' } },
      refetch: vi.fn(),
    };
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });
});
