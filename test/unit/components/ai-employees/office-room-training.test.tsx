/**
 * The training room of the full-screen office (#1191): the staff and where each stands, the
 * boards on the keys 1 to 4, the onboarding started, approved or corrected with buttons only, a
 * promotion that asks once more, a running session moved on by the room, and nothing to change for
 * someone who does not manage the AI employees. Real next-intl messages; tRPC mocked.
 */
import { OfficeRoomTraining } from '@/components/features/ai-employees/office-room-training';
import type { RoomKeys } from '@/components/features/ai-employees/office-room-contract';
import { MESSAGE_FILES, mergeMessageFiles } from '@/lib/i18n/messages';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';

const mocks = vi.hoisted(() => ({
  data: null as unknown,
  calls: [] as { name: string; input: unknown }[],
  advance: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock('@/lib/trpc/client', () => {
  const mutation =
    (name: string) =>
    (options: { onSettled?: () => void } = {}) => ({
      isPending: false,
      mutate: (input: unknown, local: { onSuccess?: () => void; onSettled?: () => void } = {}) => {
        mocks.calls.push({ name, input });
        local.onSuccess?.();
        local.onSettled?.();
        options.onSettled?.();
      },
    });
  return {
    trpc: {
      useUtils: () => ({ aiEmployees: { training: { invalidate: mocks.invalidate } } }),
      aiEmployees: {
        training: {
          useQuery: () => ({
            isPending: false,
            isError: false,
            data: mocks.data,
            dataUpdatedAt: 1,
          }),
        },
        startOnboarding: { useMutation: mutation('startOnboarding') },
        answerOnboarding: { useMutation: mutation('answerOnboarding') },
        cancelSession: { useMutation: mutation('cancelSession') },
        startReview: { useMutation: mutation('startReview') },
        decideReview: { useMutation: mutation('decideReview') },
        setPolicy: { useMutation: mutation('setPolicy') },
        editNote: { useMutation: mutation('editNote') },
        advance: { useMutation: () => ({ mutateAsync: mocks.advance }) },
      },
    },
  };
});

const messages = mergeMessageFiles(MESSAGE_FILES.ja);

const REPORT = {
  introduction: 'AIマーケターです。よろしくお願いします。',
  role_summary: '見込み客を見極めて営業に渡します。',
  goals: ['評価の基準を社長と合わせる'],
  questions: ['重視する業種はありますか'],
};

type Employee = Record<string, unknown>;
const employee = (over: Employee = {}): Employee => ({
  id: '770e8400-e29b-41d4-a716-446655440001',
  role: 'marketer',
  name: 'AI 評価',
  status: 'active',
  level: 0,
  hiredAt: new Date('2026-11-01T00:00:00Z'),
  onboardedAt: null,
  levelChangedAt: null,
  policy: '',
  session: null,
  review: null,
  nextReviewAt: null,
  notes: [],
  ...over,
});

function renderRoom(employees: Employee[], options: { canManage?: boolean; agentEnabled?: boolean } = {}) {
  mocks.data = {
    agentEnabled: options.agentEnabled ?? true,
    canManage: options.canManage ?? true,
    employees,
  };
  const keysRef: { current: RoomKeys | null } = { current: null };
  const onBusyChange = vi.fn();
  const onFileOpenChange = vi.fn();
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <OfficeRoomTraining
        organizationId={ORG_ID}
        guide={null}
        keysRef={keysRef}
        onLeaveOffice={vi.fn()}
        onFileOpenChange={onFileOpenChange}
        onBusyChange={onBusyChange}
      />
    </NextIntlClientProvider>
  );
  const press = (key: string) =>
    act(() => {
      keysRef.current?.({ key, isComposing: false, keyCode: 0, preventDefault: () => undefined });
    });
  return { press, onFileOpenChange };
}

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.advance.mockReset();
  mocks.advance.mockResolvedValue({ state: 'waiting' });
});

describe('OfficeRoomTraining', () => {
  it('lists the staff with their grade and where they stand, and starts an onboarding with a button', async () => {
    const user = userEvent.setup();
    renderRoom([
      employee(),
      employee({ id: 'b', role: 'sales', name: 'AI 追客', level: 1, onboardedAt: '2026-11-10' }),
    ]);
    const staff = screen.getByRole('list', { name: '研修室の AI社員' });
    expect(within(staff).getByRole('button', { name: /AI 評価.*マーケター・研修中.*未着手/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(within(staff).getByRole('button', { name: /AI 追客.*Lv\.1 試用期間.*承認済み/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'オンボーディングを始める' }));
    expect(mocks.calls).toEqual([
      {
        name: 'startOnboarding',
        input: { organizationId: ORG_ID, employeeId: '770e8400-e29b-41d4-a716-446655440001', locale: 'ja' },
      },
    ]);
  });

  it('says the agents are being prepared while switched off, and offers nothing to start', () => {
    renderRoom([employee()], { agentEnabled: false });
    expect(screen.getAllByText(/いま準備中です/)[0]).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'オンボーディングを始める' })).not.toBeInTheDocument();
  });

  it('shows a report, approves it, or opens a field for a correction whose keys stay in the field', async () => {
    const user = userEvent.setup();
    const session = { id: 's1', kind: 'onboarding', status: 'waiting', report: REPORT, resultCode: null, steps: 3 };
    const { press, onFileOpenChange } = renderRoom([employee({ session })]);
    expect(screen.getByText(REPORT.role_summary)).toBeInTheDocument();
    expect(screen.getByText('重視する業種はありますか')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '訂正を伝える' }));
    expect(onFileOpenChange).toHaveBeenLastCalledWith(true);
    // A number typed into the field is not a key of the room: the board stays
    press('2');
    expect(screen.getByRole('heading', { name: '報告（オンボーディング）' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('訂正してほしいこと'), '目標は1つで');
    await user.click(screen.getByRole('button', { name: '訂正を送る' }));
    expect(mocks.calls.at(-1)).toEqual({
      name: 'answerOnboarding',
      input: { organizationId: ORG_ID, sessionId: 's1', answer: 'correct', correction: '目標は1つで' },
    });

    await user.click(screen.getByRole('button', { name: '承認する（試用期間へ）' }));
    expect(mocks.calls.at(-1)).toEqual({
      name: 'answerOnboarding',
      input: { organizationId: ORG_ID, sessionId: 's1', answer: 'approve' },
    });
  });

  it('moves between the employees with the arrows and between the boards with the numbers', () => {
    const { press } = renderRoom([
      employee({ notes: [{ path: '/memories/role.md', content: '見込み客を見極める', updatedAt: new Date() }] }),
      employee({ id: 'b', role: 'sales', name: 'AI 追客' }),
    ]);
    press('2');
    expect(screen.getByRole('heading', { name: '記憶ノート' })).toBeInTheDocument();
    expect(screen.getByText('/memories/role.md')).toBeInTheDocument();
    press('ArrowDown');
    expect(screen.getByText('AI 追客のノートはまだありません。')).toBeInTheDocument();
    press('4');
    expect(screen.getByRole('heading', { name: '社長の方針' })).toBeInTheDocument();
  });

  it('asks once more before a promotion, from the level the facts were counted at', async () => {
    const user = userEvent.setup();
    const review = {
      id: 'r1',
      sessionId: 's2',
      periodStart: '2026-10-01',
      periodEnd: '2026-11-01',
      facts: {
        daysEmployed: 90,
        daysAtLevel: 40,
        runs: 30,
        succeededRuns: 30,
        failedRuns: 0,
        processed: 100,
        failureRate: 0,
        proposals: { answered: 30, approved: 30 },
      },
      recommendation: 'promote',
      levelBefore: 1,
      levelAfter: null,
      status: 'open',
      decidedAt: null,
      createdAt: '2026-11-01',
    };
    const session = {
      id: 's2',
      kind: 'review',
      status: 'waiting',
      report: { self_review: '基準に届きました。', next_goals: ['提案の質を上げる'] },
      resultCode: null,
      steps: 2,
    };
    const { press } = renderRoom([
      employee({ level: 1, onboardedAt: '2026-08-01', review, session, nextReviewAt: '2026-12-01' }),
    ]);
    press('3');
    expect(screen.getByText('昇格の基準に届いています')).toBeInTheDocument();
    expect(screen.getByText('基準に届きました。')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '昇格を承認する' }));
    expect(mocks.calls).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Lv.2 一人前に上げる（確定）' }));
    expect(mocks.calls).toEqual([
      {
        name: 'decideReview',
        input: { organizationId: ORG_ID, reviewId: 'r1', decision: 'promote', fromLevel: 1 },
      },
    ]);
  });

  it('never raises the grade by pressing the same button twice: the confirmation opens on the way back', async () => {
    const user = userEvent.setup();
    const review = {
      id: 'r2',
      sessionId: null,
      periodStart: '2026-10-01',
      periodEnd: '2026-11-01',
      facts: {
        daysEmployed: 90,
        daysAtLevel: 40,
        runs: 30,
        succeededRuns: 30,
        failedRuns: 0,
        processed: 100,
        failureRate: 0,
        proposals: { answered: 30, approved: 30 },
      },
      recommendation: 'promote',
      levelBefore: 1,
      levelAfter: null,
      status: 'open',
      decidedAt: null,
      createdAt: '2026-11-01',
    };
    const { press } = renderRoom([employee({ level: 1, onboardedAt: '2026-08-01', review })]);
    press('3');
    screen.getByRole('button', { name: '昇格を承認する' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'やめる' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(mocks.calls).toEqual([]);
    expect(screen.getByRole('button', { name: '昇格を承認する' })).toBeInTheDocument();
  });

  it('stops asking for steps once the agents are switched off or the employee was paused', async () => {
    mocks.advance.mockResolvedValue({ state: 'disabled' });
    const running = {
      session: { id: 's5', kind: 'onboarding', status: 'running', report: null, resultCode: null, steps: 1 },
    };
    renderRoom([employee(running)]);
    await waitFor(() => expect(mocks.advance).toHaveBeenCalledTimes(1));
    // The room reads its records again once, and asks no more
    await waitFor(() => expect(mocks.invalidate).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mocks.advance).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '続ける' })).toBeInTheDocument();
  });

  it('asks nothing while switched off, nor for a paused employee', async () => {
    const running = {
      session: { id: 's6', kind: 'onboarding', status: 'running', report: null, resultCode: null, steps: 1 },
    };
    renderRoom([employee(running)], { agentEnabled: false });
    renderRoom([employee({ ...running, status: 'paused' })]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mocks.advance).not.toHaveBeenCalled();
  });

  it('moves a running session on by itself while the room is open', async () => {
    renderRoom([
      employee({
        session: { id: 's3', kind: 'onboarding', status: 'running', report: null, resultCode: null, steps: 1 },
      }),
    ]);
    await waitFor(() =>
      expect(mocks.advance).toHaveBeenCalledWith({ organizationId: ORG_ID, sessionId: 's3' })
    );
    expect(screen.getByText(/ノートを書いています（1 段目）/)).toBeInTheDocument();
  });

  it('gives someone who does not manage the AI employees nothing to change, and no notes', () => {
    const { press } = renderRoom(
      [
        employee({
          session: { id: 's4', kind: 'onboarding', status: 'running', report: null, resultCode: null, steps: 1 },
        }),
      ],
      { canManage: false }
    );
    expect(screen.queryByRole('button', { name: 'オンボーディングを始める' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '止める' })).not.toBeInTheDocument();
    expect(mocks.advance).not.toHaveBeenCalled();
    press('2');
    expect(screen.getByText('ノートは、AI社員を管理できる人だけが読めます。')).toBeInTheDocument();
  });
});
