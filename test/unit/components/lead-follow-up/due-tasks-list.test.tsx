/**
 * The due next actions list shared by the dashboard's card and the 今日 screen (#556): sized for
 * DADS (no text under 14px, a 44px tap area around the 20px box, an underlined lead link, tap
 * targets for "N more"), completing one refreshes the deals' marks too (a deal is marked when its
 * lead has no open next action), and the dashboard's card keeps its switch and frame (real
 * next-intl messages; tRPC mocked)
 */
import { DueTasksList, DueTasksMore } from '@/components/features/lead-follow-up/due-tasks-list';
import { DueTasksSection } from '@/components/features/lead-follow-up/due-tasks-section';
import { useDueTasks } from '@/components/features/lead-follow-up/use-due-tasks';
import messages from '@/locales/ja/common.json';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '770e8400-e29b-41d4-a716-446655440001';
const t = messages.leadFollowUp.today;

const mocks = vi.hoisted(() => ({
  due: undefined as unknown,
  dueCalls: [] as { input: unknown; options: Record<string, unknown> }[],
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
          useQuery: (input: unknown, options: Record<string, unknown>) => {
            mocks.dueCalls.push({ input, options });
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

/** The list as the 今日 screen shows it: the user's own, read again when the window comes back */
function MineList() {
  const due = useDueTasks(ORG_ID, 'mine', { refetchOnWindowFocus: true });
  return (
    <>
      <DueTasksList due={due} organizationId={ORG_ID} showMineBadge={false} />
      <DueTasksMore due={due} />
    </>
  );
}

const task = (id: string, values: Record<string, unknown> = {}) => ({
  id,
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
  ...values,
});

const due = (items: unknown[], total = items.length) => ({
  today: '2026-10-29',
  canEdit: true,
  scope: 'mine',
  total,
  counts: { mine: total, all: total + 3 },
  items,
});

beforeEach(() => {
  mocks.due = undefined;
  mocks.dueCalls = [];
  mocks.updates = [];
  mocks.invalidated = [];
});

describe('DueTasksList', () => {
  it('gives the 20px box a 44px tap area: 13px around its 18px inside the border', () => {
    mocks.due = due([task('t1')]);
    wrap(<MineList />);

    const box = screen.getByRole('checkbox', { name: '「見積もりを送る」を完了にする' });
    expect(box).toHaveClass('h-5', 'w-5', 'border', 'relative', 'after:absolute', 'after:-inset-[13px]');
  });

  it('indents the lead link on phones past the box’s tap area, like the line under it', () => {
    mocks.due = due([task('t1')]);
    wrap(<MineList />);

    expect(screen.getByRole('link', { name: /架空商事/ })).toHaveClass('basis-full', 'pl-8', 'sm:pl-0');
  });

  it('names a lead with a blank company by its person, and one with neither as nameless', () => {
    mocks.due = due([
      task('t1', { lead: { company: ' ', name: '山田 花子' } }),
      task('t2', { lead: { company: '  ', name: null } }),
    ]);
    wrap(<MineList />);

    const [first, second] = screen.getAllByRole('listitem');
    const person = within(first).getByRole('link');
    expect(person).toHaveTextContent(/^山田 花子$/);
    // The person names the lead, not a grey second name after a blank company
    expect(person.querySelector('span')).toBeNull();
    expect(within(second).getByRole('link', { name: t.noLeadName })).toBeInTheDocument();
  });

  it('underlines the lead link and writes no text under 14px', () => {
    mocks.due = due([
      task('t1', { kind: 'takeaway', checkWith: '広報部', dueOn: '2026-10-29' }),
    ]);
    wrap(<MineList />);

    const lead = screen.getByRole('link', { name: /架空商事.*山田 花子/ });
    expect(lead).toHaveAttribute('href', `/ja/leads/${LEAD_ID}`);
    expect(lead).toHaveClass('underline', 'text-brand-700');
    const row = screen.getByRole('listitem');
    for (const text of ['今日', '持ち帰り', '確認先：広報部']) {
      const element = within(row).getByText(new RegExp(text));
      expect(element, text).toHaveClass('text-sm');
      expect(element, text).not.toHaveClass('text-xs');
    }
  });

  it('opens the rest with a tap target on phones', async () => {
    mocks.due = due(
      Array.from({ length: 20 }, (_, index) => task(`t${index}`)),
      22
    );
    const user = userEvent.setup();
    wrap(<MineList />);

    const more = screen.getByRole('button', { name: 'ほか2件' });
    expect(more).toHaveClass('min-h-11');
    expect(more).toHaveAttribute('aria-controls', screen.getByRole('list').id);
    await user.click(more);
    expect(mocks.dueCalls.at(-1)?.input).toEqual({ organizationId: ORG_ID, scope: 'mine', limit: 200 });
  });

  it('refreshes the deals’ marks with the next actions when one is completed', async () => {
    mocks.due = due([task('t1')]);
    const user = userEvent.setup();
    wrap(<MineList />);

    await user.click(screen.getByRole('checkbox', { name: '「見積もりを送る」を完了にする' }));

    expect(mocks.updates).toEqual([{ organizationId: ORG_ID, id: 't1', done: true }]);
    expect(mocks.invalidated).toEqual(
      expect.arrayContaining([
        { path: 'dueTasks', input: { organizationId: ORG_ID } },
        { path: 'deals.board', input: { organizationId: ORG_ID } },
      ])
    );
  });

  it('passes the screen’s query options through', () => {
    mocks.due = due([]);
    wrap(<MineList />);

    expect(mocks.dueCalls.at(-1)).toMatchObject({
      input: { organizationId: ORG_ID, scope: 'mine' },
      options: { refetchOnWindowFocus: true, staleTime: 60_000 },
    });
  });
});

describe('DueTasksSection (the dashboard)', () => {
  it('reads its heading with the count as words, and its description at 14px', () => {
    mocks.due = due([task('t1'), task('t2'), task('t3')]);
    wrap(<DueTasksSection organizationId={ORG_ID} />);

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/^今日やること 3件$/);
    const description = screen.getByText(t.descriptionAll);
    expect(description).toHaveClass('text-sm', 'text-gray-600');
    expect(description).not.toHaveClass('text-xs');
  });

  it('still lists 20 before "N more"', () => {
    mocks.due = due(
      Array.from({ length: 20 }, (_, index) => task(`t${index}`)),
      22
    );
    wrap(<DueTasksSection organizationId={ORG_ID} />);

    expect(screen.getAllByRole('listitem')).toHaveLength(20);
    expect(screen.getByRole('button', { name: 'ほか2件' })).toBeInTheDocument();
  });

  it('keeps its switch, its frame and its own options', () => {
    mocks.due = due([task('t1')]);
    wrap(<DueTasksSection organizationId={ORG_ID} />);

    expect(screen.getByRole('radio', { name: '自分の分だけ（1）' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '全員（4）' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: new RegExp(t.title) })).toHaveTextContent('1');
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(mocks.dueCalls.at(-1)?.options).not.toHaveProperty('refetchOnWindowFocus');
  });
});
