/**
 * The full-screen office (#1109): the title, entering as the president, the staff and the
 * president's tasks from the real state, a conversation that hires or pauses an AI employee, and
 * the keys (Esc steps back, E talks, the numbers answer). Real next-intl messages; tRPC mocked.
 */
import { NAME_BAND_SHADE } from '@/components/features/ai-employees/office-immersive';
import { shade } from '@/components/features/ai-employees/office-prims';
import { ROLE_ACCENTS } from '@/components/features/ai-employees/office-robot';
import { AI_EMPLOYEE_ROLES } from '@/lib/features/ai-employees/types/roles';
import { OfficeImmersive } from '@/components/features/ai-employees/office-immersive';
import { DEFAULT_AI_EMPLOYEE_PROFILE } from '@/lib/features/ai-employees/types/profile';
import { MESSAGE_FILES, mergeMessageFiles } from '@/lib/i18n/messages';
import { fireEvent, render, screen, within } from '@testing-library/react';
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
  profile: DEFAULT_AI_EMPLOYEE_PROFILE,
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

// WCAG 2 contrast ratio of two #rrggbb colors
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('the band under an AI employee\u2019s name', () => {
  it('carries white text at 4.5:1 or more for every role', () => {
    for (const role of AI_EMPLOYEE_ROLES) {
      const band = shade(ROLE_ACCENTS[role], NAME_BAND_SHADE);
      expect(contrast('#ffffff', band)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

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

  it('points to the normal view on a narrow screen, and still lets the president in (#1139)', async () => {
    const width = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    try {
      const user = userEvent.setup();
      const { office, onExit } = renderOffice();
      expect(
        within(office).getByText(
          'この画面は、幅の広い画面（パソコン・タブレットの横向き）向けです。この幅では、通常の表示をお使いください。'
        )
      ).toBeInTheDocument();
      // The way out comes first; clocking in is still there
      const choices = within(office)
        .getAllByRole('button')
        .filter((button) => /通常の表示に戻る|出社する/.test(button.textContent ?? ''));
      expect(choices.map((button) => button.textContent)).toEqual([
        '通常の表示に戻るEsc',
        '出社するEnter',
      ]);
      await user.click(within(office).getByRole('button', { name: /^出社する/ }));
      expect(within(office).getByRole('heading', { name: '社員名簿' })).toBeInTheDocument();
      expect(onExit).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    }
  });

  it('says nothing about the width on a wide screen', () => {
    const { office } = renderOffice();
    expect(within(office).queryByText(/幅の広い画面/)).not.toBeInTheDocument();
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

  it('names the rooms and tags the staff over the 2D floor, outside the drawing (#1177)', async () => {
    const user = userEvent.setup();
    const { office } = renderOffice();
    await user.click(within(office).getByRole('button', { name: /^出社する/ }));

    // One layer of DOM over the floor: it can step out from under the panels, the drawing cannot
    const layer = office.querySelector('[data-office-labels]') as HTMLElement;
    expect(within(layer).getAllByRole('button')).toHaveLength(4);
    const tag = within(layer).getByRole('button', { name: /AIセールス 研修中/ });
    expect(tag.style.visibility).toBe('visible');
    const room = within(layer).getByText('研修室');
    expect(room).toHaveAttribute('aria-hidden', 'true');
    expect(room.closest('svg')).toBeNull();
    // The drawing itself carries no names any more
    expect(office.querySelector('svg text')).toBeNull();
  });

  it('hires from a conversation with a vacant desk', async () => {
    const user = userEvent.setup();
    const { office } = renderOffice();
    await user.click(within(office).getByRole('button', { name: /^出社する/ }));
    await user.click(within(office).getByRole('button', { name: /^マーケターを採用する/ }));

    // The report says before hiring that the role starts in training, and it holds the focus:
    // no choice is under the Enter key
    const report = within(office).getByText(
      /ここはマーケターの席です。まだ誰もいません。.*採用しても、仕事の準備ができるまでは研修中です。/
    );
    expect(report).toHaveFocus();
    const hire = within(office).getByRole('button', { name: /採用する$/ });
    await user.keyboard('{Enter}');
    expect(mocks.hires).toEqual([]);
    await user.click(hire);
    expect(mocks.hires).toEqual([{ organizationId: ORG_ID, role: 'marketer', name: 'AIマーケター' }]);
    expect(within(office).getByText(/AIマーケターです。よろしくお願いします、社長。/)).toBeInTheDocument();
    expect(mocks.invalidate).toHaveBeenCalledWith({ organizationId: ORG_ID });
    // Once the answer was carried out the only choice is the way back, and it holds the focus
    const choices = within(office).getByRole('heading', { name: '社長（あなた）' })
      .parentElement as HTMLElement;
    expect(within(choices).getAllByRole('button')).toHaveLength(1);
    const back = within(choices).getByRole('button', { name: /オフィスに戻る/ });
    expect(back).toHaveFocus();
    await user.keyboard('1');
    expect(within(office).getByRole('heading', { name: '社員名簿' })).toBeInTheDocument();
    expect(mocks.hires).toHaveLength(1);
  });

  it('never hires with Enter alone, however often it is pressed', async () => {
    const user = userEvent.setup();
    const { office } = renderOffice();
    // The title, the office and the conversation each open with the focus on something safe
    await user.keyboard('{Enter}{Enter}{Enter}{Enter}');
    expect(within(office).getByText(/と会話中/)).toBeInTheDocument();
    expect(mocks.hires).toEqual([]);
    expect(mocks.updates).toEqual([]);
  });

  it('keeps the keys working after a click on the floor, and leaves modified keys alone', async () => {
    const user = userEvent.setup();
    const { office } = renderOffice();
    await user.click(within(office).getByRole('button', { name: /^出社する/ }));
    const floor = office.querySelector('.cursor-grab') as HTMLElement;
    await user.click(floor);
    // The focus stays inside the layer
    expect(office.contains(document.activeElement)).toBe(true);
    await user.keyboard('{Control>}e{/Control}');
    expect(within(office).queryByText(/と会話中/)).not.toBeInTheDocument();
    await user.keyboard('e');
    expect(within(office).getByText(/と会話中/)).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(within(office).getByRole('heading', { name: '社員名簿' })).toBeInTheDocument();
  });

  it('moves the camera with + and - and resets it with 0, as the keys on the bar say', async () => {
    const user = userEvent.setup();
    const { office } = renderOffice();
    await user.click(within(office).getByRole('button', { name: /^出社する/ }));
    const stage = office.querySelector('.cursor-grab > div') as HTMLElement;
    const home = stage.style.transform;
    await user.keyboard('+');
    const closer = stage.style.transform;
    expect(closer).not.toBe(home);
    await user.keyboard('-');
    expect(stage.style.transform).toBe(home);
    await user.keyboard('+');
    await user.keyboard('0');
    expect(stage.style.transform).toBe(home);
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
    // The first choice does not turn into the opposite order
    expect(within(office).queryByRole('button', { name: /戻ってきて/ })).not.toBeInTheDocument();
    expect(within(office).getByRole('button', { name: /オフィスに戻る/ })).toHaveFocus();
  });

  it('puts a paused AI employee back to work from the president’s first task', async () => {
    const user = userEvent.setup();
    const paused = { ...sales, status: 'paused' as const, deskStatus: 'paused' as const };
    const { office } = renderOffice({ employees: [paused as unknown as typeof sales] });
    await user.click(within(office).getByRole('button', { name: /^出社する/ }));
    // The paused employee is the president's first task, and the one in front of the president
    await user.click(within(office).getByRole('button', { name: /セールスを呼び戻す/ }));

    expect(within(office).getByText(/社長、いまは休止中です。.*すぐに戻ります。/)).toBeInTheDocument();
    await user.keyboard('1');
    expect(mocks.updates).toEqual([
      { organizationId: ORG_ID, employeeId: EMPLOYEE_ID, status: 'active' },
    ]);
    // The role has no work yet: coming back means going back to training
    expect(
      within(office).getByText('AIセールス、研修に戻ります。仕事の準備ができしだい働き始めます。')
    ).toBeInTheDocument();
  });

  it('lets someone who cannot manage look and talk, but not hire or pause', async () => {
    const user = userEvent.setup();
    const { office } = renderOffice({ canManage: false });
    await user.click(within(office).getByRole('button', { name: /^出社する/ }));
    expect(
      within(office).getByText('急ぎの仕事はありません。採用と再開は管理者が行います。')
    ).toBeInTheDocument();
    await user.keyboard('e');
    expect(within(office).getByText('AI社員の採用と管理は、管理者だけができます。')).toBeInTheDocument();
    expect(within(office).queryByRole('button', { name: /しばらく休んでいい/ })).not.toBeInTheDocument();
    await user.click(within(office).getByRole('button', { name: /またあとで/ }));
    expect(within(office).getByRole('heading', { name: '社員名簿' })).toBeInTheDocument();
    expect(mocks.updates).toEqual([]);
  });

  it('leaves the keys of a Japanese conversion (IME) alone: no order, no step back (#1140)', async () => {
    const user = userEvent.setup();
    const { office, onExit } = renderOffice();
    await user.click(within(office).getByRole('button', { name: /^出社する/ }));
    const floor = () => within(office).queryByRole('heading', { name: '社員名簿' });
    expect(floor()).toBeInTheDocument();

    // Chrome marks the keys of an open conversion; Safari sends the last one with keyCode 229
    fireEvent.keyDown(office, { key: 'e', isComposing: true });
    fireEvent.keyDown(office, { key: 'E', keyCode: 229 });
    expect(within(office).queryByText('社長（あなた）')).not.toBeInTheDocument();
    fireEvent.keyDown(office, { key: 'Escape', isComposing: true });
    fireEvent.keyDown(office, { key: 'Escape', keyCode: 229 });
    expect(floor()).toBeInTheDocument();
    expect(onExit).not.toHaveBeenCalled();

    // The same keys outside a conversion still work
    await user.keyboard('e');
    expect(within(office).getByText('社長（あなた）')).toBeInTheDocument();
    fireEvent.keyDown(office, { key: '1', isComposing: true });
    expect(mocks.hires).toHaveLength(0);
    fireEvent.keyDown(office, { key: 'Escape', keyCode: 229 });
    expect(within(office).getByText('社長（あなた）')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(floor()).toBeInTheDocument();
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
