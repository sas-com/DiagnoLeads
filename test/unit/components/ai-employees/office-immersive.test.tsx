/**
 * The full-screen office (#1109): the title, entering as the president, the staff and the
 * president's tasks from the real state, a conversation that hires or pauses an AI employee, and
 * the keys (Esc steps back, E talks, the numbers answer). Real next-intl messages; tRPC mocked.
 */
import { OfficeImmersive } from '@/components/features/ai-employees/office-immersive';
import { MESSAGE_FILES, mergeMessageFiles } from '@/lib/i18n/messages';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const EMPLOYEE_ID = '770e8400-e29b-41d4-a716-446655440001';

const mocks = vi.hoisted(() => ({
  hires: [] as unknown[],
  updates: [] as unknown[],
  invalidate: vi.fn(),
}));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({ aiEmployees: { office: { invalidate: mocks.invalidate } } }),
    aiEmployees: {
      hire: {
        useMutation: (options: { onSuccess?: (data: unknown, input: unknown) => void } = {}) => ({
          isPending: false,
          mutate: (input: unknown) => {
            mocks.hires.push(input);
            options.onSuccess?.({ id: 'new' }, input);
          },
        }),
      },
      update: {
        useMutation: (options: { onSuccess?: (data: unknown, input: unknown) => void } = {}) => ({
          isPending: false,
          mutate: (input: unknown) => {
            mocks.updates.push(input);
            options.onSuccess?.({ id: EMPLOYEE_ID, name: 'AIセールス' }, input);
          },
        }),
      },
    },
  },
}));

const messages = mergeMessageFiles(MESSAGE_FILES.ja);

const sales = {
  id: EMPLOYEE_ID,
  role: 'sales' as const,
  name: 'AIセールス',
  status: 'active' as const,
  createdAt: new Date('2026-11-01T00:00:00Z'),
  deskStatus: 'training' as const,
  lastRun: null,
  processedToday: 0,
};

function renderOffice(
  props: { canManage?: boolean; onExit?: () => void; employees?: (typeof sales)[] } = {}
) {
  const onExit = props.onExit ?? vi.fn();
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <OfficeImmersive
        organizationId={ORG_ID}
        companyName="テスト商事"
        presidentName="山田 太郎"
        employees={props.employees ?? [sales]}
        canManage={props.canManage ?? true}
        onExit={onExit}
      />
    </NextIntlClientProvider>
  );
  return { onExit, office: screen.getByRole('dialog', { name: 'AI社員オフィス（全画面）' }) };
}

describe('OfficeImmersive', () => {
  beforeEach(() => {
    mocks.hires.length = 0;
    mocks.updates.length = 0;
    mocks.invalidate.mockClear();
  });

  it('opens on the title with the president and the staff, the focus on clocking in', () => {
    const { office } = renderOffice();
    expect(within(office).getByRole('heading', { name: 'AI OFFICE' })).toBeInTheDocument();
    expect(
      within(office).getByText(/あなたは社長。優秀な AI社員とともに、新しい価値を生み出す。/)
    ).toBeInTheDocument();
    expect(within(office).getByText(/社長 山田 太郎.*AI社員 1名（空席 3）/)).toBeInTheDocument();
    expect(within(office).getByRole('button', { name: /^出社する/ })).toHaveFocus();
  });

  it('shows the staff and the president’s tasks once in the office', async () => {
    const user = userEvent.setup();
    const { office } = renderOffice();
    await user.click(within(office).getByRole('button', { name: /^出社する/ }));

    expect(within(office).getByText('山田 太郎')).toBeInTheDocument();
    expect(within(office).getByText('テスト商事')).toBeInTheDocument();
    const staff = within(office).getByRole('heading', { name: '社員名簿' }).parentElement as HTMLElement;
    expect(within(staff).getAllByRole('button')).toHaveLength(4);
    expect(within(staff).getByRole('button', { name: /AIセールス.*研修中.*商談にする/ })).toBeInTheDocument();
    // Three departments have nobody: the president is asked to hire, the marketer first
    const tasks = within(office).getByRole('heading', { name: '社長の仕事' }).parentElement as HTMLElement;
    expect(within(tasks).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'マーケターを採用するこの部門に社員がいません',
      'エンジニアを採用するこの部門に社員がいません',
      'バックオフィスを採用するこの部門に社員がいません',
    ]);
    // The drawing is decoration only
    expect(office.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('hires from a conversation with a vacant desk', async () => {
    const user = userEvent.setup();
    const { office } = renderOffice();
    await user.click(within(office).getByRole('button', { name: /^出社する/ }));
    await user.click(within(office).getByRole('button', { name: /^マーケターを採用する/ }));

    expect(within(office).getByText(/ここはマーケターの席です。まだ誰もいません。/)).toBeInTheDocument();
    const hire = within(office).getByRole('button', { name: /採用する$/ });
    expect(hire).toHaveFocus();
    await user.click(hire);
    expect(mocks.hires).toEqual([{ organizationId: ORG_ID, role: 'marketer', name: 'AIマーケター' }]);
    expect(within(office).getByText(/AIマーケターです。よろしくお願いします、社長。/)).toBeInTheDocument();
    expect(mocks.invalidate).toHaveBeenCalledWith({ organizationId: ORG_ID });
  });

  it('talks to the chosen AI employee with E and answers with the number keys', async () => {
    const user = userEvent.setup();
    const { office } = renderOffice();
    await user.click(within(office).getByRole('button', { name: /^出社する/ }));
    await user.click(within(office).getByRole('button', { name: /AIセールス.*研修中.*商談にする/ }));
    await user.keyboard('e');

    expect(within(office).getByText('AIセールスと会話中')).toBeInTheDocument();
    expect(within(office).getByText(/社長、いまは研修中です。/)).toBeInTheDocument();
    await user.keyboard('1');
    expect(mocks.updates).toEqual([
      { organizationId: ORG_ID, employeeId: EMPLOYEE_ID, status: 'paused' },
    ]);
    expect(within(office).getByText('承知しました、社長。AIセールスはしばらく休みます。')).toBeInTheDocument();
  });

  it('puts a paused AI employee back to work from the president’s first task', async () => {
    const user = userEvent.setup();
    const paused = { ...sales, status: 'paused' as const, deskStatus: 'paused' as const };
    const { office } = renderOffice({ employees: [paused as unknown as typeof sales] });
    await user.click(within(office).getByRole('button', { name: /^出社する/ }));
    // The paused employee is the president's first task, and the one in front of the president
    await user.click(within(office).getByRole('button', { name: /セールスを仕事に戻す/ }));

    expect(within(office).getByText(/社長、いまは休止中です。/)).toBeInTheDocument();
    await user.keyboard('1');
    expect(mocks.updates).toEqual([
      { organizationId: ORG_ID, employeeId: EMPLOYEE_ID, status: 'active' },
    ]);
    expect(within(office).getByText('AIセールス、仕事に戻ります。')).toBeInTheDocument();
  });

  it('lets someone who cannot manage look and talk, but not hire or pause', async () => {
    const user = userEvent.setup();
    const { office } = renderOffice({ canManage: false });
    await user.click(within(office).getByRole('button', { name: /^出社する/ }));
    expect(within(office).getByText('急ぎの仕事はありません。社員は持ち場についています。')).toBeInTheDocument();
    await user.keyboard('e');
    expect(within(office).getByText('AI社員の採用と管理は、管理者だけができます。')).toBeInTheDocument();
    expect(within(office).queryByRole('button', { name: /今日は休んでいい/ })).not.toBeInTheDocument();
    await user.click(within(office).getByRole('button', { name: /またあとで/ }));
    expect(within(office).getByRole('heading', { name: '社員名簿' })).toBeInTheDocument();
    expect(mocks.updates).toEqual([]);
  });

  it('steps back with Esc: conversation, office, title, out', async () => {
    const user = userEvent.setup();
    const { office, onExit } = renderOffice();
    await user.click(within(office).getByRole('button', { name: /^出社する/ }));
    await user.keyboard('e');
    expect(within(office).getByText(/と会話中/)).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(within(office).getByRole('heading', { name: '社員名簿' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(within(office).getByRole('heading', { name: 'AI OFFICE' })).toBeInTheDocument();
    expect(onExit).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
