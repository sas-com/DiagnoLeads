/**
 * Follow-up parts (#136, #85): the contact bar with its one-tap buttons, the next actions card
 * of the lead page and the dashboard's "today" card (real next-intl messages; tRPC mocked)
 */
import { DueTasksSection } from '@/components/features/lead-follow-up/due-tasks-section';
import { LeadContactBar } from '@/components/features/lead-follow-up/lead-contact-bar';
import { LeadNextActionsCard } from '@/components/features/lead-follow-up/lead-next-actions-card';
import messages from '@/locales/ja/common.json';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '770e8400-e29b-41d4-a716-446655440001';

type MutationOptions = { onSuccess?: (result: unknown) => void };

const mocks = vi.hoisted(() => ({
  contacts: undefined as unknown,
  tasks: undefined as unknown,
  due: undefined as unknown,
  calls: {} as Record<string, unknown[]>,
  /** What each mutation resolves with (onSuccess is called with it) */
  results: {} as Record<string, unknown>,
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/trpc/client', () => {
  const mutation = (name: string) => ({
    useMutation: (options: MutationOptions = {}) => ({
      isPending: false,
      mutate: (input: unknown) => {
        mocks.calls[name] = [...(mocks.calls[name] ?? []), input];
        options.onSuccess?.(mocks.results[name]);
      },
    }),
  });
  const invalidate = { invalidate: vi.fn() };
  return {
    trpc: {
      useUtils: () => ({
        leadFollowUp: { contacts: invalidate, tasks: invalidate, dueTasks: invalidate },
        leadActivity: { list: invalidate },
        analytics: { getDashboard: invalidate },
      }),
      leadFollowUp: {
        contacts: { useQuery: () => ({ data: mocks.contacts, isError: false }) },
        tasks: { useQuery: () => ({ data: mocks.tasks, isError: false }) },
        dueTasks: { useQuery: () => ({ data: mocks.due, isError: false, refetch: vi.fn() }) },
        recordContact: mutation('recordContact'),
        deleteContact: mutation('deleteContact'),
        createTask: mutation('createTask'),
        updateTask: mutation('updateTask'),
        deleteTask: mutation('deleteTask'),
      },
    },
  };
});
vi.mock('sonner', () => ({ toast: mocks.toast }));

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture ??= () => false;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.calls = {};
  mocks.results = {};
});

const wrap = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      {ui}
    </NextIntlClientProvider>
  );

const task = (overrides: Record<string, unknown> = {}) => ({
  id: 'task-1',
  leadId: LEAD_ID,
  title: '資料を送る',
  note: null,
  dueOn: '2026-10-16',
  done: false,
  completedAt: null,
  source: 'manual',
  sourceHearingId: null,
  assigneeId: null,
  createdBy: null,
  createdAt: new Date('2026-10-10T00:00:00Z'),
  updatedAt: new Date('2026-10-10T00:00:00Z'),
  ...overrides,
});

describe('LeadContactBar', () => {
  const renderBar = () =>
    wrap(<LeadContactBar organizationId={ORG_ID} leadId={LEAD_ID} leadLabel="架空商事" />);

  it('says nobody has contacted the lead yet and records "called" in one tap', async () => {
    mocks.contacts = { firstContactAt: null, total: 0, noAnswerCount: 0, recent: [], canEdit: true };
    mocks.results.recordContact = { id: 'c1', kind: 'call' };
    const user = userEvent.setup();
    renderBar();

    expect(screen.getByTestId('first-contact')).toHaveTextContent('まだ連絡の記録がありません');
    expect(screen.queryByText(/不通/)).not.toBeInTheDocument();
    const group = screen.getByRole('group', { name: '架空商事への連絡を記録' });
    await user.click(within(group).getByRole('button', { name: '電話した' }));

    expect(mocks.calls.recordContact).toEqual([
      { organizationId: ORG_ID, leadId: LEAD_ID, kind: 'call', note: null },
    ]);
    // The toast offers to undo a wrong tap
    const [message, options] = mocks.toast.success.mock.calls[0] as [
      string,
      { action: { label: string; onClick: () => void } },
    ];
    expect(message).toBe('「電話した」を記録しました');
    expect(options.action.label).toBe('取り消す');
    options.action.onClick();
    expect(mocks.calls.deleteContact).toEqual([{ organizationId: ORG_ID, id: 'c1' }]);
  });

  it('records with a note from the note button', async () => {
    mocks.contacts = { firstContactAt: null, total: 0, recent: [], canEdit: true };
    mocks.results.recordContact = { id: 'c2', kind: 'no_answer' };
    const user = userEvent.setup();
    renderBar();

    await user.click(screen.getByRole('button', { name: 'メモを付けて記録' }));
    await user.click(screen.getByRole('radio', { name: 'つながらなかった' }));
    await user.type(screen.getByLabelText('メモ（任意）'), '午後にかけ直す');
    await user.click(screen.getByRole('button', { name: '記録する' }));

    expect(mocks.calls.recordContact).toEqual([
      { organizationId: ORG_ID, leadId: LEAD_ID, kind: 'no_answer', note: '午後にかけ直す' },
    ]);
  });

  it('shows the first and latest contact, and no buttons to read-only roles', () => {
    mocks.contacts = {
      firstContactAt: new Date('2026-10-14T01:30:00Z'),
      total: 2,
      noAnswerCount: 1,
      recent: [
        {
          id: 'c2',
          leadId: LEAD_ID,
          kind: 'email',
          note: '資料を送付',
          contactedAt: new Date('2026-10-15T05:00:00Z'),
          createdBy: { id: 'u1', name: '担当 一郎' },
        },
      ],
      canEdit: false,
    };
    renderBar();

    expect(screen.getByTestId('first-contact')).toHaveTextContent('初回連絡 2026/10/14 10:30');
    expect(screen.getByTestId('first-contact')).toHaveTextContent('不通 1回');
    expect(screen.getByText(/最新：メールした（2026\/10\/15 14:00）・全2件 · 担当 一郎 · 資料を送付/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '電話した' })).not.toBeInTheDocument();
  });
});

describe('LeadNextActionsCard', () => {
  const renderCard = () => wrap(<LeadNextActionsCard organizationId={ORG_ID} leadId={LEAD_ID} />);

  it('lists open next actions with their due status and ticks one done', async () => {
    mocks.tasks = {
      today: '2026-10-16',
      canEdit: true,
      items: [
        task({ id: 'late', title: '見積もりを送る', dueOn: '2026-10-14' }),
        task({ id: 'meeting', title: null, source: 'hearing', dueOn: '2026-10-20' }),
        task({ id: 'done', title: '電話する', done: true, completedAt: new Date() }),
      ],
    };
    const user = userEvent.setup();
    renderCard();

    expect(screen.getByText('見積もりを送る')).toBeInTheDocument();
    expect(screen.getByText('期限切れ 10/14')).toBeInTheDocument();
    // A next action from a hearing keeps its default title
    expect(screen.getByText('次回の打ち合わせ')).toBeInTheDocument();
    expect(screen.getByText('ヒアリングの次回日程から')).toBeInTheDocument();
    // Done ones are folded away
    expect(screen.queryByText('電話する')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '完了した1件を表示' }));
    expect(screen.getByText('電話する')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: '「見積もりを送る」を完了にする' }));
    expect(mocks.calls.updateTask).toEqual([{ organizationId: ORG_ID, id: 'late', done: true }]);
  });

  it('adds a next action due today unless another date is chosen, and asks for a title', async () => {
    mocks.tasks = { today: '2026-10-16', canEdit: true, items: [] };
    const user = userEvent.setup();
    renderCard();

    expect(screen.getByText('次の行動はまだありません')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '追加' }));
    expect(screen.getByRole('alert')).toHaveTextContent('やることを入力してください');
    expect(mocks.calls.createTask).toBeUndefined();

    await user.type(screen.getByLabelText('やること'), '資料を送る');
    await user.clear(screen.getByLabelText('期限'));
    await user.type(screen.getByLabelText('期限'), '2026/10/23');
    await user.click(screen.getByRole('button', { name: '追加' }));
    expect(mocks.calls.createTask).toEqual([
      { organizationId: ORG_ID, leadId: LEAD_ID, title: '資料を送る', dueOn: '2026-10-23', note: null },
    ]);
  });

  it('moves the due date from the calendar', async () => {
    mocks.tasks = { today: '2026-10-16', canEdit: true, items: [task({ dueOn: '2026-10-20' })] };
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('button', { name: '「資料を送る」の期限を変更' }));
    await user.click(screen.getByRole('button', { name: '今日' }));
    expect(mocks.calls.updateTask).toEqual([
      { organizationId: ORG_ID, id: 'task-1', dueOn: '2026-10-16' },
    ]);
  });

  it('is read-only without permission to edit leads', () => {
    mocks.tasks = { today: '2026-10-16', canEdit: false, items: [task()] };
    renderCard();

    expect(screen.getByRole('checkbox', { name: '「資料を送る」を完了にする' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '追加' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '「資料を送る」を削除' })).not.toBeInTheDocument();
    expect(screen.getByText('今日まで')).toBeInTheDocument();
  });
});

describe('DueTasksSection', () => {
  it('lists overdue and today next actions with their lead, and completes one', async () => {
    mocks.due = {
      today: '2026-10-16',
      canEdit: true,
      total: 3,
      items: [
        { ...task({ id: 'a', title: '見積もりを送る', dueOn: '2026-10-15' }), lead: { name: '山田 花子', company: '架空商事' } },
        { ...task({ id: 'b', title: null, source: 'hearing' }), lead: { name: '佐藤 一郎', company: null } },
      ],
    };
    const user = userEvent.setup();
    wrap(<DueTasksSection organizationId={ORG_ID} />);

    expect(screen.getByRole('heading', { name: /今日やること/ })).toHaveTextContent('3');
    expect(screen.getByRole('link', { name: /架空商事.*山田 花子/ })).toHaveAttribute('href', `/ja/leads/${LEAD_ID}`);
    expect(screen.getByRole('link', { name: '佐藤 一郎' })).toBeInTheDocument();
    expect(screen.getByText('ほか1件')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: '「次回の打ち合わせ」を完了にする' }));
    expect(mocks.calls.updateTask).toEqual([{ organizationId: ORG_ID, id: 'b', done: true }]);
  });

  it('says so when nothing is due', () => {
    mocks.due = { today: '2026-10-16', canEdit: true, total: 0, items: [] };
    wrap(<DueTasksSection organizationId={ORG_ID} />);
    expect(screen.getByText('今日までの次の行動はありません')).toBeInTheDocument();
  });
});
