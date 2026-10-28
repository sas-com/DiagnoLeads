/**
 * The 今日 screen (#556): the member's next actions (theirs only, no switch), meetings of today and
 * the rest of the week, today's contacts with their counts, and deals that need attention, each
 * with its own loading, failure and empty states (one failing leaves the others), the deals left
 * out for those who may not read them, and the day the server read in the heading (real next-intl
 * messages; tRPC mocked)
 */
import { TodayScreen } from '@/components/features/today/today-screen';
import messages from '@/locales/ja/common.json';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_1 = '11111111-1111-4111-8111-111111111111';
const LEAD_2 = '22222222-2222-4222-8222-222222222222';
const LEAD_3 = '33333333-3333-4333-8333-333333333333';
const DEAL_1 = '44444444-4444-4444-8444-444444444444';
const DEAL_2 = '55555555-5555-4555-8555-555555555555';
const t = messages.today;

type QueryState = {
  data?: unknown;
  isError?: boolean;
  error?: { data: { code: string } } | null;
};
type QueryCall = { input: unknown; options: { staleTime?: number; enabled?: boolean } };

const mocks = vi.hoisted(() => ({
  queries: {} as Record<string, QueryState>,
  calls: {} as Record<string, QueryCall[]>,
  refetch: {} as Record<string, () => void>,
}));

vi.mock('@/lib/trpc/client', () => {
  const query = (name: string) => ({
    useQuery: (input: unknown, options: QueryCall['options'] = {}) => {
      mocks.calls[name] = [...(mocks.calls[name] ?? []), { input, options }];
      mocks.refetch[name] ??= vi.fn();
      return {
        data: undefined,
        isError: false,
        error: null,
        ...mocks.queries[name],
        refetch: mocks.refetch[name],
      };
    },
  });
  const invalidate = { invalidate: vi.fn() };
  return {
    trpc: {
      useUtils: () => ({
        leadFollowUp: { tasks: invalidate, dueTasks: invalidate },
        deals: { board: invalidate },
      }),
      leadFollowUp: {
        dueTasks: query('dueTasks'),
        updateTask: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
      },
      leads: { myMeetings: query('myMeetings') },
      leadActivity: { myDay: query('myDay') },
      deals: { board: query('board') },
    },
  };
});
vi.mock('@/hooks/use-organization', () => ({
  useOrganization: () => ({ organizationId: ORG_ID }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const renderScreen = () =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <TodayScreen />
    </NextIntlClientProvider>
  );

const region = (name: RegExp) => screen.getByRole('region', { name });

const meeting = (values: Record<string, unknown>) => ({
  leadId: LEAD_1,
  name: null,
  company: null,
  status: 'nurturing',
  nextMeetingDate: '2026-10-29',
  nextMeetingTime: null,
  firstMeeting: false,
  dealRating: null,
  unassigned: false,
  ...values,
});

const meetings = {
  today: '2026-10-29',
  weekEnd: '2026-11-01',
  total: 3,
  items: [
    meeting({
      leadId: LEAD_1,
      company: '架空商事',
      name: '山田 太郎',
      nextMeetingTime: '09:00',
      firstMeeting: true,
      unassigned: true,
    }),
    meeting({ leadId: LEAD_2, company: '架空工業', dealRating: 'a' }),
    meeting({ leadId: LEAD_3, company: '架空物産', nextMeetingDate: '2026-11-01', status: 'won' }),
  ],
};

const contact = (values: Record<string, unknown>) => ({
  lead: { id: LEAD_1, name: '山田 太郎', company: '架空商事' },
  event: {
    id: 'contact:c1',
    kind: 'contact_recorded',
    at: new Date('2026-10-29T01:00:00Z'),
    actor: null,
    contactId: 'c1',
    contactKind: 'online_meeting',
    note: '移行の範囲を確認した',
    durationMinutes: 90,
    outcome: 'advanced',
    deal: { id: DEAL_1, name: '基幹システム移行' },
    first: false,
    ...values,
  },
});

const day = {
  day: '2026-10-29',
  total: 3,
  byKind: { call: 2, email: 0, visit: 0, online_meeting: 1, no_answer: 0 },
  durationMinutes: 90,
  items: [
    contact({}),
    {
      ...contact({ id: 'contact:c2', contactId: 'c2', contactKind: 'call', note: null }),
      lead: { id: LEAD_2, name: null, company: '架空工業' },
    },
  ],
};

const dealCard = (values: Record<string, unknown>) => ({
  id: DEAL_1,
  leadId: LEAD_1,
  name: '基幹システム移行',
  stage: 'proposal',
  expectedCloseOn: null,
  hasOpenTask: true,
  leadName: '山田 太郎',
  company: '架空商事',
  ...values,
});

const board = {
  today: '2026-10-29',
  truncated: false,
  canEdit: true,
  canDelete: true,
  columns: [
    {
      stage: 'discovery',
      count: 2,
      amount: 0,
      weightedAmount: 0,
      deals: [
        dealCard({ id: DEAL_2, name: '帳票の移行', expectedCloseOn: '2026-11-30', hasOpenTask: false }),
        dealCard({ id: 'on-track', name: '順調な商談', expectedCloseOn: '2026-12-01' }),
      ],
    },
    {
      stage: 'proposal',
      count: 1,
      amount: 0,
      weightedAmount: 0,
      deals: [dealCard({ expectedCloseOn: '2026-10-20' })],
    },
  ],
};

const due = {
  today: '2026-10-29',
  canEdit: true,
  scope: 'mine',
  total: 0,
  counts: { mine: 0, all: 4 },
  items: [],
};

const loadAll = () => {
  mocks.queries = {
    dueTasks: { data: due },
    myMeetings: { data: meetings },
    myDay: { data: day },
    board: { data: board },
  };
};

beforeEach(() => {
  mocks.queries = {};
  mocks.calls = {};
  mocks.refetch = {};
});

describe('TodayScreen', () => {
  it('heads the screen with the day the server read, and lists the sections in the order of the day', () => {
    loadAll();
    renderScreen();

    expect(screen.getByRole('heading', { level: 1, name: t.title })).toBeInTheDocument();
    expect(screen.getByText('2026年10月29日(木)（日本時間）')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      expect.stringMatching(/^今日やること/),
      expect.stringMatching(/^商談予定/),
      expect.stringMatching(/^今日の活動/),
      expect.stringMatching(/^注意が必要な商談/),
    ]);
  });

  it('reads each section for the organization, today’s with a short cache', () => {
    loadAll();
    renderScreen();

    expect(mocks.calls.myMeetings.at(-1)?.input).toEqual({ organizationId: ORG_ID });
    expect(mocks.calls.myDay.at(-1)?.input).toEqual({ organizationId: ORG_ID });
    expect(mocks.calls.board.at(-1)?.input).toEqual({
      organizationId: ORG_ID,
      owner: 'mine',
      closedWithinDays: 0,
    });
    for (const name of ['myMeetings', 'myDay', 'board', 'dueTasks']) {
      expect(mocks.calls[name].at(-1)?.options.staleTime, name).toBeLessThanOrEqual(60_000);
    }
  });

  it('shows only the member’s own next actions, without the switch', () => {
    loadAll();
    renderScreen();

    expect(mocks.calls.dueTasks.at(-1)?.input).toEqual({ organizationId: ORG_ID, scope: 'mine' });
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getByText(messages.leadFollowUp.today.emptyMine)).toBeInTheDocument();
  });

  describe('meetings', () => {
    it('lists today’s, then the rest of the week’s, with the time, marks and a link to the lead', () => {
      loadAll();
      renderScreen();
      const section = region(/^商談予定/);

      expect(within(section).getByRole('heading', { level: 2 })).toHaveTextContent('3件');
      const todays = within(within(section).getByRole('region', { name: t.meetings.todayHeading }))
        .getAllByRole('listitem');
      expect(todays).toHaveLength(2);
      const first = within(todays[0]);
      expect(first.getByRole('link')).toHaveAttribute('href', `/ja/leads/${LEAD_1}`);
      expect(first.getByText('09:00')).toBeInTheDocument();
      expect(first.getByText('架空商事')).toBeInTheDocument();
      expect(first.getByText('山田 太郎')).toBeInTheDocument();
      expect(first.getByText(t.meetings.firstMeeting)).toBeInTheDocument();
      expect(first.getByText(t.meetings.unassigned)).toBeInTheDocument();
      const second = within(todays[1]);
      expect(second.getByText(t.meetings.noTime)).toBeInTheDocument();
      expect(second.getByText('評価 A')).toBeInTheDocument();

      const later = within(within(section).getByRole('region', { name: t.meetings.laterHeading }))
        .getAllByRole('listitem');
      expect(later).toHaveLength(1);
      expect(within(later[0]).getByText('11/1(日)')).toBeInTheDocument();
      // A won lead keeps its meeting, said in words
      expect(within(later[0]).getByText(messages.status.won)).toBeInTheDocument();
    });

    it('links to the list of the member’s meetings this week', () => {
      loadAll();
      renderScreen();

      expect(
        within(region(/^商談予定/)).getByRole('link', { name: t.meetings.viewAll })
      ).toHaveAttribute('href', '/ja/leads?assignee=me&next=thisWeek&sort=nextMeetingDate&order=asc');
    });

    it('says so for a part of the week without meetings', () => {
      loadAll();
      mocks.queries.myMeetings = { data: { ...meetings, total: 1, items: [meetings.items[2]] } };
      renderScreen();

      expect(within(region(/^商談予定/)).getByText(t.meetings.emptyToday)).toBeInTheDocument();
    });

    it('has no rest of the week on Sunday', () => {
      loadAll();
      mocks.queries.myMeetings = {
        data: { ...meetings, today: '2026-11-01', total: 1, items: [meetings.items[2]] },
      };
      renderScreen();
      const section = region(/^商談予定/);

      expect(within(section).getByRole('region', { name: t.meetings.todayHeading })).toBeInTheDocument();
      expect(
        within(section).queryByRole('region', { name: t.meetings.laterHeading })
      ).not.toBeInTheDocument();
    });

    it('counts the meetings past the ones listed', () => {
      loadAll();
      mocks.queries.myMeetings = { data: { ...meetings, total: 53 } };
      renderScreen();

      expect(
        within(region(/^商談予定/)).getByText('ほか 50 件あります（表示は早い順に3件まで）')
      ).toBeInTheDocument();
    });
  });

  describe('activity of the day', () => {
    it('counts the contacts by kind, every kind shown, with the time they took', () => {
      loadAll();
      renderScreen();
      const section = region(/^今日の活動/);

      expect(within(section).getAllByRole('term').map((term) => term.textContent)).toEqual([
        '電話',
        'メール',
        '訪問',
        'オンライン商談',
        '不通',
        t.activities.durationLabel,
      ]);
      expect(within(section).getAllByRole('definition').map((value) => value.textContent)).toEqual(
        ['2件', '0件', '0件', '1件', '0件', '1時間30分']
      );
      expect(within(section).getByRole('heading', { level: 2 })).toHaveTextContent('3件');
    });

    it('lists each record with its time, what it was, the lead’s activity and the details', () => {
      loadAll();
      renderScreen();
      const items = within(region(/^今日の活動/)).getAllByRole('listitem');

      expect(items).toHaveLength(2);
      const first = within(items[0]);
      expect(first.getByText('10:00')).toBeInTheDocument();
      expect(first.getByText('オンライン商談')).toBeInTheDocument();
      expect(first.getByRole('link', { name: /架空商事/ })).toHaveAttribute(
        'href',
        `/ja/leads/${LEAD_1}?tab=activity`
      );
      expect(first.getByRole('link', { name: /基幹システム移行/ })).toHaveAttribute(
        'href',
        `/ja/deals/${DEAL_1}`
      );
      expect(first.getByText('移行の範囲を確認した')).toBeInTheDocument();
      expect(within(items[1]).getByText('電話で連絡')).toBeInTheDocument();
    });

    it('says so when nothing was recorded today', () => {
      loadAll();
      mocks.queries.myDay = {
        data: { ...day, total: 0, byKind: { ...day.byKind, call: 0, online_meeting: 0 }, items: [] },
      };
      renderScreen();

      expect(within(region(/^今日の活動/)).getByText(t.activities.empty)).toBeInTheDocument();
    });
  });

  describe('deals that need attention', () => {
    it('lists the marked deals, past the close date first, with the marks in words', () => {
      loadAll();
      renderScreen();
      const section = region(/^注意が必要な商談/);
      // The deals, not the marks listed in each
      const items = Array.from(within(section).getAllByRole('list')[0].children) as HTMLElement[];

      expect(items).toHaveLength(2);
      expect(within(items[0]).getByRole('link', { name: '基幹システム移行' })).toHaveAttribute(
        'href',
        `/ja/deals/${DEAL_1}`
      );
      expect(within(items[0]).getByText(messages.deals.card.overdue)).toBeInTheDocument();
      expect(within(items[0]).getByText('受注予定日 2026/10/20')).toBeInTheDocument();
      expect(within(items[1]).getByRole('link', { name: '帳票の移行' })).toBeInTheDocument();
      expect(within(items[1]).getByText(messages.deals.card.noNextAction)).toBeInTheDocument();
      expect(within(section).queryByText('順調な商談')).not.toBeInTheDocument();
      expect(within(section).getByRole('heading', { level: 2 })).toHaveTextContent('2件');
      expect(within(section).getByRole('link', { name: t.deals.viewAll })).toHaveAttribute(
        'href',
        '/ja/deals?owner=mine&view=list'
      );
    });

    it('says so when no deal needs attention', () => {
      loadAll();
      // Only the deal on track
      const onTrack = { ...board.columns[0], deals: [board.columns[0].deals[1]] };
      mocks.queries.board = { data: { ...board, columns: [onTrack] } };
      renderScreen();

      expect(within(region(/^注意が必要な商談/)).getByText(t.deals.empty)).toBeInTheDocument();
    });

    it('is left out for those who may not read deals, the other sections staying', () => {
      loadAll();
      mocks.queries.board = { isError: true, error: { data: { code: 'FORBIDDEN' } } };
      renderScreen();

      expect(screen.queryByRole('region', { name: /^注意が必要な商談/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(region(/^商談予定/)).toBeInTheDocument();
      expect(region(/^今日の活動/)).toBeInTheDocument();
    });
  });

  it('shows each section loading on its own while its data comes', () => {
    renderScreen();

    for (const name of [/^商談予定/, /^今日の活動/, /^注意が必要な商談/]) {
      const section = region(name);
      expect(within(section).getByText(t.section.loading)).toBeInTheDocument();
      expect(section.querySelector('[aria-busy="true"]')).not.toBeNull();
    }
    // No day before the server answered
    expect(screen.queryByText(/（日本時間）/)).not.toBeInTheDocument();
  });

  it('says a section failed with a retry, and shows the others', async () => {
    loadAll();
    mocks.queries.myMeetings = { isError: true };
    const user = userEvent.setup();
    renderScreen();

    const failed = within(region(/^商談予定/)).getByRole('alert');
    expect(failed).toHaveTextContent(t.section.loadError);
    await user.click(within(failed).getByRole('button', { name: t.section.retry }));
    expect(mocks.refetch.myMeetings).toHaveBeenCalledTimes(1);

    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(within(region(/^今日の活動/)).getAllByRole('listitem')).toHaveLength(2);
    expect(within(region(/^注意が必要な商談/)).getByText('帳票の移行')).toBeInTheDocument();
    // The day still comes from the sections that loaded
    expect(screen.getByText('2026年10月29日(木)（日本時間）')).toBeInTheDocument();
  });

  it('takes the day from the meetings when the activity has not loaded', () => {
    mocks.queries = { myMeetings: { data: { ...meetings, today: '2026-10-30' } } };
    renderScreen();

    expect(screen.getByText('2026年10月30日(金)（日本時間）')).toBeInTheDocument();
  });
});
