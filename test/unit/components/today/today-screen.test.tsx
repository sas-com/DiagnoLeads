/**
 * The 今日 screen (#556): the member's next actions (theirs only), meetings of today and the rest
 * of the week, deals that need attention and today's contacts with their counts, in that order,
 * each in the same frame with its own loading, failure and empty states (one failing leaves the
 * others), the deals left out for those who may not read them, a notice without an
 * organization, the day the server read in the heading, and every query read again when the
 * window comes back. Those who may edit leads record a contact from a next action's or a
 * meeting's row (#863). Rendered with the Japanese and the English messages (tRPC mocked)
 */
import { TODAY_CONTACTS_SHOWN } from '@/components/features/today/today-activities';
import { TODAY_NEXT_ACTIONS_SHOWN } from '@/components/features/today/today-next-actions';
import { TodayScreen } from '@/components/features/today/today-screen';
import enMessages from '@/locales/en/common.json';
import messages from '@/locales/ja/common.json';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
type MutationOptions = { onSuccess?: (result: unknown, input: unknown) => void };

const mocks = vi.hoisted(() => ({
  organizationId: '' as string | null,
  queries: {} as Record<string, QueryState>,
  calls: {} as Record<string, QueryCall[]>,
  refetch: {} as Record<string, () => void>,
  /** What leadFollowUp.recordContact was called with */
  recorded: [] as unknown[],
  /** A record on its way */
  recordPending: false,
  invalidated: [] as { path: string; input: unknown }[],
  toast: { success: vi.fn(), error: vi.fn() },
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
  const invalidate = (path: string) => ({
    invalidate: (input?: unknown) => {
      mocks.invalidated.push({ path, input });
    },
  });
  return {
    trpc: {
      useUtils: () => ({
        leadFollowUp: {
          tasks: invalidate('leadFollowUp.tasks'),
          dueTasks: invalidate('leadFollowUp.dueTasks'),
          contacts: invalidate('leadFollowUp.contacts'),
        },
        leadActivity: {
          list: invalidate('leadActivity.list'),
          forDeal: invalidate('leadActivity.forDeal'),
          myDay: invalidate('leadActivity.myDay'),
        },
        analytics: { getDashboard: invalidate('analytics.getDashboard') },
        deals: { board: invalidate('deals.board') },
      }),
      leadFollowUp: {
        dueTasks: query('dueTasks'),
        updateTask: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
        recordContact: {
          useMutation: (options: MutationOptions = {}) => ({
            isPending: mocks.recordPending,
            mutateAsync: async (input: { kind: string }) => {
              mocks.recorded.push(input);
              const saved = { id: 'contact-1', kind: input.kind, contactedAt: new Date() };
              options.onSuccess?.(saved, input);
              return saved;
            },
          }),
        },
        deleteContact: { useMutation: () => ({ mutate: vi.fn() }) },
      },
      leads: { myMeetings: query('myMeetings'), access: query('access') },
      leadActivity: { myDay: query('myDay') },
      deals: { board: query('board'), forLead: query('forLead') },
    },
  };
});
vi.mock('@/hooks/use-organization', () => ({
  useOrganization: () => ({ organizationId: mocks.organizationId }),
}));
vi.mock('sonner', () => ({ toast: mocks.toast }));

// The menus and the dialog (Radix) in jsdom
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture ??= () => false;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

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

/** As many due next actions as the server lists at first (20), of `total` */
const manyDue = (total: number) => {
  const items = Array.from({ length: Math.min(total, 20) }, (_, index) => ({
    ...dueTask,
    id: `task-${index}`,
    title: `タスク${index + 1}`,
  }));
  return { ...due, total, counts: { mine: total, all: total }, items };
};

/** What a member who may edit leads may do with them (leads.access) */
const access = { canCreate: true, canEdit: true, canDelete: false, canReadComments: true };

const loadAll = () => {
  mocks.queries = {
    dueTasks: { data: due },
    myMeetings: { data: meetings },
    myDay: { data: day },
    board: { data: board },
    access: { data: access },
  };
};

beforeEach(() => {
  mocks.organizationId = ORG_ID;
  mocks.queries = {};
  mocks.calls = {};
  mocks.refetch = {};
  mocks.recorded = [];
  mocks.recordPending = false;
  mocks.invalidated = [];
  mocks.toast.success.mockClear();
  mocks.toast.error.mockClear();
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
    for (const name of ['dueTasks', 'myMeetings', 'myDay', 'board', 'access']) {
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
      // Every one listed is the member's: no "mine" badge
      expect(within(section).queryByText(messages.leadFollowUp.today.mineBadge)).toBeNull();
    });

    it('lists five, and the rest when "N more" is opened', async () => {
      loadAll();
      mocks.queries.dueTasks = { data: manyDue(22) };
      const user = userEvent.setup();
      renderScreen();
      const section = region(/^今日までの次の行動/);

      expect(within(section).getAllByRole('listitem')).toHaveLength(TODAY_NEXT_ACTIONS_SHOWN);
      await user.click(within(section).getByRole('button', { name: 'ほか17件' }));

      // The rest is read (up to 200) and listed
      expect(mocks.calls.dueTasks.at(-1)?.input).toEqual({
        organizationId: ORG_ID,
        scope: 'mine',
        limit: 200,
      });
      expect(within(section).getAllByRole('listitem')).toHaveLength(20);
      expect(within(section).getByRole('button', { name: messages.leadFollowUp.today.showLess })).toBeInTheDocument();
    });

    it('keeps the way back when the rest fails to load', async () => {
      loadAll();
      mocks.queries.dueTasks = { data: manyDue(22) };
      const user = userEvent.setup();
      renderScreen();
      const section = region(/^今日までの次の行動/);

      // The rest fails when it is opened
      mocks.queries.dueTasks = { isError: true };
      await user.click(within(section).getByRole('button', { name: 'ほか17件' }));

      expect(within(section).getByRole('alert')).toHaveTextContent(t.section.loadError);
      expect(
        within(section).getByRole('button', { name: messages.leadFollowUp.today.showLess })
      ).toHaveAttribute('aria-expanded', 'true');
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

    it('names a deal’s lead without a company or a person as the other sections do', () => {
      loadAll();
      const nameless = dealCard({ expectedCloseOn: '2026-10-20', company: null, leadName: null });
      mocks.queries.board = {
        data: { ...board, columns: [{ ...board.columns[1], deals: [nameless] }] },
      };
      renderScreen();

      expect(
        within(region(/^注意が必要な商談/)).getByRole('link', { name: /基幹システム移行/ })
      ).toHaveTextContent(t.noLeadName);
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

    it('says how many there are when the day has more than it lists', async () => {
      loadAll();
      const items = Array.from({ length: TODAY_CONTACTS_SHOWN + 2 }, (_, index) =>
        contact(`c${index}`, { contactKind: 'call', note: null })
      );
      // The server lists the latest 100 of the day; here 7 of 120 stand for them
      mocks.queries.myDay = { data: { ...day, total: 120, items } };
      const user = userEvent.setup();
      renderScreen();
      const section = region(/^今日の活動/);

      expect(within(section).queryByText(/全120件/)).not.toBeInTheDocument();
      await user.click(within(section).getByRole('button', { name: 'すべて表示（7件）' }));
      expect(within(section).getByText('新しい7件を表示しています（全120件）')).toBeInTheDocument();
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

  describe('recording a contact from a row (#863)', () => {
    const contactText = messages.leadFollowUp.contact;
    /** The buttons that open a row's menu, named with the row's lead */
    const recordButtons = (within_: HTMLElement = document.body) =>
      within(within_).queryAllByRole('button', { name: /への連絡を記録$/ });

    it('records a contact from a meeting’s row for its lead, and reads today’s activity again', async () => {
      loadAll();
      const user = userEvent.setup();
      renderScreen();
      const [, second] = within(group(region(/^商談予定/), t.meetings.todayHeading)).getAllByRole(
        'listitem'
      );

      const button = within(second).getByRole('button', { name: '佐藤 花子への連絡を記録' });
      expect(button).toHaveTextContent(contactText.recordMenu);
      await user.click(button);
      const menu = screen.getByRole('menu', { name: '佐藤 花子への連絡を記録' });
      expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
        contactText.kinds.call,
        contactText.kinds.email,
        contactText.kinds.no_answer,
        messages.leadFollowUp.activity.open,
      ]);
      await user.click(within(menu).getByRole('menuitem', { name: contactText.kinds.call }));

      expect(mocks.recorded).toEqual([{ organizationId: ORG_ID, leadId: LEAD_2, kind: 'call' }]);
      expect(mocks.invalidated).toContainEqual({
        path: 'leadActivity.myDay',
        input: { organizationId: ORG_ID },
      });
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      // The toast names the lead, as records from the rows follow one another
      expect(mocks.toast.success).toHaveBeenCalledWith(
        '「電話した」を記録しました',
        expect.objectContaining({ description: '佐藤 花子' })
      );
    });

    it('opens on the tap of a touch screen, not where a scroll starts', async () => {
      loadAll();
      const user = userEvent.setup();
      renderScreen();
      const [button] = recordButtons(region(/^商談予定/));

      // A finger down may start a scroll: the menu waits for the tap
      await user.pointer({ keys: '[TouchA>]', target: button });
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      await user.pointer({ keys: '[/TouchA]', target: button });
      expect(screen.getByRole('menu', { name: '架空商事への連絡を記録' })).toBeInTheDocument();
    });

    it('stays closed when a touch on it becomes a scroll', () => {
      loadAll();
      renderScreen();
      const [button] = recordButtons(region(/^商談予定/));

      for (const pointerType of ['touch', 'pen']) {
        fireEvent.pointerDown(button, { pointerType, button: 0, isPrimary: true });
        fireEvent.pointerCancel(button, { pointerType });
        expect(screen.queryByRole('menu'), pointerType).not.toBeInTheDocument();
      }
    });

    it('opens on the press of a mouse and on the keyboard as before', async () => {
      loadAll();
      // The release goes to the button although the open menu leaves the page without pointer
      // events, so that the click after the press is seen
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      renderScreen();
      const [button] = recordButtons(region(/^商談予定/));

      // Radix opens it on the press, and the click after it leaves it open
      await user.pointer({ keys: '[MouseLeft>]', target: button });
      expect(screen.getByRole('menu')).toBeInTheDocument();
      await user.pointer({ keys: '[/MouseLeft]', target: button });
      expect(screen.getByRole('menu')).toBeInTheDocument();
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();

      button.focus();
      await user.keyboard(' ');
      expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('records a contact from a next action’s row for its lead', async () => {
      loadAll();
      mocks.queries.dueTasks = {
        data: { ...due, items: [{ ...dueTask, leadId: LEAD_3, lead: { name: null, company: '架空物産' } }] },
      };
      const user = userEvent.setup();
      renderScreen();
      const row = within(region(/^今日までの次の行動/)).getByRole('listitem');

      await user.click(within(row).getByRole('button', { name: '架空物産への連絡を記録' }));
      await user.click(screen.getByRole('menuitem', { name: contactText.kinds.call }));

      expect(mocks.recorded).toEqual([{ organizationId: ORG_ID, leadId: LEAD_3, kind: 'call' }]);
      expect(mocks.invalidated).toContainEqual({
        path: 'leadActivity.myDay',
        input: { organizationId: ORG_ID },
      });
    });

    it('opens the menu and chooses from it with the keyboard, the focus coming back to the button', async () => {
      loadAll();
      const user = userEvent.setup();
      renderScreen();
      const button = within(region(/^今日までの次の行動/)).getByRole('button', {
        name: '架空商事への連絡を記録',
      });

      button.focus();
      await user.keyboard('{Enter}');
      expect(screen.getByRole('menuitem', { name: contactText.kinds.call })).toHaveFocus();
      await user.keyboard('{ArrowDown}{Enter}');

      expect(mocks.recorded).toEqual([{ organizationId: ORG_ID, leadId: LEAD_1, kind: 'email' }]);
      await waitFor(() => expect(button).toHaveFocus());
    });

    it('opens the activity dialog for the row’s lead, and gives the focus back when it closes', async () => {
      loadAll();
      const user = userEvent.setup();
      renderScreen();
      const button = within(group(region(/^商談予定/), t.meetings.laterHeading)).getByRole(
        'button',
        { name: '架空物産への連絡を記録' }
      );

      await user.click(button);
      await user.click(
        screen.getByRole('menuitem', { name: messages.leadFollowUp.activity.open })
      );

      const dialog = screen.getByRole('dialog', { name: messages.leadFollowUp.activity.title });
      expect(dialog).toHaveTextContent('架空物産への連絡・訪問・オンライン商談');
      expect(mocks.recorded).toEqual([]);
      await user.click(within(dialog).getByRole('button', { name: messages.common.cancel }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      await waitFor(() => expect(button).toHaveFocus());
    });

    it('puts the button beside the meeting’s link in the row, never inside it', () => {
      loadAll();
      renderScreen();
      const items = within(region(/^商談予定/)).getAllByRole('listitem');

      expect(items).toHaveLength(3);
      for (const item of items) {
        const link = within(item).getByRole('link');
        const [button] = recordButtons(item);
        expect(link.querySelector('button')).toBeNull();
        expect(button.parentElement).toBe(item);
      }
    });

    it('keeps a next action’s lead and its button past the box’s tap area, the lead 44px to tap', () => {
      loadAll();
      renderScreen();
      const row = within(region(/^今日までの次の行動/)).getByRole('listitem');
      const [button] = recordButtons(row);
      const line = button.parentElement as HTMLElement;

      // The lead and the button share the line under the title, indented like the lead alone;
      // from sm they take at most 45% of the row, the lead's name cut first
      expect(line).toHaveClass('basis-full', 'pl-8', 'sm:pl-0', 'sm:max-w-[45%]');
      const lead = within(line).getByRole('link', { name: /架空商事/ });
      expect(lead).toHaveAttribute('href', `/ja/leads/${LEAD_1}`);
      expect(lead).toHaveClass('flex', 'min-w-0', 'min-h-11', 'underline');
      expect(within(lead).getByText('架空商事', { exact: false })).toHaveClass('block', 'truncate');
      expect(within(row).getByRole('checkbox')).toHaveClass('after:-inset-[13px]');
    });

    it('sizes the button and the menu for DADS: 44px to tap on phones and no text under 14px', async () => {
      loadAll();
      const user = userEvent.setup();
      renderScreen();
      const [button] = recordButtons(region(/^商談予定/));

      expect(button).toHaveClass('min-h-11', 'text-sm');
      expect(button.querySelector('.animate-spin')).toBeNull();
      await user.click(button);
      for (const item of screen.getAllByRole('menuitem')) {
        expect(item, item.textContent ?? '').toHaveClass('min-h-11', 'text-sm');
        expect(item, item.textContent ?? '').not.toHaveClass('text-xs');
      }
    });

    it('does not open while a record is on its way, the button keeping the focus', async () => {
      loadAll();
      mocks.recordPending = true;
      const user = userEvent.setup();
      renderScreen();
      const [button] = recordButtons(region(/^今日までの次の行動/));

      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).toBeEnabled();
      // A spinner in place of the icon (still under reduced motion), and no hover colour
      expect(button.querySelector('svg')).toHaveClass('animate-spin', 'motion-reduce:animate-none');
      expect(button).toHaveClass(
        'aria-disabled:hover:bg-white',
        'dark:aria-disabled:hover:bg-gray-800'
      );
      await user.click(button);
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      // Nor on a tap
      await user.pointer([{ keys: '[TouchA]', target: button }]);
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(mocks.recorded).toEqual([]);
    });

    it('shows no way to record to those who may not edit leads, the rows staying', () => {
      loadAll();
      mocks.queries.access = { data: { ...access, canEdit: false } };
      renderScreen();

      expect(recordButtons()).toEqual([]);
      expect(within(region(/^商談予定/)).getAllByRole('listitem')).toHaveLength(3);
      expect(within(region(/^今日までの次の行動/)).getByRole('link', { name: /架空商事/ })).toHaveClass(
        'basis-full',
        'pl-8'
      );
    });

    it('shows none until the server said what the member may do', () => {
      loadAll();
      mocks.queries.access = {};
      renderScreen();

      expect(recordButtons()).toEqual([]);
      expect(mocks.calls.access.at(-1)?.input).toEqual({ organizationId: ORG_ID });
    });

    it('says its words in its name with the lead, for voice control, in Japanese and English', () => {
      for (const [locale, name, words] of [
        ['ja', '架空商事への連絡を記録', contactText.recordMenu],
        ['en', 'Record a contact with 架空商事', enMessages.leadFollowUp.contact.recordMenu],
      ] as const) {
        loadAll();
        const view = renderScreen(locale);

        const [button] = within(document.body).getAllByRole('button', { name });
        expect(button, locale).toHaveTextContent(words);
        // The words shown are in the name (WCAG 2.5.3 Label in Name)
        expect(name, locale).toContain(words);
        view.unmount();
      }
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
