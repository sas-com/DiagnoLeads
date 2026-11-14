/**
 * The staff matters of an AI employee inside the conversation (#1170): a new name, the work log
 * and the dismissal. Real next-intl messages; tRPC mocked.
 */
import {
  OfficeTalkStaff,
  STAFF_MATTERS,
  type StaffMatter,
  TALK_LOG_ROWS,
  namesTheEmployee,
} from '@/components/features/ai-employees/office-talk-staff';
import { MESSAGE_FILES, mergeMessageFiles } from '@/lib/i18n/messages';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const EMPLOYEE_ID = '770e8400-e29b-41d4-a716-446655440001';

type Run = {
  id: string;
  startedAt: Date;
  status: 'succeeded' | 'failed' | 'running';
  trigger: 'schedule' | 'manual';
  processedCount: number;
};

const mocks = vi.hoisted(() => ({
  updates: [] as unknown[],
  dismissals: [] as unknown[],
  runsInput: [] as unknown[],
  runs: { isLoading: false, error: null as unknown, data: [] as unknown[] },
  fails: false,
  pending: false,
}));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    aiEmployees: {
      update: {
        useMutation: (options: { onSuccess?: (data: { name: string }) => void } = {}) => ({
          isPending: mocks.pending,
          isError: mocks.fails,
          mutate: (input: { name: string }) => {
            mocks.updates.push(input);
            if (!mocks.fails) options.onSuccess?.({ name: input.name });
          },
        }),
      },
      dismiss: {
        useMutation: (options: { onSuccess?: () => void } = {}) => ({
          isPending: mocks.pending,
          isError: mocks.fails,
          mutate: (input: unknown) => {
            mocks.dismissals.push(input);
            if (!mocks.fails) options.onSuccess?.();
          },
        }),
      },
      runs: {
        useQuery: (input: unknown) => {
          mocks.runsInput.push(input);
          return mocks.runs;
        },
      },
    },
  },
}));

const messages = mergeMessageFiles(MESSAGE_FILES.ja);

function renderMatter(matter: StaffMatter) {
  const onDone = vi.fn();
  const onBack = vi.fn();
  const onBusyChange = vi.fn();
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <OfficeTalkStaff
        matter={matter}
        organizationId={ORG_ID}
        employee={{ id: EMPLOYEE_ID, name: 'AIセールス' }}
        onDone={onDone}
        onBack={onBack}
        onBusyChange={onBusyChange}
      />
    </NextIntlClientProvider>
  );
  return { onDone, onBack, onBusyChange };
}

function run(index: number, over: Partial<Run> = {}): Run {
  return {
    id: `run-${index}`,
    startedAt: new Date(Date.UTC(2026, 10, 14, 0, index)),
    status: 'succeeded',
    trigger: 'schedule',
    processedCount: index,
    ...over,
  };
}

beforeEach(() => {
  mocks.updates.length = 0;
  mocks.dismissals.length = 0;
  mocks.runsInput.length = 0;
  mocks.runs = { isLoading: false, error: null, data: [] };
  mocks.fails = false;
  mocks.pending = false;
});

describe('namesTheEmployee', () => {
  it('accepts the name itself, with spaces around it, and nothing else', () => {
    expect(namesTheEmployee('AIセールス', 'AIセールス')).toBe(true);
    expect(namesTheEmployee('  AIセールス ', 'AIセールス')).toBe(true);
    expect(namesTheEmployee('AIセール', 'AIセールス')).toBe(false);
    expect(namesTheEmployee('aiセールス', 'AIセールス')).toBe(false);
    expect(namesTheEmployee('', 'AIセールス')).toBe(false);
    // An empty name can never be confirmed by typing nothing
    expect(namesTheEmployee('', '')).toBe(false);
    expect(namesTheEmployee('  ', '  ')).toBe(false);
  });

  it('reads the name as it looks: the width of a letter and the spaces do not count', () => {
    // A Japanese input method types the letters full-width
    expect(namesTheEmployee('ＡＩセールス', 'AIセールス')).toBe(true);
    expect(namesTheEmployee('AIｾｰﾙｽ', 'AIセールス')).toBe(true);
    expect(namesTheEmployee('営業　1号', '営業  1号')).toBe(true);
    // A composed letter in one part or in two
    expect(namesTheEmployee('\u30ab\u3099イド', 'ガイド')).toBe(true);
    // Not another name, and not a part of it
    expect(namesTheEmployee('AIマーケター', 'AIセールス')).toBe(false);
    expect(namesTheEmployee('AI', 'AIセールス')).toBe(false);
  });
});

describe('OfficeTalkStaff', () => {
  it('has a title and a way back with Esc for every matter', async () => {
    const user = userEvent.setup();
    for (const matter of STAFF_MATTERS) {
      const { onBack } = renderMatter(matter);
      await user.click(screen.getAllByRole('button', { name: /Esc.*選択肢に戻る/ }).at(-1) as HTMLElement);
      expect(onBack).toHaveBeenCalledTimes(1);
    }
    expect(screen.getByRole('heading', { name: '名前を変える' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '作業記録' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '解雇する' })).toBeInTheDocument();
  });

  it('closes the way back while a matter is being saved, and tells the office', async () => {
    mocks.pending = true;
    const user = userEvent.setup();
    for (const matter of ['rename', 'dismiss'] as const) {
      const { onBack, onBusyChange } = renderMatter(matter);
      const back = screen.getAllByRole('button', { name: /Esc.*選択肢に戻る/ }).at(-1) as HTMLElement;
      expect(back).toHaveAttribute('aria-disabled', 'true');
      await user.click(back);
      expect(onBack).not.toHaveBeenCalled();
      expect(onBusyChange).toHaveBeenLastCalledWith(true);
    }
  });

  it('tells the office that nothing is being saved once the matter goes away', () => {
    mocks.pending = true;
    const { onBusyChange } = renderMatter('dismiss');
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    cleanup();
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it('puts the focus of the work log on nothing that acts: its title can take it', () => {
    renderMatter('log');
    expect(screen.getByRole('heading', { name: '作業記録' })).toHaveAttribute('data-autofocus');
    expect(screen.getByRole('heading', { name: '作業記録' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('button', { name: /Esc.*選択肢に戻る/ })).not.toHaveAttribute(
      'data-autofocus'
    );
  });

  describe('a new name', () => {
    it('starts from the current name and saves the trimmed new one', async () => {
      const user = userEvent.setup();
      const { onDone } = renderMatter('rename');
      const input = screen.getByLabelText('新しい表示名');
      expect(input).toHaveValue('AIセールス');
      const save = screen.getByRole('button', { name: 'この名前にする' });
      // Unchanged: nothing to save
      expect(save).toHaveAttribute('aria-disabled', 'true');
      await user.click(save);
      expect(mocks.updates).toEqual([]);

      await user.clear(input);
      expect(save).toHaveAttribute('aria-disabled', 'true');
      await user.type(input, '  営業の田中  ');
      expect(save).toHaveAttribute('aria-disabled', 'false');
      await user.keyboard('{Enter}');
      expect(mocks.updates).toEqual([
        { organizationId: ORG_ID, employeeId: EMPLOYEE_ID, name: '営業の田中' },
      ]);
      // The name it had is said too: a slip of the keys can be put back
      expect(onDone).toHaveBeenCalledWith(
        'AIセールスから営業の田中という名前になりました。これからもよろしくお願いします。'
      );
    });

    it('says so when the name could not be saved, and reports nothing as done', async () => {
      mocks.fails = true;
      const user = userEvent.setup();
      const { onDone } = renderMatter('rename');
      await user.type(screen.getByLabelText('新しい表示名'), '2');
      await user.click(screen.getByRole('button', { name: 'この名前にする' }));
      expect(mocks.updates).toHaveLength(1);
      expect(screen.getByRole('alert')).toHaveTextContent('うまくいきませんでした');
      expect(onDone).not.toHaveBeenCalled();
    });
  });

  describe('the work log', () => {
    it('asks for the runs of this employee in this organization', () => {
      renderMatter('log');
      expect(mocks.runsInput[0]).toEqual({ organizationId: ORG_ID, employeeId: EMPLOYEE_ID });
    });

    it('says that nothing was recorded when nothing was: no work that was not done', () => {
      renderMatter('log');
      expect(screen.getByText('作業の記録はまだありません。')).toBeInTheDocument();
      expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    });

    it('shows the latest runs with what was recorded, and says when there are more', () => {
      mocks.runs = {
        isLoading: false,
        error: null,
        data: Array.from({ length: TALK_LOG_ROWS + 2 }, (_, index) => run(index)),
      };
      renderMatter('log');
      const rows = screen.getAllByRole('listitem');
      expect(rows).toHaveLength(TALK_LOG_ROWS);
      expect(rows[0]).toHaveTextContent('0 件を処理');
      expect(rows[TALK_LOG_ROWS - 1]).toHaveTextContent(`${TALK_LOG_ROWS - 1} 件を処理`);
      // The normal view holds 20 at most: the conversation does not promise "all"
      expect(
        screen.getByText(
          `新しい ${TALK_LOG_ROWS} 件を出しています。続き（最大20件）は、通常の表示の席の詳細で見られます。`
        )
      ).toBeInTheDocument();
      expect(screen.queryByText(/失敗した作業/)).not.toBeInTheDocument();
    });

    it('does not mention more when everything is on the list', () => {
      mocks.runs = { isLoading: false, error: null, data: [run(3, { status: 'failed' })] };
      renderMatter('log');
      expect(screen.getAllByRole('listitem')).toHaveLength(1);
      expect(screen.getByRole('listitem')).toHaveTextContent('失敗');
      expect(screen.getByRole('listitem')).toHaveTextContent('定期 ・ 3 件を処理');
      expect(screen.queryByText(/続き（最大20件）/)).not.toBeInTheDocument();
      // What a failed run ended with is in the normal view: the conversation says where
      expect(
        screen.getByText('失敗した作業の結果は、通常の表示の席の詳細で確かめられます。')
      ).toBeInTheDocument();
    });

    it('says so when the log could not be read', () => {
      mocks.runs = { isLoading: false, error: new Error('down'), data: [] };
      renderMatter('log');
      expect(screen.getByRole('alert')).toHaveTextContent('作業記録を読み込めませんでした。');
    });
  });

  describe('the dismissal', () => {
    it('says what is lost, and is carried out only once the name was typed', async () => {
      const user = userEvent.setup();
      const { onDone } = renderMatter('dismiss');
      expect(screen.getByText('この席は空席に戻り、元に戻せません。作業記録は残ります。あとで同じ役割の AI社員を採用し直せます。')).toBeInTheDocument();
      const input = screen.getByLabelText('確認のため、この AI社員の名前「AIセールス」を入力してください');
      expect(input).toHaveValue('');
      const confirm = screen.getByRole('button', { name: 'AIセールスを解雇する' });
      expect(confirm).toHaveAttribute('aria-disabled', 'true');
      // Why it is closed is read out with it
      expect(confirm).toHaveAccessibleDescription(
        '確認のため、この AI社員の名前「AIセールス」を入力してください'
      );
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();

      // Neither the button nor Enter, with nothing or something else typed
      await user.click(confirm);
      await user.type(input, '4{Enter}');
      await user.type(input, '1234567891{Enter}');
      await user.clear(input);
      await user.type(input, 'AIセール{Enter}');
      await user.click(confirm);
      expect(mocks.dismissals).toEqual([]);
      expect(onDone).not.toHaveBeenCalled();
      // Asked for with another name: it says why nothing happened, until the name is typed again
      expect(screen.getByRole('alert')).toHaveTextContent('名前が一致していません。');

      await user.type(input, 'ス');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(confirm).toHaveAttribute('aria-disabled', 'false');
      await user.click(confirm);
      expect(mocks.dismissals).toEqual([{ organizationId: ORG_ID, employeeId: EMPLOYEE_ID }]);
      expect(onDone).toHaveBeenCalledWith('AIセールスを解雇しました。この席は空席に戻りました。');
    });

    it('says so when the dismissal failed, and reports nothing as done', async () => {
      mocks.fails = true;
      const user = userEvent.setup();
      const { onDone } = renderMatter('dismiss');
      await user.type(
        screen.getByLabelText('確認のため、この AI社員の名前「AIセールス」を入力してください'),
        'AIセールス{Enter}'
      );
      expect(mocks.dismissals).toHaveLength(1);
      expect(screen.getByRole('alert')).toHaveTextContent('うまくいきませんでした');
      expect(onDone).not.toHaveBeenCalled();
    });
  });
});
