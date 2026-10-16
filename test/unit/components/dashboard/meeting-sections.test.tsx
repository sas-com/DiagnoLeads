/**
 * Dashboard cards 今週の商談予定 and 初回商談から次回日程が決まった率 (#137)
 * (real next-intl messages; tRPC mocked)
 */
import {
  NextMeetingRateSection,
  WeekMeetingsSection,
} from '@/components/dashboard/meeting-sections';
import { TooltipProvider } from '@/components/ui/tooltip';
import messages from '@/locales/ja/common.json';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_1 = '11111111-1111-4111-8111-111111111111';
const LEAD_2 = '22222222-2222-4222-8222-222222222222';
const LEAD_3 = '33333333-3333-4333-8333-333333333333';
const t = messages.dashboard.meetings;

type QueryState = { data?: unknown; isError?: boolean };
const mocks = vi.hoisted(() => ({
  week: {} as QueryState,
  rate: {} as QueryState,
  weekInput: vi.fn(),
  rateInput: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    leads: {
      weekMeetings: {
        useQuery: (input: unknown) => {
          mocks.weekInput(input);
          return { ...mocks.week, refetch: mocks.refetch };
        },
      },
      nextMeetingRate: {
        useQuery: (input: unknown) => {
          mocks.rateInput(input);
          return { ...mocks.rate, refetch: mocks.refetch };
        },
      },
    },
  },
}));

const wrap = (node: ReactNode) =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <TooltipProvider>{node}</TooltipProvider>
    </NextIntlClientProvider>
  );

beforeEach(() => {
  mocks.week = {};
  mocks.rate = {};
  mocks.weekInput.mockClear();
  mocks.rateInput.mockClear();
  mocks.refetch.mockClear();
});

describe('WeekMeetingsSection', () => {
  it('lists the week’s meetings earliest first with company, assignee and rating, linked to the lead', () => {
    mocks.week = {
      data: {
        weekStart: '2026-10-12',
        weekEnd: '2026-10-18',
        today: '2026-10-15',
        total: 13,
        items: [
          {
            leadId: LEAD_1,
            name: '山田 太郎',
            company: '架空製作所',
            status: 'nurturing',
            nextMeetingDate: '2026-10-14',
            dealRating: 'a',
            assignee: null,
          },
          {
            leadId: LEAD_2,
            name: null,
            company: null,
            status: 'new',
            nextMeetingDate: '2026-10-15',
            dealRating: null,
            assignee: { id: 'u', name: '佐藤 花子', email: 'sato@example.jp' },
          },
          {
            // Won: a passed date is not marked
            leadId: LEAD_3,
            name: null,
            company: '受注済み製作所',
            status: 'won',
            nextMeetingDate: '2026-10-13',
            dealRating: null,
            assignee: null,
          },
        ],
      },
    };
    wrap(<WeekMeetingsSection organizationId={ORG_ID} />);
    expect(mocks.weekInput).toHaveBeenCalledWith({ organizationId: ORG_ID });
    expect(screen.getByRole('heading', { name: /今週の商談予定/ })).toHaveTextContent('13');

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(within(items[2]).queryByTestId('next-meeting-overdue')).not.toBeInTheDocument();
    const first = within(items[0]);
    expect(first.getByRole('link')).toHaveAttribute('href', `/ja/leads/${LEAD_1}`);
    expect(first.getByText('架空製作所')).toBeInTheDocument();
    expect(first.getByText('山田 太郎')).toBeInTheDocument();
    expect(first.getByText('評価 A')).toBeInTheDocument();
    expect(first.getByText(t.unassigned)).toBeInTheDocument();
    // Monday-Wednesday meetings without a newer hearing stand out
    expect(first.getByTestId('next-meeting-overdue')).toBeInTheDocument();
    expect(first.getByText(/10\/14/)).toBeInTheDocument();

    const second = within(items[1]);
    expect(second.getByText(t.noCompany)).toBeInTheDocument();
    expect(second.getByText('佐藤 花子')).toBeInTheDocument();
    expect(second.getByText(t.today)).toBeInTheDocument();
    expect(second.queryByTestId('next-meeting-overdue')).not.toBeInTheDocument();

    // The rest are in the list, filtered and sorted the same way
    const more = screen.getByRole('link', { name: 'ほか 10 件を一覧で見る' });
    expect(more).toHaveAttribute('href', '/ja/leads?next=thisWeek&sort=nextMeetingDate&order=asc');
    expect(screen.getByRole('link', { name: t.viewAll })).toHaveAttribute(
      'href',
      '/ja/leads?next=thisWeek&sort=nextMeetingDate&order=asc'
    );
  });

  it('says when there is no meeting this week', () => {
    mocks.week = {
      data: { weekStart: '', weekEnd: '', today: '2026-10-15', total: 0, items: [] },
    };
    wrap(<WeekMeetingsSection organizationId={ORG_ID} />);
    expect(screen.getByText(t.empty)).toBeInTheDocument();
  });

  it('shows placeholders while loading and a retry on error', async () => {
    const { unmount } = wrap(<WeekMeetingsSection organizationId={ORG_ID} />);
    expect(screen.getByTestId('card-skeleton')).toBeInTheDocument();
    expect(screen.queryByText(t.empty)).not.toBeInTheDocument();
    unmount();

    mocks.week = { isError: true };
    wrap(<WeekMeetingsSection organizationId={ORG_ID} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: '再読み込み' }));
    expect(mocks.refetch).toHaveBeenCalled();
  });
});

describe('NextMeetingRateSection', () => {
  it('shows the rate with the counts for the period', () => {
    mocks.rate = {
      data: { from: '2026-10-09', to: '2026-10-15', firstMeetings: 8, withNextMeeting: 6, rate: 0.75 },
    };
    wrap(<NextMeetingRateSection organizationId={ORG_ID} days={7} />);
    expect(mocks.rateInput).toHaveBeenCalledWith({ organizationId: ORG_ID, days: 7 });
    expect(screen.getByRole('heading', { name: t.rateTitle })).toBeInTheDocument();
    expect(screen.getByTestId('next-meeting-rate-value')).toHaveTextContent('75%');
    expect(screen.getByText('6件 / 初回商談 8件')).toBeInTheDocument();
    expect(screen.getByText('直近7日')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t.rateOverdueLink })).toHaveAttribute(
      'href',
      '/ja/leads?next=overdue&sort=nextMeetingDate&order=asc'
    );
  });

  it('says so when the period has no first meeting, instead of 0%', () => {
    mocks.rate = {
      data: { from: '2026-10-09', to: '2026-10-15', firstMeetings: 0, withNextMeeting: 0, rate: null },
    };
    wrap(<NextMeetingRateSection organizationId={ORG_ID} days={30} />);
    expect(screen.getByText(t.rateEmpty)).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });
});
