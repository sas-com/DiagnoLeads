/**
 * The cards of the lead page's overview tab (#473). Real cards over a tRPC client where every
 * query is still loading, so a card added to the list needs no change here; only the relative
 * order of the cards that show a heading while loading, and the conditions, are fixed. Each
 * card's content has its own tests.
 */
import { LeadOverviewCards } from '@/components/features/leads/detail/lead-overview-cards';
import type { Lead } from '@/lib/db/schema';
import messages from '@/locales/ja/common.json';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

// The mock factories below are hoisted above plain constants
const { ORG_ID, HEARING_ID } = vi.hoisted(() => ({
  ORG_ID: '11111111-1111-4111-8111-111111111111',
  HEARING_ID: '66666666-6666-4666-8666-666666666666',
}));
const LEAD_ID = '22222222-2222-4222-8222-222222222222';
const SUBMISSION_ID = '44444444-4444-4444-8444-444444444444';

// The page renders inside the organization provider, which a card may read with useOrganization()
vi.mock('@/hooks/use-organization', () => ({
  useOrganization: () => ({ organizationId: ORG_ID, isLoading: false }),
}));
vi.mock('@/lib/trpc/client', async () => {
  const { loadingTrpc } = await import('@/test/mocks/trpc-loading');
  return {
    trpc: loadingTrpc({
      'leadHearings.listByLead': {
        items: [
          { id: HEARING_ID, heldOn: '2026-10-15', dealRating: 'a', missingCount: 2, unconfirmedCount: 0 },
        ],
        canEdit: true,
      },
      'leadHearings.summary': {
        summary: {
          unconfirmed: [{ key: 'itemA', label: 'Item A', sectionId: 's1' }],
          next: [{ key: 'itemB', label: 'Item B', sectionId: 's1' }],
          missing: [],
        },
      },
    }),
  };
});

const makeLead = (overrides: Partial<Lead> = {}) =>
  ({
    id: LEAD_ID,
    organizationId: ORG_ID,
    name: 'Taro Example',
    company: 'Example Works',
    score: 70,
    responses: {
      axMigration: {
        urgency: 'high',
        platform: 'as400',
        challenges: ['people'],
        department: null,
        difficulty: 'low',
        sqlSignals: true,
        diagnosedAt: '2026-10-16T01:30:00.000Z',
        mqlCandidate: true,
        needsHearing: false,
        submissionId: SUBMISSION_ID,
        primaryChallenge: 'people',
        consultationRequested: true,
      },
    },
    customFields: {},
    agencyName: null,
    dealPhaseReachedAt: {},
    ...overrides,
  }) as unknown as Lead;

const renderCards = (lead: Lead = makeLead(), onShowAnswers = vi.fn()) =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <LeadOverviewCards
        organizationId={ORG_ID}
        lead={lead}
        onShowAnswers={onShowAnswers}
      />
    </NextIntlClientProvider>
  );

const heading = (name: string) => screen.getByRole('heading', { name });
const isBefore = (first: Element, second: Element) =>
  Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('LeadOverviewCards', () => {
  it('keeps the cards in the order of the page', () => {
    renderCards(
      makeLead({
        agencyName: 'Agency A',
        dealPhaseReachedAt: {
          initial_hearing: '2026-10-01',
          proposal: '2026-10-20',
          survey_won: '2026-10-25',
        },
      })
    );
    // Every card with a heading while loading; the customer search, the agency handover and the
    // document requests show nothing until their data comes, so their places are not fixed here
    const order = [
      heading('初回商談の希望日時'),
      heading('商談'),
      heading('事前調査カード'),
      heading('切り返しカード'),
      heading('動くべき時期'),
      heading('次の行動・持ち帰り事項'),
      heading('アポの条件の確認'),
      heading('案件の振り返り'),
      screen.getByRole('region', { name: '商談のまとめ' }),
      heading('引き継ぎ書'),
      screen.getByTestId('lead-diagnosis-card'),
      heading('次に聞くこと'),
    ];
    for (let index = 1; index < order.length; index += 1) {
      expect(isBefore(order[index - 1], order[index])).toBe(true);
    }
  });

  it('starts the hearing summary with the latest hearing and what to confirm next', () => {
    renderCards();
    const hearing = screen.getByRole('region', { name: '商談のまとめ' });
    expect(within(hearing).getByText(/最新のヒアリング/)).toBeInTheDocument();
    expect(within(hearing).getByTestId('lead-next-steps')).toHaveTextContent('Item A');
    expect(within(hearing).getByRole('link', { name: 'まとめを見る' })).toHaveAttribute(
      'href',
      `/ja/leads/${LEAD_ID}/hearings/${HEARING_ID}?view=summary`
    );
  });

  it('shows the diagnosis readably, and asks the page to open its answers instead of the id', async () => {
    const user = userEvent.setup();
    const onShowAnswers = vi.fn();
    renderCards(makeLead(), onShowAnswers);
    const diagnosis = screen.getByTestId('lead-diagnosis-card');
    expect(within(diagnosis).getByText('AS/400（IBM i）')).toBeInTheDocument();
    expect(within(diagnosis).getByText('相談の申込みあり')).toBeInTheDocument();
    expect(within(diagnosis).getByText('適合', { selector: '[title]' })).toBeInTheDocument();
    expect(within(diagnosis).getByText('ヒト：人に依存した基幹システム')).toBeInTheDocument();
    expect(diagnosis).not.toHaveTextContent(SUBMISSION_ID);

    await user.click(within(diagnosis).getByRole('button', { name: /回答を見る/ }));
    expect(onShowAnswers).toHaveBeenCalledWith(SUBMISSION_ID);
  });

  it('shows the appointment review only for a lead from an agency', () => {
    const { unmount } = renderCards(makeLead({ agencyName: '  ' }));
    expect(screen.queryByRole('heading', { name: 'アポの条件の確認' })).not.toBeInTheDocument();
    unmount();

    renderCards(makeLead({ agencyName: 'Agency A' }));
    expect(heading('アポの条件の確認')).toBeInTheDocument();
  });

  it('shows the delivery review only once the survey or a later phase was won (#159)', () => {
    const { unmount } = renderCards(makeLead({ dealPhaseReachedAt: { proposal: '2026-09-01' } }));
    expect(screen.queryByRole('heading', { name: '案件の振り返り' })).not.toBeInTheDocument();
    unmount();

    renderCards(makeLead({ dealPhaseReachedAt: { proposal: '2026-09-01', survey_won: '2026-10-01' } }));
    expect(heading('案件の振り返り')).toBeInTheDocument();
  });

  it('links to the handoff sheet once the deal moved on from the initial hearing (#86)', () => {
    const { unmount } = renderCards();
    expect(screen.queryByRole('link', { name: '引き継ぎ書を開く' })).not.toBeInTheDocument();
    unmount();

    renderCards(
      makeLead({ dealPhaseReachedAt: { initial_hearing: '2026-10-01', proposal: '2026-10-20' } })
    );
    expect(screen.getByRole('link', { name: '引き継ぎ書を開く' })).toHaveAttribute(
      'href',
      `/ja/leads/${LEAD_ID}/handoff`
    );
  });
});
