/**
 * The 今日 screen (#556): the member's next actions (theirs only), meetings of today and the rest
 * of the week, deals that need attention and today's contacts with their counts, in that order,
 * each in the same frame with its own loading, failure and empty states (one failing leaves the
 * others), the deals left out for those who may not read them, a notice without an
 * organization, the day the server read in the heading, and every query read again when the
 * window comes back. Rendered with the Japanese and the English messages (tRPC mocked)
 */
import { TODAY_CONTACTS_SHOWN } from '@/components/features/today/today-activities';
import { TodayScreen } from '@/components/features/today/today-screen';
import enMessages from '@/locales/en/common.json';
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
type QueryOptions = { staleTime?: number; enabled?: boolean; refetchOnWindowFocus?: boolean };
type QueryCall = { input: unknown; options: QueryOptions };

const mocks = vi.hoisted(() => ({
  organizationId: '' as string | null,
  queries: {} as Record<string, QueryState>,
  calls: {} as Record<string, QueryCall[]>,
  refetch: {} as Record<string, () => void>,
}));

vi.mock('@/lib/trpc/client', () => {
  const query = (name: string) => ({
    useQuery: (input: unknown, options: QueryOptions = {}) => {
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
  useOrganization: () => ({ organizationId: mocks.organizationId }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const renderScreen = (locale: 'ja' | 'en' = 'ja') =>
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === 'ja' ? messages : enMessages}
      timeZone="Asia/Tokyo"
    >
      <TodayScreen />
    </NextIntlClientProvider>
  );

const region = (name: RegExp) => screen.getByRole('region', { name });
/** A group of the meetings: its heading and what follows it */
const group = (section: HTMLElement, name: string) =>
  within(section).getByRole('heading', { level: 3, name }).parentElement as HTMLElement;

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
    // No company: named by the person
    meeting({ leadId: LEAD_2, name: '佐藤 花子', dealRating: 'a' }),
    meeting({ leadId: LEAD_3, company: '架空物産', nextMeetingDate: '2026-11-01', status: 'won' }),
  ],
};

const contact = (id: string, values: Record<string, unknown> = {}) => ({
  lead: { id: LEAD_1, name: '山田 太郎', company: '架空商事' },
  event: {
    id: `contact:${id}`,
    kind: 'contact_recorded',
    at: new Date('2026-10-29T01:00:00Z'),
    actor: null,
    contactId: id,
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
    contact('c1'),
    {
      ...contact('c2', { contactKind: 'call', note: null, durationMinutes: null, outcome: null }),
      // Neither a company nor a person
      lead: { id: LEAD_2, name: null, company: null },
    },
    contact('c3', { contactKind: 'call', note: null, durationMinutes: null, outcome: null }),
  ],
};

const dealCard = (values: Record<string, unknown>) => ({
  id: DEAL_1,
  leadId: LEAD_1,
  name: '基幹システム移行',
  stage: 'proposal',
  amount: 3_000_000,
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
        dealCard({
          id: DEAL_2,
          name: '帳票の移行',
          stage: 'discovery',
          amount: null,
          expectedCloseOn: '2026-11-30',
          hasOpenTask: false,
        }),
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

const dueTask = {
  id: 'task-1',
  leadId: LEAD_1,
  title: '見積もりを送る',
  note: null,
  dueOn: '2026-10-28',
  done: false,
  completedAt: null,
  source: 'manual',
  sourceHearingId: null,
  kind: 'next_action',
  checkWith: null,
  checkWithUser: null,
  assigneeId: null,
  createdBy: null,
  createdAt: new Date('2026-10-20T00:00:00Z'),
  updatedAt: new Date('2026-10-20T00:00:00Z'),
  lead: { name: '山田 太郎', company: '架空商事' },
  mine: true,
};

const due = {
  today: '2026-10-29',
  canEdit: true,
  scope: 'mine',
  total: 1,
  counts: { mine: 1, all: 4 },
  items: [dueTask],
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
  mocks.organizationId = ORG_ID;
  mocks.queries = {};
  mocks.calls = {};
  mocks.refetch = {};
});

describe('TodayScreen', () => {
  it('heads the screen with the day the server read, and lists the sections in the order of the day', () => {
    loadAll();
    renderScreen();

    expect(screen.getByRole('heading', { level: 1, name: t.title })).toBeInTheDocument();
    expect(screen.getByText('2026年10月29日(木)・日本時間')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      '今日までの次の行動 1件',
      '商談予定 3件',
      '注意が必要な商談 2件',
      '今日の活動 3件',
    ]);
    // The four sections, and no landmark within them
    expect(screen.getAllByRole('region')).toHaveLength(4);
  });

  it('reads each section for the organization, and again when the window comes back', () => {
    loadAll();
    renderScreen();

    expect(mocks.calls.dueTasks.at(-1)?.input).toEqual({ organizationId: ORG_ID, scope: 'mine' });
    expect(mocks.calls.myMeetings.at(-1)?.input).toEqual({ organizationId: ORG_ID });
    expect(mocks.calls.myDay.at(-1)?.input).toEqual({ organizationId: ORG_ID });
    expect(mocks.calls.board.at(-1)?.input).toEqual({
      organizationId: ORG_ID,
      owner: 'mine',
      closedWithinDays: 0,
    });
    for (const name of ['dueTasks', 'myMeetings', 'myDay', 'board']) {
      const options = mocks.calls[name].at(-1)?.options;
      expect(options?.refetchOnWindowFocus, name).toBe(true);
      expect(options?.staleTime, name).toBeLessThanOrEqual(60_000);
    }
  });

  it('says to choose an organization, and reads nothing, without one', () => {
    mocks.organizationId = null;
    renderScreen();

    expect(screen.getByRole('status')).toHaveTextContent(t.noOrganization);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(screen.queryByTestId('day-loading')).not.toBeInTheDocument();
    for (const name of ['dueTasks', 'myMeetings', 'myDay', 'board']) {
      expect(mocks.calls[name].at(-1)?.options.enabled, name).toBe(false);
    }
  });

  describe('next actions', () => {
    it('frames the member’s own like the other sections, without the switch', () => {
      loadAll();
      renderScreen();
      const section = region(/^今日までの次の行動/);

      expect(within(section).getByText(messages.leadFollowUp.today.descriptionAll)).toBeInTheDocument();
      expect(within(section).getByRole('checkbox', { name: '「見積もりを送る」を完了にする' })).toBeInTheDocument();
      expect(within(section).getByRole('link', { name: /架空商事/ })).toHaveAttribute(
        'href',
        `/ja/leads/${LEAD_1}`
      );
      expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    });

    it('says so when nothing of the member’s is due', () => {
      loadAll();
      mocks.queries.dueTasks = { data: { ...due, total: 0, items: [] } };
      renderScreen();

      expect(
        within(region(/^今日までの次の行動/)).getByText(messages.leadFollowUp.today.emptyMine)
      ).toBeInTheDocument();
    });
  });

  describe('meetings', () => {
    it('lists today’s, then the rest of the week’s, with the time, marks and a link to the lead', () => {
      loadAll();
      renderScreen();
      const section = region(/^商談予定/);

      const todays = within(group(section, t.meetings.todayHeading)).getAllByRole('listitem');
      expect(todays).toHaveLength(2);
      const first = within(todays[0]);
      expect(first.getByRole('link')).toHaveAttribute('href', `/ja/leads/${LEAD_1}`);
      expect(first.getByText('09:00')).toHaveAttribute('datetime', '2026-10-29T09:00+09:00');
      expect(first.getByText('架空商事')).toBeInTheDocument();
      expect(first.getByText('山田 太郎')).toBeInTheDocument();
      expect(first.getByText(t.meetings.firstMeeting)).toBeInTheDocument();
      expect(first.getByText(t.meetings.unassigned)).toBeInTheDocument();
      const second = within(todays[1]);
      expect(second.getByText(t.meetings.noTime)).toBeInTheDocument();
      // Without a company, the person names the lead
      expect(second.getByText('佐藤 花子')).toBeInTheDocument();
      expect(second.queryByText(t.noLeadName)).not.toBeInTheDocument();
      expect(second.getByText('評価 A')).toBeInTheDocument();

      const later = within(group(section, t.meetings.laterHeading)).getAllByRole('listitem');
      expect(later).toHaveLength(1);
      expect(within(later[0]).getByText('11/1(日)')).toHaveAttribute('datetime', '2026-11-01');
      // A won lead keeps its meeting, said in words
      expect(within(later[0]).getByText(messages.status.won)).toBeInTheDocument();
    });

    it('says what the list link opens: the member’s leads’ meetings this week', () => {
      loadAll();
      renderScreen();

      // The list has the week's passed days and not the unassigned leads: the label says whose
      expect(
        within(region(/^商談予定/)).getByRole('link', { name: '担当リードの今週の予定を一覧で見る' })
      ).toHaveAttribute('href', '/ja/leads?assignee=me&next=thisWeek&sort=nextMeetingDate&order=asc');
    });

    it('says so for a part of the week without meetings', () => {
      loadAll();
      mocks.queries.myMeetings = { data: { ...meetings, total: 1, items: [meetings.items[2]] } };
      renderScreen();

      expect(
        within(group(region(/^商談予定/), t.meetings.todayHeading)).getByText(t.meetings.emptyToday)
      ).toBeInTheDocument();
    });

    it('has no rest of the week on Sunday', () => {
      loadAll();
      mocks.queries.myMeetings = {
        data: { ...meetings, today: '2026-11-01', total: 1, items: [meetings.items[2]] },
      };
      renderScreen();
      const section = region(/^商談予定/);

      expect(within(section).getByRole('heading', { level: 3, name: t.meetings.todayHeading })).toBeInTheDocument();
      expect(
        within(section).queryByRole('heading', { level: 3, name: t.meetings.laterHeading })
      ).not.toBeInTheDocument();
    });

    it('counts the meetings past the ones listed', () => {
      loadAll();
      mocks.queries.myMeetings = { data: { ...meetings, total: 53 } };
      renderScreen();

      expect(
        within(region(/^商談予定/)).getByText('ほか50件あります（早い順に3件を表示）')
      ).toBeInTheDocument();
    });

    it('says so when there is no meeting from today to Sunday', () => {
      loadAll();
      mocks.queries.myMeetings = { data: { ...meetings, total: 0, items: [] } };
      renderScreen();

      expect(within(region(/^商談予定/)).getByText(t.meetings.empty)).toBeInTheDocument();
    });
  });

  describe('deals that need attention', () => {
    it('lists the marked deals as links, past the close date first, with the marks in words', () => {
      loadAll();
      renderScreen();
      const section = region(/^注意が必要な商談/);
      // The deals, not the marks listed in each
      const items = Array.from(within(section).getAllByRole('list')[0].children) as HTMLElement[];

      expect(items).toHaveLength(2);
      const overdue = within(items[0]).getByRole('link');
      expect(overdue).toHaveAttribute('href', `/ja/deals/${DEAL_1}`);
      expect(overdue).toHaveTextContent('基幹システム移行');
      expect(overdue).toHaveTextContent(messages.deals.card.overdue);
      expect(overdue).toHaveTextContent('受注予定日 2026/10/20');
      expect(overdue).toHaveTextContent(/3,000,000/);
      const noTask = within(items[1]).getByRole('link');
      expect(noTask).toHaveAttribute('href', `/ja/deals/${DEAL_2}`);
      expect(noTask).toHaveTextContent(messages.deals.card.noNextAction);
      expect(noTask).toHaveTextContent(messages.deals.card.noAmount);
      expect(within(section).queryByText('順調な商談')).not.toBeInTheDocument();
    });

    it('opens the member’s deals by close date', () => {
      loadAll();
      renderScreen();

      expect(
        within(region(/^注意が必要な商談/)).getByRole('link', { name: t.deals.viewAll })
      ).toHaveAttribute('href', '/ja/deals?owner=mine&view=list&sort=expectedCloseOn');
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
      expect(screen.getAllByRole('region')).toHaveLength(3);
    });

    it('says another failure with a retry, as the other sections do', async () => {
      loadAll();
      mocks.queries.board = { isError: true, error: { data: { code: 'INTERNAL_SERVER_ERROR' } } };
      const user = userEvent.setup();
      renderScreen();

      const failed = within(region(/^注意が必要な商談/)).getByRole('alert');
      await user.click(within(failed).getByRole('button', { name: t.section.retry }));
      expect(mocks.refetch.board).toHaveBeenCalledTimes(1);
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
    });

    it('leaves the time out when none was recorded', () => {
      loadAll();
      mocks.queries.myDay = { data: { ...day, durationMinutes: 0 } };
      renderScreen();

      expect(
        within(region(/^今日の活動/)).queryByText(t.activities.durationLabel)
      ).not.toBeInTheDocument();
    });

    it('lists each record with its time, what it was, the lead’s activity and the details', () => {
      loadAll();
      renderScreen();
      const items = within(region(/^今日の活動/)).getAllByRole('listitem');

      expect(items).toHaveLength(3);
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
      expect(within(items[1]).getByText(t.noLeadName)).toBeInTheDocument();
    });

    it('lists the newest ones first and opens the rest with "show all"', async () => {
      loadAll();
      const items = Array.from({ length: TODAY_CONTACTS_SHOWN + 2 }, (_, index) =>
        contact(`c${index}`, { contactKind: 'call', note: null })
      );
      mocks.queries.myDay = { data: { ...day, total: items.length, items } };
      const user = userEvent.setup();
      renderScreen();
      const section = region(/^今日の活動/);

      expect(within(section).getAllByRole('listitem')).toHaveLength(TODAY_CONTACTS_SHOWN);
      const showAll = within(section).getByRole('button', { name: 'すべて表示（7件）' });
      expect(showAll).toHaveAttribute('aria-expanded', 'false');
      expect(showAll).toHaveAttribute('aria-controls', within(section).getByRole('list').id);
      expect(showAll).toHaveClass('min-h-11');

      await user.click(showAll);
      expect(within(section).getAllByRole('listitem')).toHaveLength(7);
      expect(within(section).getByRole('button', { name: t.activities.showLess })).toHaveAttribute(
        'aria-expanded',
        'true'
      );
      // The counts stay above the list either way
      expect(within(section).getAllByRole('term')).toHaveLength(6);
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

  it('shows each section loading on its own while its data comes, and keeps the day’s place', () => {
    renderScreen();

    for (const name of [/^今日までの次の行動/, /^商談予定/, /^注意が必要な商談/, /^今日の活動/]) {
      const section = region(name);
      expect(within(section).getByText(t.section.loading)).toBeInTheDocument();
      expect(section.querySelector('[aria-busy="true"]')).not.toBeNull();
    }
    expect(screen.queryByText(/日本時間/)).not.toBeInTheDocument();
    expect(screen.getByTestId('day-loading')).toBeInTheDocument();
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
    expect(within(region(/^今日の活動/)).getAllByRole('listitem')).toHaveLength(3);
    expect(within(region(/^注意が必要な商談/)).getByText('帳票の移行')).toBeInTheDocument();
    // The day still comes from the sections that loaded
    expect(screen.getByText('2026年10月29日(木)・日本時間')).toBeInTheDocument();
  });

  it('takes the day from the meetings when the activity has not loaded', () => {
    mocks.queries = { myMeetings: { data: { ...meetings, today: '2026-10-30' } } };
    renderScreen();

    expect(screen.getByText('2026年10月30日(金)・日本時間')).toBeInTheDocument();
  });

  it('gives up the day’s place when every section failed', () => {
    mocks.queries = {
      dueTasks: { isError: true },
      myMeetings: { isError: true },
      myDay: { isError: true },
      board: { isError: true },
    };
    renderScreen();

    expect(screen.getAllByRole('alert')).toHaveLength(4);
    expect(screen.queryByTestId('day-loading')).not.toBeInTheDocument();
  });

  it('reads in English with its headings and counts', () => {
    loadAll();
    mocks.queries.myMeetings = { data: { ...meetings, total: 53 } };
    renderScreen('en');
    const en = enMessages.today;

    expect(screen.getByRole('heading', { level: 1, name: en.title })).toBeInTheDocument();
    expect(screen.getByText(/· Japan time$/)).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Next actions due 1',
      'Meetings this week 53',
      'Deals that need attention 2',
      "Today's activity 3",
    ]);
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      en.meetings.todayHeading,
      en.meetings.laterHeading,
    ]);
    expect(
      within(region(/^Meetings this week/)).getByText('50 more meetings (the earliest 3 are shown)')
    ).toBeInTheDocument();
    expect(
      within(region(/^Meetings this week/)).getByRole('link', { name: en.meetings.viewAll })
    ).toBeInTheDocument();
  });
});
