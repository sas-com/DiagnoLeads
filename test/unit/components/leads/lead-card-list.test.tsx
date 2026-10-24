/**
 * The lead list on a phone (#110): below md the list shows one card per lead of the server's
 * page, with a compact sort control and the same paging. Real ja messages and UI components;
 * the data hooks are mocked.
 */
import { LeadTable } from '@/components/features/leads/lead-table';
import type { Lead } from '@/lib/db/schema';
import type { LeadListSort } from '@/lib/features/leads/list-query';
import messages from '@/locales/ja/common.json';
import { act, configure, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ComponentProps } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

configure({ asyncUtilTimeout: 5000 });
// Menus render slowly on a cold CI coverage run
vi.setConfig({ testTimeout: 20000 });

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const OWNER = '33333333-3333-4333-8333-333333333333';
const t = messages.leadList;

const update = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/use-leads', () => ({
  useUpdateLead: () => ({ mutateAsync: update, isPending: false }),
}));

vi.mock('@/hooks/use-lead-assignee', () => ({
  useLeadAssignees: () => ({
    data: [{ userId: OWNER, name: '佐藤 花子', email: 'sato@example.com', displayName: '佐藤 花子' }],
    isLoading: false,
  }),
  useAssignLead: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/lib/trpc/client', () => ({ trpc: { useUtils: () => ({}) } }));
vi.mock('@/lib/features/reports/pdf-export-service', () => ({
  downloadPDF: vi.fn(),
  exportLeadsToPDF: vi.fn(),
  generatePDFFilename: vi.fn(),
}));

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const setWidth = (width: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  window.dispatchEvent(new Event('resize'));
};

beforeEach(() => {
  update.mockReset();
  update.mockResolvedValue({});
  setWidth(390);
});

afterEach(() => setWidth(1024));

const makeLead = (id: string, overrides: Record<string, unknown> = {}) =>
  ({
    id,
    organizationId: ORG_ID,
    name: '山田 太郎',
    email: `${id}@example.jp`,
    company: '三田製作所',
    phone: null,
    status: 'negotiating',
    score: 72,
    source: 'diagnostic',
    responses: {},
    inflowSource: null,
    conversionPoint: 'consultation',
    dealPhase: 'proposal',
    targetSystem: null,
    lostReason: null,
    mqlQualifiedAt: new Date('2026-10-01T01:00:00Z'),
    sqlDecision: null,
    hasNegotiated: false,
    assigneeUserId: OWNER,
    assignee: { id: OWNER, name: '佐藤 花子', email: 'sato@example.com' },
    nextMeetingDate: '2020-01-10',
    dealRating: 'a',
    tags: [],
    createdAt: new Date('2026-10-11T01:00:00Z'),
    updatedAt: new Date('2026-10-11T01:00:00Z'),
    ...overrides,
  }) as unknown as Lead;

type TableProps = ComponentProps<typeof LeadTable>;

function renderList(overrides: Partial<TableProps> = {}) {
  const props: TableProps = {
    leads: [
      makeLead('a1'),
      makeLead('a2', {
        name: null,
        company: null,
        email: 'hanako@example.jp',
        status: 'new',
        score: null,
        dealPhase: null,
        conversionPoint: null,
        mqlQualifiedAt: null,
        assigneeUserId: null,
        assignee: null,
        nextMeetingDate: null,
      }),
    ],
    organizationId: ORG_ID,
    canEdit: true,
    getLeadHref: (lead) => `/ja/leads/${lead.id}`,
    onLeadClick: vi.fn(),
    sort: { by: 'createdAt', order: 'desc' } satisfies LeadListSort,
    onSort: vi.fn(),
    page: 1,
    pageSize: 20,
    total: 45,
    onPageChange: vi.fn(),
    onPageSizeChange: vi.fn(),
    ...overrides,
  };
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <LeadTable {...props} />
    </NextIntlClientProvider>
  );
  return props;
}

const cards = () => within(screen.getByRole('list', { name: t.cards.label })).getAllByRole('listitem');

describe('LeadTable on a phone (cards, #110)', () => {
  it('shows a card per lead instead of the table, with the key facts', () => {
    renderList();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(cards()).toHaveLength(2);

    const card = screen.getByRole('listitem', { name: '三田製作所 山田 太郎' });
    const open = within(card).getByRole('link', { name: '三田製作所' });
    expect(open).toHaveAttribute('href', '/ja/leads/a1');
    expect(open).toHaveAccessibleDescription('山田 太郎');
    expect(within(card).getByRole('combobox', { name: /ステータス.*商談中/ })).toBeInTheDocument();
    expect(within(card).getByRole('combobox', { name: /商談フェーズ.*提案/ })).toBeInTheDocument();
    expect(
      within(card).getByRole('combobox', { name: '担当者を変更（現在：佐藤 花子）' })
    ).toBeInTheDocument();
    expect(within(card).getByTestId('lead-card-score')).toHaveTextContent('スコア 72/100');
    expect(within(card).getByText('2020/01/10')).toBeInTheDocument();
    expect(within(card).getByTestId('next-meeting-overdue')).toHaveTextContent(t.overdue);
    expect(within(card).getByText(t.mql)).toHaveAttribute('title', 'MQL判定日：2026/10/01');
    expect(within(card).getByText(t.consultation)).toBeInTheDocument();

    // No company and no name: the email leads; empty facts are left out
    const bare = screen.getByRole('listitem', { name: 'hanako@example.jp' });
    expect(within(bare).getByRole('link', { name: 'hanako@example.jp' })).toBeInTheDocument();
    expect(within(bare).queryByTestId('lead-card-score')).not.toBeInTheDocument();
    expect(within(bare).queryByText(t.mql)).not.toBeInTheDocument();
    expect(within(bare).queryByText(t.consultation)).not.toBeInTheDocument();
    expect(
      within(bare).getByRole('combobox', { name: '担当者を変更（現在：担当未定）' })
    ).toBeInTheDocument();
  });

  it('has 44px controls on the card and no row selection or columns menu', () => {
    renderList({ onExport: vi.fn() });
    const card = cards()[0];
    for (const control of within(card).getAllByRole('combobox')) {
      expect(control).toHaveClass('h-11');
    }
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: messages.common.columns })
    ).not.toBeInTheDocument();
    // Export of every matching lead stays, as an icon button
    expect(screen.getByRole('button', { name: messages.common.export })).toHaveClass('h-11');
  });

  it('changes the status in place without opening the lead', async () => {
    const user = userEvent.setup();
    const props = renderList();
    const card = cards()[0];
    const link = within(card).getByRole('link', { name: '三田製作所' });
    const linkClicks = vi.fn();
    link.addEventListener('click', linkClicks);

    await user.click(within(card).getByRole('combobox', { name: /ステータス/ }));
    await user.click(await screen.findByRole('option', { name: '成約' }));

    expect(update).toHaveBeenCalledWith({ id: 'a1', organizationId: ORG_ID, status: 'won' });
    expect(linkClicks).not.toHaveBeenCalled();
    expect(props.onLeadClick).not.toHaveBeenCalled();
  });

  it('opens the lead with onLeadClick when there is no lead page link', async () => {
    const user = userEvent.setup();
    const props = renderList({ getLeadHref: undefined });
    const card = cards()[0];

    await user.click(within(card).getByRole('combobox', { name: /商談フェーズ/ }));
    await user.keyboard('{Escape}');
    expect(props.onLeadClick).not.toHaveBeenCalled();

    await user.click(within(card).getByRole('button', { name: '三田製作所' }));
    expect(props.onLeadClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }));
  });

  it('sorts from the compact control: another column, then the other order', async () => {
    const user = userEvent.setup();
    const props = renderList();
    const sortBy = screen.getByRole('combobox', { name: '並び替え（今は作成日）' });

    await user.click(sortBy);
    await user.click(await screen.findByRole('option', { name: 'スコア' }));
    expect(props.onSort).toHaveBeenLastCalledWith('score');

    await user.click(screen.getByRole('button', { name: '並び順を反対にする（今は降順）' }));
    expect(props.onSort).toHaveBeenLastCalledWith('createdAt');
  });

  it('pages with the same footer, with 44px buttons', async () => {
    const user = userEvent.setup();
    const props = renderList({ page: 2 });
    const pager = screen.getByRole('navigation', { name: t.pagination });
    expect(within(pager).getByText('2 / 3')).toBeInTheDocument();

    const next = within(pager).getByRole('button', { name: '次へ' });
    expect(next).toHaveClass('h-11');
    await user.click(next);
    expect(props.onPageChange).toHaveBeenLastCalledWith(3);
    await user.click(within(pager).getByRole('button', { name: '前へ' }));
    expect(props.onPageChange).toHaveBeenLastCalledWith(1);
  });

  it('says when nothing matches, with a way to clear the filters', async () => {
    const user = userEvent.setup();
    const props = renderList({ leads: [], total: 0, hasFilters: true, onClearFilters: vi.fn() });
    expect(screen.queryByRole('list', { name: t.cards.label })).not.toBeInTheDocument();
    expect(screen.getByText(t.noMatches)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t.chips.clearAll }));
    expect(props.onClearFilters).toHaveBeenCalled();
  });

  it('says when there are no leads yet', () => {
    renderList({ leads: [], total: 0 });
    expect(screen.getByText(messages.leads.noLeads)).toBeInTheDocument();
    // Roles that cannot create leads get no create button (#431)
    expect(
      screen.queryByRole('button', { name: messages.leads.addFirstLead })
    ).not.toBeInTheDocument();
  });

  it('creates the first lead from there (#431)', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    renderList({ leads: [], total: 0, onCreate });
    await user.click(screen.getByRole('button', { name: messages.leads.addFirstLead }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('says the list could not be loaded, with a retry, not "no leads yet" (#431)', async () => {
    const user = userEvent.setup();
    const props = renderList({
      leads: [],
      total: 0,
      loadFailed: true,
      onRefresh: vi.fn(),
      onCreate: vi.fn(),
    });
    expect(screen.getByRole('alert')).toHaveTextContent(messages.common.loadError);
    expect(screen.queryByText(messages.leads.noLeads)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: messages.leads.addFirstLead })
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: messages.common.retry }));
    expect(props.onRefresh).toHaveBeenCalledTimes(1);
  });

  it('shows read-only badges to roles that cannot edit', () => {
    renderList({ canEdit: false });
    const card = cards()[0];
    expect(within(card).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(card).getByText('商談中')).toBeInTheDocument();
    expect(within(card).getByTestId('lead-assignee')).toHaveTextContent('佐藤 花子');
  });

  it('switches to the table from md up', () => {
    renderList();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    act(() => setWidth(768));
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: t.cards.label })).not.toBeInTheDocument();
  });
});

describe('MQL level badges in the list (#196)', () => {
  const levels = messages.leadActivity.summary.mqlLevels;
  const leads = [
    makeLead('i1', { company: '関心商事', mqlLevel: 'interest' }),
    makeLead('f1', { company: '適合商事', mqlLevel: 'fit', mqlQualifiedAt: null }),
    makeLead('m1', { company: '手動商事', mqlLevel: null }),
    makeLead('n1', { company: '対象外商事', mqlLevel: 'none', mqlQualifiedAt: null }),
    makeLead('x1', { company: 'データなし商事', mqlQualifiedAt: null }),
  ];

  it('shows 関心あり / 適合 / MQL on the cards, with the MQL date as the tooltip', () => {
    renderList({ leads });
    const card = (name: string) => within(screen.getByRole('listitem', { name: new RegExp(name) }));

    const interest = card('関心商事').getByText(levels.interest);
    expect(interest).toHaveAttribute('title', 'MQL判定日：2026/10/01');
    expect(card('関心商事').queryByText(t.mql)).not.toBeInTheDocument();
    expect(card('関心商事').queryByText(levels.fit)).not.toBeInTheDocument();

    expect(card('適合商事').getByText(levels.fit)).toBeInTheDocument();
    expect(card('適合商事').queryByTestId('lead-mql-badge')).not.toBeInTheDocument();

    // An MQL date without a level (e.g. set by hand) keeps the plain MQL badge
    expect(card('手動商事').getByText(t.mql)).toHaveAttribute('title', 'MQL判定日：2026/10/01');

    for (const name of ['対象外商事', 'データなし商事']) {
      expect(card(name).queryByTestId('lead-mql-badge')).not.toBeInTheDocument();
      expect(card(name).queryByTestId('lead-mql-fit-badge')).not.toBeInTheDocument();
    }
  });

  it('shows the same badges and the date in the table column', () => {
    setWidth(1440);
    renderList({ leads, columnPreferences: { mqlQualifiedAt: true } });
    const row = (name: string) => {
      // The company's own cell (the row's checkbox is named after the company too, #431)
      const cell = screen.getByRole('cell', { name });
      const tr = cell.closest('tr');
      if (!tr) throw new Error('no row');
      return within(tr);
    };

    expect(row('関心商事').getByText(levels.interest)).toHaveAttribute(
      'title',
      'MQL判定日：2026/10/01'
    );
    expect(row('関心商事').getByText('2026/10/01')).toBeInTheDocument();
    expect(row('適合商事').getByText(levels.fit)).toBeInTheDocument();
    expect(row('手動商事').getByText(t.mql)).toBeInTheDocument();
    for (const name of ['対象外商事', 'データなし商事']) {
      expect(row(name).queryByTestId('lead-mql-badge')).not.toBeInTheDocument();
      expect(row(name).queryByTestId('lead-mql-fit-badge')).not.toBeInTheDocument();
    }
  });
});
