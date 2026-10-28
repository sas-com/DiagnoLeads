/**
 * The next actions card with mineOnly, as the 今日 screen shows it (#556): only the user's own,
 * without the switch to everyone's, and completing one refreshes the deals' marks too (a deal is
 * marked when its lead has no open next action). The dashboard's card keeps its switch (real
 * next-intl messages; tRPC mocked)
 */
import { DueTasksSection } from '@/components/features/lead-follow-up/due-tasks-section';
import messages from '@/locales/ja/common.json';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '770e8400-e29b-41d4-a716-446655440001';
const t = messages.leadFollowUp.today;

const mocks = vi.hoisted(() => ({
  due: undefined as unknown,
  dueInputs: [] as unknown[],
  updates: [] as unknown[],
  invalidated: [] as { path: string; input: unknown }[],
}));

vi.mock('@/lib/trpc/client', () => {
  const invalidate = (path: string) => ({
    invalidate: (input?: unknown) => {
      mocks.invalidated.push({ path, input });
    },
  });
  return {
    trpc: {
      useUtils: () => ({
        leadFollowUp: { tasks: invalidate('tasks'), dueTasks: invalidate('dueTasks') },
        deals: { board: invalidate('deals.board') },
      }),
      leadFollowUp: {
        dueTasks: {
          useQuery: (input: unknown) => {
            mocks.dueInputs.push(input);
            return { data: mocks.due, isError: false, refetch: vi.fn() };
          },
        },
        updateTask: {
          useMutation: (options: { onSuccess?: () => void } = {}) => ({
            isPending: false,
            mutate: (input: unknown) => {
              mocks.updates.push(input);
              options.onSuccess?.();
            },
          }),
        },
      },
    },
  };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const wrap = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      {ui}
    </NextIntlClientProvider>
  );

const task = {
  id: 'task-1',
  leadId: LEAD_ID,
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
  lead: { name: '山田 花子', company: '架空商事' },
  mine: true,
};

const due = (items: unknown[]) => ({
  today: '2026-10-29',
  canEdit: true,
  scope: 'mine',
  total: items.length,
  counts: { mine: items.length, all: items.length + 3 },
  items,
});

beforeEach(() => {
  mocks.due = undefined;
  mocks.dueInputs = [];
  mocks.updates = [];
  mocks.invalidated = [];
});

describe('DueTasksSection mineOnly', () => {
  it('reads only the user’s own, without the switch to everyone’s', () => {
    mocks.due = due([task]);

    wrap(<DueTasksSection organizationId={ORG_ID} mineOnly />);

    expect(mocks.dueInputs).toEqual([{ organizationId: ORG_ID, scope: 'mine' }]);
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: t.scopeLabel })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /今日やること/ })).toHaveTextContent('1');
    // Every one listed is the user's: no "mine" badge
    expect(screen.queryByText(t.mineBadge)).not.toBeInTheDocument();
  });

  it('says when nothing of the user’s is due', () => {
    mocks.due = due([]);

    wrap(<DueTasksSection organizationId={ORG_ID} mineOnly />);

    expect(screen.getByText(t.emptyMine)).toBeInTheDocument();
  });

  it('refreshes the deals’ marks with the next actions when one is completed', async () => {
    mocks.due = due([task]);
    const user = userEvent.setup();
    wrap(<DueTasksSection organizationId={ORG_ID} mineOnly />);

    await user.click(screen.getByRole('checkbox', { name: '「見積もりを送る」を完了にする' }));

    expect(mocks.updates).toEqual([{ organizationId: ORG_ID, id: 'task-1', done: true }]);
    expect(mocks.invalidated).toEqual(
      expect.arrayContaining([
        { path: 'dueTasks', input: { organizationId: ORG_ID } },
        { path: 'deals.board', input: { organizationId: ORG_ID } },
      ])
    );
  });

  it('keeps the switch on the dashboard', () => {
    mocks.due = due([task]);

    wrap(<DueTasksSection organizationId={ORG_ID} />);

    expect(screen.getByRole('radio', { name: '自分の分だけ（1）' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '全員（4）' })).toBeInTheDocument();
  });
});
