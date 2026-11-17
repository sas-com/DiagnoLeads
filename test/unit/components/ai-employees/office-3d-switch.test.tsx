/**
 * The switch to the 3D floor of the full-screen office (#1135, spike): its own key, the 2D floor
 * kept until the 3D one drew, and the way back to 2D when it cannot be shown. A production build
 * offers the switch and the frame rate but not the trial panel (#1157). Which floor the office
 * starts with, what the device remembers and the way back from a slow device are at the end
 * (#1150). The 3D canvas itself is mocked: three.js is never loaded here.
 */
import { OfficeImmersive } from '@/components/features/ai-employees/office-immersive';
import { DESK_SEATS, spotOf } from '@/components/features/ai-employees/office-map-layout';
import { DEFAULT_AI_EMPLOYEE_PROFILE } from '@/lib/features/ai-employees/types/profile';
import { MESSAGE_FILES, mergeMessageFiles } from '@/lib/i18n/messages';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  trial: true,
  breaks: false,
  draws: true,
  // What the canvas reports, a report a second, and what the office starts with (#1150)
  fps: [42] as number[],
  preferred: '2d' as '2d' | '3d',
  statuses: [] as string[],
  looks: [] as unknown[],
  opening: undefined as undefined | null | { x: number; y: number; w: number; h: number },
  vacant: [] as string[],
  walks: null as null | ((role: string, walking: boolean) => void),
  // How often the canvas rendered, and what it was given to report the frame rate (#1270)
  canvasRenders: 0,
  reportFps: null as null | ((fps: number) => void),
  reporters: new Set<unknown>(),
  scene: null as null | {
    stage?: string;
    subject?: { x: number; y: number } | null;
    attentive?: string | null;
    events: Record<string, string | undefined>;
  },
}));

vi.mock('@/components/features/ai-employees/office-3d/office-canvas-3d', () => ({
  default: function Canvas3DStub({
    employees,
    vacant,
    stage,
    subject,
    opening,
    attentive,
    events,
    onFps,
    onReady,
    onView,
    onWalking,
  }: {
    employees: readonly { status: string; look: unknown }[];
    opening?: null | { x: number; y: number; w: number; h: number };
    vacant?: readonly string[];
    stage?: string;
    subject?: { x: number; y: number } | null;
    attentive?: string | null;
    events: Record<string, string | undefined>;
    onFps?: (fps: number) => void;
    onReady?: () => void;
    onView?: (view: unknown, places: unknown) => void;
    onWalking?: (role: string, walking: boolean) => void;
  }) {
    if (mocks.breaks) throw new Error('no WebGL context');
    mocks.statuses = employees.map((employee) => employee.status);
    mocks.looks = employees.map((employee) => employee.look);
    mocks.opening = opening;
    mocks.vacant = [...(vacant ?? [])];
    mocks.walks = onWalking ?? null;
    mocks.canvasRenders += 1;
    mocks.reportFps = onFps ?? null;
    mocks.reporters.add(onFps);
    mocks.scene = { stage, subject, attentive, events };
    useEffect(() => {
      if (!mocks.draws) return;
      onReady?.();
      for (const fps of mocks.fps) onFps?.(fps);
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

// The floor the office starts with, set by each test: the unit tests never load three.js
vi.mock(
  '@/components/features/ai-employees/office-3d/office-display',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('@/components/features/ai-employees/office-3d/office-display')
      >();
    return {
      ...actual,
      get DEFAULT_DISPLAY() {
        return mocks.preferred;
      },
    };
  }
);

// What is on the board of a room is tested with the room; here the room only has to open
vi.mock('@/components/features/ai-employees/office-room-leads', () => ({
  OfficeRoomLeads: () => <div data-testid="room-leads" />,
}));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({ aiEmployees: { office: { invalidate: vi.fn() } } }),
    aiEmployees: {
      // Orders are carried out at once: what the office does after the answer of the server
      hire: {
        useMutation: (options: { onSuccess?: (data: unknown, input: unknown) => void } = {}) => ({
          isPending: false,
          mutate: (input: unknown) => options.onSuccess?.({ id: 'new' }, input),
        }),
      },
      update: {
        useMutation: (options: { onSuccess?: (data: unknown, input: unknown) => void } = {}) => ({
          isPending: false,
          mutate: (input: unknown) =>
            options.onSuccess?.(
              { id: '770e8400-e29b-41d4-a716-446655440001', name: 'AIセールス' },
              input
            ),
        }),
      },
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

async function enterOffice(employees: (typeof sales)[] = [sales]) {
  const user = userEvent.setup();
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <OfficeImmersive
        organizationId="660e8400-e29b-41d4-a716-446655440000"
        companyName="テスト商事"
        presidentName="山田 太郎"
        employees={employees}
        canManage
        onExit={vi.fn()}
      />
    </NextIntlClientProvider>
  );
  const office = screen.getByRole('dialog', { name: 'AI社員オフィス（出社の画面）' });
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
    mocks.fps = [42];
    mocks.preferred = '2d';
    mocks.statuses = [];
    window.localStorage.clear();
    mocks.looks = [];
    mocks.opening = undefined;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is on V, not on a number: the numbers belong to the rooms', async () => {
    const { user, office } = await enterOffice();
    expect(within(office).getByRole('button', { name: /3D 表示/ })).toHaveTextContent('V');
    await user.keyboard('9');
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
    expect(within(office).getByRole('button', { name: /3D 表示/ })).toBeInTheDocument();
    // The office is still there, and its keys still work
    await user.keyboard('c');
    expect(
      within(office).getByRole('region', { name: 'AIセールスのカスタマイズ' })
    ).toBeInTheDocument();
    // The customization shows its 2D picture again: there is no 3D robot to look at (#1148)
    expect(within(office).queryByTestId('studio-opening')).not.toBeInTheDocument();
    expect(
      within(office).getByRole('img', { name: 'AIセールスのプレビュー' }).querySelector('svg')
    ).not.toBeNull();
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

  it('stays in 3D behind a conversation, a room and the customization (#1148)', async () => {
    const { user, office } = await enterOffice();
    await user.keyboard('v');
    await within(office).findByText('3D の検証');
    expect(mocks.scene).toMatchObject({ stage: 'world', subject: null, attentive: null });

    // A conversation: the camera goes to the employee, who turns to the president
    await user.keyboard('e');
    expect(within(office).getByText('社長（あなた）')).toBeInTheDocument();
    expect(within(office).getByTestId('floor-3d')).toBeInTheDocument();
    const seat = spotOf('sales', 'training');
    expect(mocks.scene).toMatchObject({
      stage: 'talk',
      subject: { x: seat.x, y: seat.y },
      attentive: 'sales',
    });
    // The president standing there is what happens to it; nobody else feels anything
    expect(mocks.scene?.events).toEqual({ sales: 'president_near' });
    // The name tags belong to the floor: none is placed over a conversation
    const placed = within(office)
      .queryAllByRole('button', { name: /AIセールス\s*研修中/, hidden: true })
      .filter((button) => button.style.visibility === 'visible');
    expect(placed).toEqual([]);

    await user.keyboard('{Escape}');
    expect(mocks.scene).toMatchObject({ stage: 'world', subject: null, attentive: null });
    expect(mocks.scene?.events).toEqual({});

    // A room: the camera goes to the desk of the room's employee
    await user.keyboard('2');
    expect(within(office).getByTestId('floor-3d')).toBeInTheDocument();
    expect(mocks.scene).toMatchObject({
      stage: 'room',
      subject: { x: DESK_SEATS.marketer.x, y: DESK_SEATS.marketer.y },
      attentive: null,
    });

    await user.keyboard('{Escape}');
    await user.keyboard('c');
    expect(within(office).getByTestId('floor-3d')).toBeInTheDocument();
    expect(mocks.scene).toMatchObject({ stage: 'studio', subject: { x: seat.x, y: seat.y } });
  });

  it('shows the draft of the customization on the 3D robot before it is saved (#1148)', async () => {
    // "Leave it to me" draws the last choice of every part: not the look the employee has
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const { user, office } = await enterOffice();
    await user.keyboard('v');
    await screen.findByTestId('floor-3d');
    expect(mocks.looks).toEqual([DEFAULT_AI_EMPLOYEE_PROFILE.look]);

    await user.keyboard('c');
    const studio = within(office).getByRole('region', { name: 'AIセールスのカスタマイズ' });
    // The preview is the robot on the floor: an opening with nothing drawn in it, no 2D picture
    const preview = within(office).getByRole('img', { name: 'AIセールスのプレビュー' });
    expect(preview).toBe(within(office).getByTestId('studio-opening'));
    expect(preview).toBeEmptyDOMElement();
    // Customized: the employee turns to the viewer and looks at the president, eyes open and
    // nothing over its head, so that the eyes of the draft can be told apart
    expect(mocks.scene).toMatchObject({
      stage: 'studio',
      attentive: 'sales',
      events: { sales: 'president_near' },
    });
    expect(mocks.looks).toEqual([DEFAULT_AI_EMPLOYEE_PROFILE.look]);

    await user.click(within(studio).getByRole('button', { name: 'おまかせ' }));
    expect(mocks.looks).not.toEqual([DEFAULT_AI_EMPLOYEE_PROFILE.look]);
    const drawn = mocks.looks[0];
    // Putting the draft back puts the robot back
    await user.click(within(office).getByRole('button', { name: 'もとに戻す' }));
    expect(mocks.looks).toEqual([DEFAULT_AI_EMPLOYEE_PROFILE.look]);

    // Leaving without saving takes the draft off the robot: the floor shows what is stored
    await user.click(within(studio).getByRole('button', { name: 'おまかせ' }));
    expect(mocks.looks).toEqual([drawn]);
    await user.keyboard('{Escape}');
    await user.keyboard('{Escape}');
    expect(mocks.scene).toMatchObject({ stage: 'world', attentive: null });
    expect(mocks.looks).toEqual([DEFAULT_AI_EMPLOYEE_PROFILE.look]);
  });

  it('tells the 3D floor where the opening of the customization is, and only there (#1148)', async () => {
    const box = { left: 24, top: 80, width: 416, height: 470 };
    const real = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      return this.dataset.testid === 'studio-opening' ? (box as DOMRect) : real.call(this);
    });
    const { user, office } = await enterOffice();
    await user.keyboard('v');
    await screen.findByTestId('floor-3d');
    expect(mocks.opening).toBeNull();

    await user.keyboard('c');
    expect(within(office).getByTestId('studio-opening')).toBeInTheDocument();
    expect(mocks.opening).toEqual({ x: 24, y: 80, w: 416, h: 470 });

    // Back on the floor there is no opening: the camera is the president's again
    await user.keyboard('{Escape}');
    expect(mocks.scene).toMatchObject({ stage: 'world' });
    expect(mocks.opening).toBeNull();
  });

  it('keeps the 2D picture in the customization while the 3D floor is not drawn (#1148)', async () => {
    mocks.draws = false;
    const { user, office } = await enterOffice();
    await user.keyboard('v');
    await screen.findByTestId('floor-3d');
    await user.keyboard('c');
    expect(within(office).queryByTestId('studio-opening')).not.toBeInTheDocument();
    const preview = within(office).getByRole('img', { name: 'AIセールスのプレビュー' });
    expect(preview.querySelector('svg')).not.toBeNull();
    expect(mocks.opening).toBeNull();
  });

  it('shows a hire as something that happened, and a rest as nothing (#1148)', async () => {
    const { user, office } = await enterOffice();
    await user.keyboard('v');
    await screen.findByTestId('floor-3d');
    // Sent to rest: no event. The status makes it sleep
    await user.keyboard('e');
    await user.keyboard('1');
    expect(within(office).getByText(/しばらく休みます/)).toBeInTheDocument();
    expect(mocks.scene?.events).toEqual({ sales: 'president_near' });
    await user.keyboard('1');

    // Hired: the new employee cheers, and the president standing there does not cover it
    // (the staff list is a new one each time the floor comes back)
    const staff = within(office).getByRole('heading', { name: '社員名簿' })
      .parentElement as HTMLElement;
    await user.click(within(staff).getByRole('button', { name: /マーケター/ }));
    await user.keyboard('e');
    await user.keyboard('1');
    expect(mocks.scene?.events).toEqual({ marketer: 'hired' });
    await user.keyboard('1');
    expect(mocks.scene?.events).toEqual({ marketer: 'hired' });
  });

  it('says in the staff list that a new employee is glad, for a while (#1148)', async () => {
    const user = userEvent.setup();
    const office3d = (employees: (typeof sales)[]) => (
      <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
        <OfficeImmersive
          organizationId="660e8400-e29b-41d4-a716-446655440000"
          companyName="テスト商事"
          presidentName="山田 太郎"
          employees={employees}
          canManage
          onExit={vi.fn()}
        />
      </NextIntlClientProvider>
    );
    const view = render(office3d([sales]));
    const office = screen.getByRole('dialog', { name: 'AI社員オフィス（出社の画面）' });
    await user.click(within(office).getByRole('button', { name: /^出社する/ }));
    await user.keyboard('v');
    await screen.findByTestId('floor-3d');
    const row = (name: RegExp) =>
      within(
        within(office).getByRole('heading', { name: '社員名簿' }).parentElement as HTMLElement
      ).getByRole('button', { name });
    // Nobody is glad about nothing
    expect(row(/AIセールス/)).not.toHaveTextContent('喜んでいます');

    await user.click(row(/マーケター/));
    await user.keyboard('e');
    await user.keyboard('1');
    await user.keyboard('1');
    // The office reads the staff again: the new employee is there, in training
    const marketer = {
      ...sales,
      id: '770e8400-e29b-41d4-a716-446655440002',
      role: 'marketer' as const,
      name: 'AIマーケター',
    };
    view.rerender(office3d([sales, marketer as unknown as typeof sales]));
    expect(row(/AIマーケター/)).toHaveTextContent('喜んでいます');
    expect(row(/AIセールス/)).not.toHaveTextContent('喜んでいます');
  });

  it('shows a call back from a rest as something that happened (#1148)', async () => {
    const paused = { ...sales, status: 'paused' as const, deskStatus: 'paused' as const };
    const { user } = await enterOffice([paused as unknown as typeof sales]);
    await user.keyboard('v');
    await screen.findByTestId('floor-3d');
    await user.keyboard('e');
    await user.keyboard('1');
    expect(mocks.scene?.events).toEqual({ sales: 'resumed' });

    // Customized right after: the cheer gives way, and comes back on the floor
    await user.keyboard('1');
    await user.keyboard('c');
    expect(mocks.scene).toMatchObject({ stage: 'studio', events: { sales: 'president_near' } });
    await user.keyboard('{Escape}');
    expect(mocks.scene).toMatchObject({ stage: 'world', events: { sales: 'resumed' } });
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
    await user.click(within(office).getByRole('button', { name: /3D 表示/ }));
    expect(await screen.findByTestId('floor-3d')).toBeInTheDocument();
    expect(await within(office).findByText('毎秒 42 コマ')).toBeInTheDocument();
    await user.click(within(office).getByRole('button', { name: /2D 表示/ }));
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

describe('the floor the office starts with, and what this device remembers (#1150)', () => {
  const KEY = 'diagnoleads.office.display';
  const slowNote = /この端末では 3D の描画が遅いため、2D で表示しています。/;
  // A device that draws 5 frames a second: the warm-up and the measured seconds
  const slow = Array.from({ length: 12 }, () => 5);
  const context = HTMLCanvasElement.prototype.getContext;

  /** A browser that gives a WebGL context (jsdom knows none) */
  function withWebgl(works = true) {
    vi.stubGlobal('WebGLRenderingContext', function WebGLRenderingContext() {});
    HTMLCanvasElement.prototype.getContext = (() =>
      works ? {} : null) as unknown as typeof context;
  }

  beforeEach(() => {
    mocks.trial = false;
    mocks.breaks = false;
    mocks.draws = true;
    mocks.fps = [42];
    mocks.preferred = '3d';
    window.localStorage.clear();
    withWebgl();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    HTMLCanvasElement.prototype.getContext = context;
    cleanup();
  });

  it('starts in 3D by itself where 3D is the default, and remembers a switch to 2D', async () => {
    const { user, office } = await enterOffice();
    expect(await screen.findByTestId('floor-3d')).toBeInTheDocument();
    expect(window.localStorage.getItem(KEY)).toBeNull();

    await user.keyboard('v');
    expect(screen.queryByTestId('floor-3d')).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? 'null')).toEqual({
      display: '2d',
      reason: 'chosen',
    });
    expect(within(office).queryByRole('status')).not.toBeInTheDocument();

    // The next visit: 2D, as chosen, whatever the default
    cleanup();
    await enterOffice();
    expect(screen.queryByTestId('floor-3d')).not.toBeInTheDocument();
  });

  it('starts in 2D where 2D is the default, and in 3D after the person chose it here', async () => {
    mocks.preferred = '2d';
    const { user } = await enterOffice();
    expect(screen.queryByTestId('floor-3d')).not.toBeInTheDocument();
    await user.keyboard('v');
    expect(await screen.findByTestId('floor-3d')).toBeInTheDocument();

    cleanup();
    await enterOffice();
    expect(await screen.findByTestId('floor-3d')).toBeInTheDocument();
  });

  it('goes back to 2D on a device that draws too slowly, says so, and starts in 2D next time', async () => {
    mocks.fps = slow;
    const { office } = await enterOffice();
    expect(await within(office).findByText(slowNote)).toBeInTheDocument();
    expect(screen.queryByTestId('floor-3d')).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? 'null')).toEqual({
      display: '2d',
      reason: 'slow',
    });

    // The next visit starts in 2D, and does not say it again: the reason was given once
    cleanup();
    const next = await enterOffice();
    expect(screen.queryByTestId('floor-3d')).not.toBeInTheDocument();
    expect(within(next.office).queryByText(slowNote)).not.toBeInTheDocument();
    expect(within(next.office).getByRole('button', { name: /3D 表示/ })).toBeInTheDocument();
  });

  it('leaves 3D on once the person chose it, however slowly it is drawn', async () => {
    mocks.fps = slow;
    const { user, office } = await enterOffice();
    expect(await within(office).findByText(slowNote)).toBeInTheDocument();
    // Try again: a choice is not overruled
    await user.keyboard('v');
    expect(await screen.findByTestId('floor-3d')).toBeInTheDocument();
    expect(within(office).queryByText(slowNote)).not.toBeInTheDocument();

    // Nor on the next visit
    cleanup();
    const next = await enterOffice();
    expect(await screen.findByTestId('floor-3d')).toBeInTheDocument();
    expect(within(next.office).queryByText(slowNote)).not.toBeInTheDocument();
  });

  it('keeps 3D on a device that draws fast enough', async () => {
    mocks.fps = Array.from({ length: 12 }, () => 60);
    const { office } = await enterOffice();
    expect(await screen.findByTestId('floor-3d')).toBeInTheDocument();
    expect(within(office).queryByText(slowNote)).not.toBeInTheDocument();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('does not judge the speed while the floor draws only on a change (less motion)', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce'),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    mocks.fps = slow;
    const { office } = await enterOffice();
    expect(await screen.findByTestId('floor-3d')).toBeInTheDocument();
    expect(within(office).queryByText(slowNote)).not.toBeInTheDocument();
  });

  it('starts in 2D, quietly, where the browser gives no WebGL, without loading the 3D floor', async () => {
    withWebgl(false);
    const { office } = await enterOffice();
    expect(screen.queryByTestId('floor-3d')).not.toBeInTheDocument();
    // Nothing to read every day: the office says so when someone asks for 3D and it fails
    expect(within(office).queryByRole('status')).not.toBeInTheDocument();
    // Nothing is remembered: another browser on this device may well show it
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('remembers nothing when the 3D floor fails: the next visit tries again', async () => {
    mocks.breaks = true;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { office } = await enterOffice();
    expect(
      await within(office).findByText('3D のフロアを表示できませんでした。2D の表示に戻しました。')
    ).toBeInTheDocument();
    expect(window.localStorage.getItem(KEY)).toBeNull();
    errors.mockRestore();
  });
});

describe('the frame rate of the 3D floor (#1270)', () => {
  beforeEach(() => {
    mocks.trial = false;
    mocks.breaks = false;
    mocks.draws = true;
    mocks.fps = [42];
    mocks.preferred = '2d';
    window.localStorage.clear();
    mocks.canvasRenders = 0;
    mocks.reportFps = null;
    mocks.reporters = new Set();
  });

  it('shows each new figure without rendering the office or the canvas again', async () => {
    const { user, office } = await enterOffice();
    await user.keyboard('v');
    expect(await within(office).findByText('毎秒 42 コマ')).toBeInTheDocument();
    const renders = mocks.canvasRenders;

    act(() => mocks.reportFps?.(55));
    expect(within(office).getByText('毎秒 55 コマ')).toBeInTheDocument();
    act(() => mocks.reportFps?.(31));
    expect(within(office).getByText('毎秒 31 コマ')).toBeInTheDocument();
    // The figure lives outside the office's state: nothing above the line rendered again
    expect(mocks.canvasRenders).toBe(renders);
    // and the canvas was always given the same function to report with
    expect(mocks.reporters.size).toBe(1);
  });

  it('forgets the figure when the 3D floor is left, and waits for a new one when it comes back', async () => {
    mocks.draws = true;
    const { user, office } = await enterOffice();
    await user.keyboard('v');
    await within(office).findByText('毎秒 42 コマ');
    await user.keyboard('v');
    expect(within(office).queryByText(/毎秒 \d+ コマ/)).not.toBeInTheDocument();
    mocks.draws = false;
    await user.keyboard('v');
    expect(await screen.findByTestId('floor-3d')).toBeInTheDocument();
    expect(within(office).queryByText(/毎秒 \d+ コマ/)).not.toBeInTheDocument();
  });
});

