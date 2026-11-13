/**
 * The studio of the full-screen office (#1134): customizing an AI employee's look, tone, ability
 * points and work style on a draft, saving it, and who may. Real next-intl messages; tRPC mocked.
 */
import { OfficeImmersive } from '@/components/features/ai-employees/office-immersive';
import { studioTabOfKey } from '@/components/features/ai-employees/office-studio';
import {
  AI_STAT_POINTS,
  DEFAULT_AI_EMPLOYEE_PROFILE,
} from '@/lib/features/ai-employees/types/profile';
import { MESSAGE_FILES, mergeMessageFiles } from '@/lib/i18n/messages';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const EMPLOYEE_ID = '770e8400-e29b-41d4-a716-446655440001';

const mocks = vi.hoisted(() => ({
  updates: [] as { organizationId: string; employeeId: string; profile?: unknown }[],
  fail: false,
  invalidate: vi.fn(),
}));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({ aiEmployees: { office: { invalidate: mocks.invalidate } } }),
    aiEmployees: {
      hire: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
      update: {
        useMutation: (
          options: {
            onSuccess?: (data: unknown, input: { profile?: unknown }) => void;
            onError?: () => void;
          } = {}
        ) => ({
          isPending: false,
          mutate: (input: { organizationId: string; employeeId: string; profile?: unknown }) => {
            if (mocks.fail) {
              options.onError?.();
              return;
            }
            mocks.updates.push(input);
            options.onSuccess?.({ id: EMPLOYEE_ID, name: 'AIセールス', status: 'active' }, input);
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

async function enterOffice(props: { canManage?: boolean; employees?: (typeof sales)[] } = {}) {
  const user = userEvent.setup();
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <OfficeImmersive
        organizationId={ORG_ID}
        companyName="テスト商事"
        presidentName="山田 太郎"
        employees={props.employees ?? [sales]}
        canManage={props.canManage ?? true}
        onExit={vi.fn()}
      />
    </NextIntlClientProvider>
  );
  const office = screen.getByRole('dialog', { name: 'AI社員オフィス（全画面）' });
  await user.click(within(office).getByRole('button', { name: /^出社する/ }));
  return { user, office };
}

async function openStudio() {
  const entered = await enterOffice();
  // The hired employee is the one in front of the president: it is the only one
  const staff = within(entered.office).getByRole('heading', { name: '社員名簿' })
    .parentElement as HTMLElement;
  await entered.user.click(within(staff).getByRole('button', { name: /AIセールス/ }));
  await entered.user.keyboard('c');
  const board = within(entered.office).getByRole('region', { name: 'AIセールスのカスタマイズ' });
  return { ...entered, board };
}

describe('studioTabOfKey', () => {
  it('opens the tabs with 1 to 4', () => {
    expect(['1', '2', '3', '4', '5', 'a'].map(studioTabOfKey)).toEqual([
      'look',
      'tone',
      'stats',
      'work',
      null,
      null,
    ]);
  });
});

describe('the studio', () => {
  beforeEach(() => {
    mocks.updates.length = 0;
    mocks.fail = false;
    mocks.invalidate.mockClear();
  });

  it('is offered for a hired employee to those who manage, with a button and the C key', async () => {
    const { user, office } = await enterOffice();
    const staff = within(office).getByRole('heading', { name: '社員名簿' })
      .parentElement as HTMLElement;
    // A vacant seat has nothing to customize
    await user.click(within(staff).getByRole('button', { name: /マーケター/ }));
    expect(within(office).queryByRole('button', { name: /カスタマイズ/ })).not.toBeInTheDocument();
    await user.keyboard('c');
    expect(within(office).queryByRole('region', { name: /のカスタマイズ/ })).not.toBeInTheDocument();

    await user.click(within(staff).getByRole('button', { name: /AIセールス/ }));
    await user.click(within(office).getByRole('button', { name: /カスタマイズ/ }));
    expect(
      within(office).getByRole('region', { name: 'AIセールスのカスタマイズ' })
    ).toBeInTheDocument();
  });

  it('is not offered to someone who cannot manage the AI employees', async () => {
    const { user, office } = await enterOffice({ canManage: false });
    const staff = within(office).getByRole('heading', { name: '社員名簿' })
      .parentElement as HTMLElement;
    await user.click(within(staff).getByRole('button', { name: /AIセールス/ }));
    expect(within(office).queryByRole('button', { name: /カスタマイズ/ })).not.toBeInTheDocument();
    await user.keyboard('c');
    expect(within(office).queryByRole('region', { name: /のカスタマイズ/ })).not.toBeInTheDocument();
  });

  it('opens on the look with the employee as it is, nothing to save yet', async () => {
    const { office, board } = await openStudio();
    expect(within(office).getByRole('img', { name: 'AIセールスのプレビュー' })).toBeInTheDocument();
    expect(within(board).getByRole('tab', { name: /見た目/ })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(within(board).getByRole('button', { name: 'ヘルメット' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(within(board).getByRole('button', { name: '役割の装備' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(within(office).getByRole('button', { name: '保存する' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
  });

  it('saves the look, the tone, the abilities and the work style of the draft', async () => {
    const { user, office, board } = await openStudio();
    for (const name of ['ドーム', 'ぱっちり', 'リング', '蝶ネクタイ', 'ミント', 'ピンク']) {
      await user.click(within(board).getByRole('button', { name }));
    }
    expect(within(office).getByText('保存していない変更があります。')).toBeInTheDocument();

    await user.keyboard('2');
    await user.click(within(board).getByRole('button', { name: /熱血/ }));
    // The sample is in the tone of the draft, before saving
    expect(
      within(office).getByText('社長、お疲れさまです！次の作業、いつでも行けます！')
    ).toBeInTheDocument();

    await user.keyboard('3');
    await user.click(within(board).getByRole('button', { name: '粘り強さを下げる' }));
    await user.click(within(board).getByRole('button', { name: 'スピードを上げる' }));

    await user.keyboard('4');
    await user.click(within(board).getByRole('button', { name: /進めてから報告/ }));
    await user.click(within(board).getByRole('button', { name: 'くわしく' }));

    await user.click(within(office).getByRole('button', { name: '保存する' }));
    expect(mocks.updates).toEqual([
      {
        organizationId: ORG_ID,
        employeeId: EMPLOYEE_ID,
        profile: {
          look: {
            head: 'dome',
            eyes: 'wide',
            antenna: 'ring',
            gear: 'bow_tie',
            shell: 'mint',
            accent: 'pink',
          },
          tone: 'spirited',
          stats: { speed: 4, care: 3, insight: 3, grit: 2 },
          workStyle: { autonomy: 'report', reporting: 'detailed' },
        },
      },
    ]);
    expect(within(office).getByText('保存しました。')).toBeInTheDocument();
    expect(mocks.invalidate).toHaveBeenCalledWith({ organizationId: ORG_ID });
    expect(within(office).getByRole('button', { name: '保存する' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
  });

  it('never spends more ability points than there are', async () => {
    const { user, board } = await openStudio();
    await user.keyboard('3');
    expect(within(board).getByText(`残り 0 ポイント（全部で ${AI_STAT_POINTS}）`)).toBeInTheDocument();
    const raise = within(board).getByRole('button', { name: 'スピードを上げる' });
    expect(raise).toHaveAttribute('aria-disabled', 'true');
    await user.click(raise);
    expect(within(board).getByRole('img', { name: 'スピード：6 のうち 3' })).toBeInTheDocument();

    await user.click(within(board).getByRole('button', { name: '丁寧さを下げる' }));
    expect(within(board).getByText(`残り 1 ポイント（全部で ${AI_STAT_POINTS}）`)).toBeInTheDocument();
    await user.click(raise);
    expect(within(board).getByRole('img', { name: 'スピード：6 のうち 4' })).toBeInTheDocument();
    expect(raise).toHaveAttribute('aria-disabled', 'true');
  });

  it('says that the abilities and the work style do nothing yet', async () => {
    const { user, board } = await openStudio();
    const note = /仕事はまだ準備中なので、今は働きには効きません。/;
    await user.keyboard('3');
    expect(within(board).getByText(note)).toBeInTheDocument();
    await user.keyboard('4');
    expect(within(board).getByText(note)).toBeInTheDocument();
    await user.keyboard('1');
    expect(within(board).queryByText(note)).not.toBeInTheDocument();
  });

  it('puts the draft back, and saves nothing that was not changed', async () => {
    const { user, office, board } = await openStudio();
    await user.click(within(board).getByRole('button', { name: 'ドーム' }));
    await user.click(within(office).getByRole('button', { name: 'もとに戻す' }));
    expect(within(board).getByRole('button', { name: 'ヘルメット' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await user.click(within(office).getByRole('button', { name: '保存する' }));
    expect(mocks.updates).toHaveLength(0);
  });

  it('changes the whole look at once with "leave it to me"', async () => {
    const { user, office, board } = await openStudio();
    await user.click(within(board).getByRole('button', { name: 'おまかせ' }));
    // Whatever was drawn is an option of each part: exactly one is pressed per part
    for (const part of ['頭の形', '目', 'アンテナ', '装備', '本体の色', '差し色']) {
      const group = within(board).getByRole('group', { name: part });
      expect(
        within(group)
          .getAllByRole('button')
          .filter((button) => button.getAttribute('aria-pressed') === 'true')
      ).toHaveLength(1);
    }
    expect(within(office).getByRole('img', { name: 'AIセールスのプレビュー' })).toBeInTheDocument();
  });

  it('warns before Esc throws unsaved changes away, and leaves on the second press', async () => {
    const { user, office, board } = await openStudio();
    await user.click(within(board).getByRole('button', { name: 'ドーム' }));
    await user.keyboard('{Escape}');
    expect(
      within(office).getByText(
        '保存していない変更があります。もう一度 Esc を押すと、変更を捨てて戻ります。'
      )
    ).toBeInTheDocument();
    expect(within(office).getByRole('region', { name: /のカスタマイズ/ })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(within(office).queryByRole('region', { name: /のカスタマイズ/ })).not.toBeInTheDocument();
    expect(mocks.updates).toHaveLength(0);
  });

  it('leaves at once with Esc when nothing was changed', async () => {
    const { user, office } = await openStudio();
    await user.keyboard('{Escape}');
    expect(within(office).queryByRole('region', { name: /のカスタマイズ/ })).not.toBeInTheDocument();
    expect(within(office).getByRole('navigation', { name: 'フロア案内' })).toBeInTheDocument();
  });

  it('says so when saving fails, and keeps the draft', async () => {
    mocks.fail = true;
    const { user, office, board } = await openStudio();
    await user.click(within(board).getByRole('button', { name: 'ドーム' }));
    await user.click(within(office).getByRole('button', { name: '保存する' }));
    expect(
      within(office).getByText(
        'すみません、保存できませんでした。時間をおいて、もう一度お願いします。'
      )
    ).toBeInTheDocument();
    expect(within(board).getByRole('button', { name: 'ドーム' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });
});

describe('the tone in a conversation', () => {
  it('changes what the AI employee says', async () => {
    const { user, office } = await enterOffice({
      employees: [{ ...sales, profile: { ...DEFAULT_AI_EMPLOYEE_PROFILE, tone: 'brisk' } }],
    });
    const staff = within(office).getByRole('heading', { name: '社員名簿' })
      .parentElement as HTMLElement;
    await user.click(within(staff).getByRole('button', { name: /AIセールス/ }));
    await user.keyboard('e');
    expect(within(office).getByText(/^研修中です。準備ができしだい働きます。予定の仕事：/)).toBeInTheDocument();
  });

  it('stays polite for an employee that was never customized', async () => {
    const { user, office } = await enterOffice();
    const staff = within(office).getByRole('heading', { name: '社員名簿' })
      .parentElement as HTMLElement;
    await user.click(within(staff).getByRole('button', { name: /AIセールス/ }));
    await user.keyboard('e');
    expect(within(office).getByText(/^社長、いまは研修中です。/)).toBeInTheDocument();
  });
});
