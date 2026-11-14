/**
 * The AI office (#1101): the figures over the virtual office, a name tag per role over its robot
 * (or its empty chair) named by its visible text with the place for screen readers, the details of
 * a desk with the focus on its title, and who sees the hiring and managing actions (real next-intl
 * messages; tRPC mocked)
 */
import { OfficeScreen } from '@/components/features/ai-employees/office-screen';
import { DEFAULT_AI_EMPLOYEE_PROFILE } from '@/lib/features/ai-employees/types/profile';
import { MESSAGE_FILES, mergeMessageFiles } from '@/lib/i18n/messages';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const EMPLOYEE_ID = '770e8400-e29b-41d4-a716-446655440001';

const mocks = vi.hoisted(() => ({
  office: { data: undefined as unknown, error: null as unknown, isLoading: false, dataUpdatedAt: 0 },
  runs: { data: [] as unknown[], error: null as unknown, isLoading: false },
  hires: [] as unknown[],
  updates: [] as unknown[],
  dismissals: [] as unknown[],
  toast: { success: vi.fn(), error: vi.fn() },
}));

function mutation(target: unknown[]) {
  return (options: { onSuccess?: (data: unknown, input: unknown) => void } = {}) => ({
    isPending: false,
    mutate: (input: unknown) => {
      target.push(input);
      options.onSuccess?.({ id: EMPLOYEE_ID, name: 'AIバックオフィス' }, input);
    },
  });
}

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      aiEmployees: { office: { invalidate: vi.fn() }, runs: { invalidate: vi.fn() } },
    }),
    aiEmployees: {
      office: { useQuery: () => mocks.office },
      runs: { useQuery: () => mocks.runs },
      hire: { useMutation: mutation(mocks.hires) },
      update: { useMutation: mutation(mocks.updates) },
      dismiss: { useMutation: mutation(mocks.dismissals) },
    },
  },
}));
vi.mock('@/hooks/use-organization', () => ({
  useOrganization: () => ({ organizationId: ORG_ID }),
}));
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/lib/auth/client', () => ({
  authClient: { useSession: () => ({ data: { user: { name: '山田 太郎' } } }) },
}));

const messages = mergeMessageFiles(MESSAGE_FILES.ja);

function renderScreen() {
  return render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <OfficeScreen />
    </NextIntlClientProvider>
  );
}

const timingWatcher = {
  id: EMPLOYEE_ID,
  role: 'back_office',
  name: 'AIバックオフィス',
  status: 'active',
  createdAt: new Date('2026-11-01T00:00:00Z'),
  deskStatus: 'attention',
  lastRun: {
    id: 'run-1',
    trigger: 'schedule',
    status: 'failed',
    startedAt: new Date('2026-11-12T00:00:00Z'),
    finishedAt: new Date('2026-11-12T00:00:10Z'),
    processedCount: 3,
    resultCode: 'timeout',
  },
  processedToday: 5,
  profile: DEFAULT_AI_EMPLOYEE_PROFILE,
};

describe('OfficeScreen', () => {
  beforeEach(() => {
    mocks.office = {
      data: { employees: [timingWatcher], canManage: true },
      error: null,
      isLoading: false,
      dataUpdatedAt: Date.now(),
    };
    mocks.runs = { data: [timingWatcher.lastRun], error: null, isLoading: false };
    mocks.hires.length = 0;
    mocks.updates.length = 0;
    mocks.dismissals.length = 0;
  });

  it('puts a name tag over each robot and empty chair on the floor map', () => {
    renderScreen();
    const floor = screen.getByRole('region', { name: 'オフィスのフロア' });
    // The drawing is decoration only
    expect(floor.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    // The tag is named by what it shows, then the role, the place and today's work
    const tag = within(floor).getByRole('button', { name: /^AIバックオフィス/ });
    expect(tag).toHaveAccessibleName(/要確認.*バックオフィス・総務・受付にいます・今日 5件.*詳細を開く/);
    expect(
      within(floor).getByRole('button', { name: /^空席 セールス 採用する.*営業フロアの空席/ })
    ).toBeInTheDocument();
    expect(within(floor).getByRole('button', { name: /^空席 マーケター/ })).toBeInTheDocument();
  });

  it('shows where an idle, training or paused robot went', () => {
    for (const [deskStatus, place] of [
      ['idle', 'ラウンジ'],
      ['training', '研修室'],
      ['paused', '充電ステーション'],
    ] as const) {
      mocks.office = {
        ...mocks.office,
        data: { employees: [{ ...timingWatcher, deskStatus }], canManage: true },
      };
      const { unmount } = renderScreen();
      expect(screen.getByRole('button', { name: /^AIバックオフィス/ })).toHaveAccessibleName(
        new RegExp(`${place}にいます`)
      );
      unmount();
    }
  });

  it('sums up the office over the floor', () => {
    renderScreen();
    expect(screen.getByText('在籍').nextElementSibling).toHaveTextContent('1人');
    expect(screen.getByText('今日の処理件数').nextElementSibling).toHaveTextContent('5件');
    // The status of the desk says 要確認 too: take the figure's label (a <p>)
    const attention = screen.getAllByText('要確認').find((node) => node.tagName === 'P');
    expect(attention?.nextElementSibling).toHaveTextContent('1人');
    // What needs a look comes first
    const labels = screen
      .getByRole('region', { name: '今日のまとめ' })
      .querySelectorAll('p.text-sm');
    expect(Array.from(labels, (node) => node.textContent)).toEqual([
      '要確認',
      '作業中',
      '今日の処理件数',
      '在籍',
    ]);
  });

  it('opens a desk with the focus on its title, its work log, and lets an admin pause it', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole('button', { name: /^AIバックオフィス/ }));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByRole('heading', { name: 'AIバックオフィス' })).toHaveFocus();
    expect(within(sheet).getByRole('heading', { name: '作業記録' })).toBeInTheDocument();
    expect(within(sheet).getByText('timeout')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: '休止する' }));
    expect(mocks.updates).toEqual([
      { organizationId: ORG_ID, employeeId: EMPLOYEE_ID, status: 'paused' },
    ]);
  });

  it('asks before dismissing, in a red button of its own', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole('button', { name: /^AIバックオフィス/ }));
    const sheet = screen.getByRole('dialog');
    await user.click(within(sheet).getByRole('button', { name: '解雇する' }));
    expect(mocks.dismissals).toEqual([]);
    const confirm = screen.getByRole('alertdialog');
    expect(within(confirm).getByRole('button', { name: 'キャンセル' })).toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: '解雇する' }));
    expect(mocks.dismissals).toEqual([{ organizationId: ORG_ID, employeeId: EMPLOYEE_ID }]);
  });

  it('hires from a vacant desk with the default name', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole('button', { name: /^空席 マーケター/ }));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByLabelText('表示名')).toHaveValue('AIマーケター');
    await user.click(within(sheet).getByRole('button', { name: '採用する' }));
    expect(mocks.hires).toEqual([{ organizationId: ORG_ID, role: 'marketer', name: 'AIマーケター' }]);
  });

  it('shows no actions to someone who cannot manage', async () => {
    mocks.office = {
      ...mocks.office,
      data: { employees: [timingWatcher], canManage: false },
    };
    const user = userEvent.setup();
    renderScreen();
    expect(screen.getByRole('button', { name: /^空席 マーケター 管理者が採用できます/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^空席 マーケター/ }));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).queryByRole('button', { name: '採用する' })).not.toBeInTheDocument();
    expect(within(sheet).getByText('AI社員の採用と管理は、管理者だけができます。')).toBeInTheDocument();
  });

  it('enters the full-screen office from the header and comes back to the button', async () => {
    const user = userEvent.setup();
    renderScreen();
    const enter = screen.getByRole('button', { name: '出社する（全画面）' });
    await user.click(enter);
    const office = screen.getByRole('dialog', { name: 'AI社員オフィス（全画面）' });
    expect(within(office).getByText(/社長 山田 太郎/)).toBeInTheDocument();
    await user.click(within(office).getByRole('button', { name: /^通常の表示に戻る/ }));
    expect(screen.queryByRole('dialog', { name: 'AI社員オフィス（全画面）' })).not.toBeInTheDocument();
  });

  describe('opened as the app', () => {
    const width = window.innerWidth;
    const openAt = (value: number) => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value });
      window.history.replaceState(null, '', '/ja/office?source=app');
      renderScreen();
    };
    afterEach(() => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
      window.history.replaceState(null, '', '/');
    });

    it('starts in the full-screen office on a wide screen', async () => {
      openAt(1440);
      expect(
        await screen.findByRole('dialog', { name: 'AI社員オフィス（全画面）' })
      ).toBeInTheDocument();
    });

    it('stays in the normal view on a narrow screen, with the way in still there (#1139)', async () => {
      openAt(390);
      expect(await screen.findByRole('button', { name: '出社する（全画面）' })).toBeInTheDocument();
      expect(
        screen.queryByRole('dialog', { name: 'AI社員オフィス（全画面）' })
      ).not.toBeInTheDocument();
    });
  });

  it('tells a viewer without permission instead of drawing the floor', () => {
    mocks.office = {
      data: undefined,
      error: { data: { code: 'FORBIDDEN' } },
      isLoading: false,
      dataUpdatedAt: 0,
    };
    renderScreen();
    expect(screen.getByText('AI社員オフィスを見る権限がありません。')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'オフィスのフロア' })).not.toBeInTheDocument();
  });
});
