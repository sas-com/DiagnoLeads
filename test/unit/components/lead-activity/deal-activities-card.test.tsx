/**
 * The activity of a deal on its page (#554): its contact records with their duration, outcome
 * and deal, how many there are, and recording one for the deal (real next-intl messages; tRPC
 * mocked)
 */
import { DealActivitiesCard } from '@/components/features/lead-activity/deal-activities-card';
import messages from '@/locales/ja/common.json';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '770e8400-e29b-41d4-a716-446655440001';
const DEAL_ID = '880e8400-e29b-41d4-a716-446655440002';

const mocks = vi.hoisted(() => ({
  forDeal: {} as Record<string, unknown>,
  refetch: vi.fn(),
  dialog: [] as { open: boolean; leadId: string; defaultDealId?: string; leadLabel: string }[],
}));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    leadActivity: {
      forDeal: {
        useQuery: () => ({ isError: false, refetch: mocks.refetch, ...mocks.forDeal }),
      },
    },
  },
}));
vi.mock('@/components/features/lead-follow-up/record-activity-dialog', () => ({
  RecordActivityDialog: (props: {
    open: boolean;
    leadId: string;
    defaultDealId?: string;
    leadLabel: string;
  }) => {
    mocks.dialog.push(props);
    return props.open ? <div role="dialog">記録の画面</div> : null;
  },
}));

const visit = {
  id: 'contact:c1',
  kind: 'contact_recorded',
  at: new Date('2026-10-20T05:00:00Z'),
  actor: { id: 'u1', name: '営業 一郎' },
  contactId: 'c1',
  contactKind: 'visit',
  note: '現行の帳票を見せてもらった',
  durationMinutes: 90,
  outcome: 'advanced',
  // Every record of the deal page is of that deal, so the server names none
  deal: null,
  first: false,
};

function renderCard() {
  return render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <DealActivitiesCard
        organizationId={ORG_ID}
        dealId={DEAL_ID}
        leadId={LEAD_ID}
        leadLabel="架空商事"
      />
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dialog = [];
  mocks.forDeal = { data: { leadId: LEAD_ID, items: [visit], total: 1, canEdit: true } };
});

describe('DealActivitiesCard', () => {
  it("lists the deal's records with their duration and outcome", () => {
    renderCard();

    expect(screen.getByRole('heading', { name: 'この商談の活動' })).toBeInTheDocument();
    expect(screen.getByText('訪問')).toBeInTheDocument();
    expect(screen.getByText('1時間30分')).toBeInTheDocument();
    expect(screen.getByText('結果：前進')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^商談：/ })).not.toBeInTheDocument();
    expect(screen.getByText('現行の帳票を見せてもらった')).toBeInTheDocument();
    expect(screen.getByText(/営業 一郎/)).toBeInTheDocument();
    expect(screen.queryByText(/新しい.*件を表示/)).not.toBeInTheDocument();
  });

  it('says how many there are when only the latest are shown', () => {
    mocks.forDeal = { data: { leadId: LEAD_ID, items: [visit], total: 51, canEdit: true } };
    renderCard();
    expect(screen.getByText(/新しい1件を表示しています（全51件）。/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'リードの活動履歴で、すべて見る' })).toHaveAttribute(
      'href',
      `/ja/leads/${LEAD_ID}?tab=activity`
    );
  });

  it('records an activity for this deal of its lead', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('button', { name: '活動を記録' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(mocks.dialog.at(-1)).toMatchObject({
      open: true,
      leadId: LEAD_ID,
      defaultDealId: DEAL_ID,
      leadLabel: '架空商事',
    });
  });

  it('offers no recording to read-only roles, and says when there is nothing yet', () => {
    mocks.forDeal = { data: { leadId: LEAD_ID, items: [], total: 0, canEdit: false } };
    renderCard();
    // Nothing to record from here for a read-only role
    expect(screen.getByText('この商談の活動はまだありません。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '活動を記録' })).not.toBeInTheDocument();
  });

  it('says the activity could not be loaded and loads it again', async () => {
    mocks.forDeal = { data: undefined, isError: true };
    const user = userEvent.setup();
    renderCard();

    expect(screen.getByText('活動を読み込めませんでした')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(mocks.refetch).toHaveBeenCalled();
  });
});
