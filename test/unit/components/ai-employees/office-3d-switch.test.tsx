/**
 * The switch to the 3D floor of the full-screen office (#1135, spike): its own key, the 2D floor
 * kept until the 3D one drew, and the way back to 2D when it cannot be shown. The 3D canvas
 * itself is mocked: three.js is never loaded here.
 */
import { OfficeImmersive } from '@/components/features/ai-employees/office-immersive';
import { DEFAULT_AI_EMPLOYEE_PROFILE } from '@/lib/features/ai-employees/types/profile';
import { MESSAGE_FILES, mergeMessageFiles } from '@/lib/i18n/messages';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  breaks: false,
  draws: true,
  statuses: [] as string[],
}));

vi.mock('@/components/features/ai-employees/office-3d/office-canvas-3d', () => ({
  default: function Canvas3DStub({
    employees,
    onReady,
  }: {
    employees: readonly { status: string }[];
    onReady?: () => void;
  }) {
    if (mocks.breaks) throw new Error('no WebGL context');
    mocks.statuses = employees.map((employee) => employee.status);
    useEffect(() => {
      if (mocks.draws) onReady?.();
    }, [onReady]);
    return <div data-testid="floor-3d" />;
  },
}));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({ aiEmployees: { office: { invalidate: vi.fn() } } }),
    aiEmployees: {
      hire: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
      update: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
    },
  },
}));

const messages = mergeMessageFiles(MESSAGE_FILES.ja);

const sales = {
  id: '770e8400-e29b-41d4-a716-446655440001',
  role: 'sales' as const,
  name: 'AIセールス',
  status: 'active' as const,
  createdAt: new Date('2026-11-01T00:00:00Z'),
  deskStatus: 'training' as const,
  lastRun: null,
  processedToday: 0,
  profile: DEFAULT_AI_EMPLOYEE_PROFILE,
};

async function enterOffice() {
  const user = userEvent.setup();
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <OfficeImmersive
        organizationId="660e8400-e29b-41d4-a716-446655440000"
        companyName="テスト商事"
        presidentName="山田 太郎"
        employees={[sales]}
        canManage
        onExit={vi.fn()}
      />
    </NextIntlClientProvider>
  );
  const office = screen.getByRole('dialog', { name: 'AI社員オフィス（全画面）' });
  await user.click(within(office).getByRole('button', { name: /^出社する/ }));
  const staff = within(office).getByRole('heading', { name: '社員名簿' }).parentElement as HTMLElement;
  await user.click(within(staff).getByRole('button', { name: /AIセールス/ }));
  return { user, office };
}

describe('the switch to the 3D floor', () => {
  beforeEach(() => {
    mocks.breaks = false;
    mocks.draws = true;
    mocks.statuses = [];
  });

  it('is on V, not on a number: the numbers belong to the rooms', async () => {
    const { user, office } = await enterOffice();
    expect(within(office).getByRole('button', { name: /3D（検証）/ })).toHaveTextContent('V');
    await user.keyboard('3');
    expect(screen.queryByTestId('floor-3d')).not.toBeInTheDocument();
    await user.keyboard('v');
    expect(await screen.findByTestId('floor-3d')).toBeInTheDocument();
    expect(await within(office).findByText('3D の検証')).toBeInTheDocument();
    await user.keyboard('V');
    expect(screen.queryByTestId('floor-3d')).not.toBeInTheDocument();
    expect(within(office).queryByText('3D の検証')).not.toBeInTheDocument();
  });

  it('keeps the 2D floor and says that it loads until the 3D floor drew its first frame', async () => {
    mocks.draws = false;
    const { user, office } = await enterOffice();
    await user.keyboard('v');
    expect(await screen.findByTestId('floor-3d')).toBeInTheDocument();
    expect(within(office).getByText('3D のフロアを読み込んでいます。')).toBeInTheDocument();
    // No trial panel over a floor that is not there yet
    expect(within(office).queryByText('3D の検証')).not.toBeInTheDocument();
  });

  it('goes back to the 2D floor and says so when the 3D floor cannot be shown', async () => {
    mocks.breaks = true;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { user, office } = await enterOffice();
    await user.keyboard('v');
    expect(
      await within(office).findByText('3D のフロアを表示できませんでした。2D の表示に戻しました。')
    ).toBeInTheDocument();
    expect(screen.queryByTestId('floor-3d')).not.toBeInTheDocument();
    expect(within(office).getByRole('button', { name: /3D（検証）/ })).toBeInTheDocument();
    // The office is still there, and its keys still work
    await user.keyboard('c');
    expect(
      within(office).getByRole('region', { name: 'AIセールスのカスタマイズ' })
    ).toBeInTheDocument();
    errors.mockRestore();
  });

  it('forgets what the trial panel pretended when the trial ends', async () => {
    const { user, office } = await enterOffice();
    await user.keyboard('v');
    await within(office).findByText('3D の検証');
    expect(mocks.statuses).toEqual(['training']);
    await user.click(within(office).getByRole('button', { name: '作業中' }));
    expect(mocks.statuses).toEqual(['working']);
    await user.keyboard('v');
    await user.keyboard('v');
    await within(office).findByText('3D の検証');
    expect(mocks.statuses).toEqual(['training']);
  });
});
