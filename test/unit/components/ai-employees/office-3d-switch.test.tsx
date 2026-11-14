/**
 * The switch to the 3D floor of the full-screen office (#1135, spike): its own key, the 2D floor
 * kept until the 3D one drew, and the way back to 2D when it cannot be shown. A production build
 * offers the switch and the frame rate but not the trial panel (#1157). The 3D canvas itself is
 * mocked: three.js is never loaded here.
 */
import { OfficeImmersive } from '@/components/features/ai-employees/office-immersive';
import { DEFAULT_AI_EMPLOYEE_PROFILE } from '@/lib/features/ai-employees/types/profile';
import { MESSAGE_FILES, mergeMessageFiles } from '@/lib/i18n/messages';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  trial: true,
  breaks: false,
  draws: true,
  statuses: [] as string[],
  vacant: [] as string[],
  walks: null as null | ((role: string, walking: boolean) => void),
}));

vi.mock('@/components/features/ai-employees/office-3d/office-canvas-3d', () => ({
  default: function Canvas3DStub({
    employees,
    vacant,
    onFps,
    onReady,
    onView,
    onWalking,
  }: {
    employees: readonly { status: string }[];
    vacant?: readonly string[];
    onFps?: (fps: number) => void;
    onReady?: () => void;
    onView?: (view: unknown, places: unknown) => void;
    onWalking?: (role: string, walking: boolean) => void;
  }) {
    if (mocks.breaks) throw new Error('no WebGL context');
    mocks.statuses = employees.map((employee) => employee.status);
    mocks.vacant = [...(vacant ?? [])];
    mocks.walks = onWalking ?? null;
    useEffect(() => {
      if (!mocks.draws) return;
      onReady?.();
      onFps?.(42);
      // A frame: the real canvas tells where the camera looks, and the tags are placed
      const frame = window.setTimeout(() =>
        onView?.(
          {
            target: { x: 12, y: 8 },
            pxPerUnit: 40,
            pan: { x: 0, y: 0 },
            size: { w: 1440, h: 900 },
          },
          {}
        )
      );
      return () => window.clearTimeout(frame);
    }, [onFps, onReady, onView]);
    return <div data-testid="floor-3d" />;
  },
}));

// The development-only trial, switched off to see what a production build offers
vi.mock(
  '@/components/features/ai-employees/office-3d/office-3d-trial',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('@/components/features/ai-employees/office-3d/office-3d-trial')
      >();
    return {
      ...actual,
      get OFFICE_3D_TRIAL() {
        return mocks.trial;
      },
    };
  }
);

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
    mocks.trial = true;
    mocks.breaks = false;
    mocks.draws = true;
    mocks.statuses = [];
  });

  it('is on V, not on a number: the numbers belong to the rooms', async () => {
    const { user, office } = await enterOffice();
    expect(within(office).getByRole('button', { name: /3D（試験中）/ })).toHaveTextContent('V');
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
    expect(within(office).getByRole('button', { name: /3D（試験中）/ })).toBeInTheDocument();
    // The office is still there, and its keys still work
    await user.keyboard('c');
    expect(
      within(office).getByRole('region', { name: 'AIセールスのカスタマイズ' })
    ).toBeInTheDocument();
    errors.mockRestore();
  });

  it('keeps the name tags pressable on the 3D floor, for hired employees and vacant seats (#1147)', async () => {
    const { user, office } = await enterOffice();
    await user.keyboard('v');
    await within(office).findByText('3D の検証');
    expect(mocks.vacant).toEqual(['marketer', 'engineer', 'back_office']);
    // Two of each: the 2D tag (hidden with its floor) and the 3D tag. The 3D ones are placed
    const tag = async (name: RegExp) => {
      const tags = await within(office).findAllByRole('button', { name, hidden: true });
      const placed = tags.find((button) => button.style.visibility === 'visible');
      if (!placed) throw new Error(`no placed tag for ${name}`);
      return placed;
    };
    await vi.waitFor(async () => expect(await tag(/マーケター 空席/)).toBeTruthy());
    await user.click(await tag(/マーケター 空席/));
    expect(
      within(within(office).getByRole('heading', { name: '目の前の社員' }).parentElement as HTMLElement)
        .getByText('マーケター')
    ).toBeInTheDocument();
    // A second press on the chosen one talks to it
    await user.click(await tag(/マーケター 空席/));
    expect(within(office).getByText('社長（あなた）')).toBeInTheDocument();
  });

  it('says in the staff list where an employee is, and that it is on its way while it walks (#1147)', async () => {
    const { user, office } = await enterOffice();
    const staff = within(office).getByRole('heading', { name: '社員名簿' })
      .parentElement as HTMLElement;
    // The room is named on the 2D floor too
    expect(within(staff).getByText('研修室')).toBeInTheDocument();
    await user.keyboard('v');
    await within(office).findByText('3D の検証');
    act(() => mocks.walks?.('sales', true));
    expect(within(staff).getByText('研修室へ移動中')).toBeInTheDocument();
    act(() => mocks.walks?.('sales', false));
    expect(within(staff).getByText('研修室')).toBeInTheDocument();
    expect(within(staff).queryByText(/移動中/)).not.toBeInTheDocument();
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

describe('the switch to the 3D floor in a production build (#1157)', () => {
  beforeEach(() => {
    mocks.trial = false;
    mocks.breaks = false;
    mocks.draws = true;
    mocks.statuses = [];
  });

  it('starts in 2D, switches to 3D and back, and shows how fast the device draws', async () => {
    const { user, office } = await enterOffice();
    expect(screen.queryByTestId('floor-3d')).not.toBeInTheDocument();
    await user.click(within(office).getByRole('button', { name: /3D（試験中）/ }));
    expect(await screen.findByTestId('floor-3d')).toBeInTheDocument();
    expect(await within(office).findByText('毎秒 42 コマ')).toBeInTheDocument();
    await user.click(within(office).getByRole('button', { name: /2D に戻す/ }));
    expect(screen.queryByTestId('floor-3d')).not.toBeInTheDocument();
    expect(within(office).queryByText('毎秒 42 コマ')).not.toBeInTheDocument();
    // The key works too
    await user.keyboard('v');
    expect(await screen.findByTestId('floor-3d')).toBeInTheDocument();
  });

  it('never shows the trial panel that pretends statuses', async () => {
    const { user, office } = await enterOffice();
    await user.keyboard('v');
    await within(office).findByText('毎秒 42 コマ');
    expect(within(office).queryByText('3D の検証')).not.toBeInTheDocument();
    expect(within(office).queryByRole('button', { name: '作業中' })).not.toBeInTheDocument();
  });

  it('says that the 3D floor loads, and goes back to 2D when it cannot be shown', async () => {
    mocks.draws = false;
    const { user, office } = await enterOffice();
    await user.keyboard('v');
    expect(await within(office).findByText('3D のフロアを読み込んでいます。')).toBeInTheDocument();
    await user.keyboard('v');
    mocks.breaks = true;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await user.keyboard('v');
    expect(
      await within(office).findByText('3D のフロアを表示できませんでした。2D の表示に戻しました。')
    ).toBeInTheDocument();
    errors.mockRestore();
  });
});
