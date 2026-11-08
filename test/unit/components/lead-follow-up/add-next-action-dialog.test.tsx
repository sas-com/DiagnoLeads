/**
 * The dialog that adds a deal's next action from the deals board and list (#853): whose next
 * action it is and who gets its due notices, the deal sent with it, closing with a toast and the
 * lists and the board read again once it is added, a failure said in place, not closing while it
 * saves, and no text under 14px with 44px controls on phones (real next-intl messages and UI
 * components; tRPC mocked)
 */
import { AddNextActionDialog } from '@/components/features/lead-follow-up/add-next-action-dialog';
import messages from '@/locales/ja/common.json';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '770e8400-e29b-41d4-a716-446655440001';
const DEAL_ID = '990e8400-e29b-41d4-a716-446655440003';
const OWNER_ID = 'aa0e8400-e29b-41d4-a716-446655440004';

type MutationOptions = {
  onSuccess?: (result: unknown, input: unknown) => void;
  onError?: (error: Error) => void;
};

const mocks = vi.hoisted(() => ({
  created: [] as unknown[],
  fail: false,
  /** The task is on its way to the server */
  pending: false,
  members: [] as unknown[],
  invalidated: [] as [string, unknown][],
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/trpc/client', () => {
  const invalidate = (name: string) => ({
    invalidate: (input?: unknown) => {
      mocks.invalidated.push([name, input]);
    },
  });
  return {
    trpc: {
      useUtils: () => ({
        leadFollowUp: { tasks: invalidate('tasks'), dueTasks: invalidate('dueTasks') },
        deals: { board: invalidate('board') },
      }),
      leadFollowUp: {
        createTask: {
          useMutation: (options: MutationOptions = {}) => ({
            isPending: mocks.pending,
            mutate: (input: { title: string }) => {
              mocks.created.push(input);
              if (mocks.fail) return options.onError?.(new Error('failed'));
              options.onSuccess?.({ id: 'task-1', title: input.title }, input);
            },
          }),
        },
      },
      leads: { assignees: { useQuery: () => ({ data: mocks.members }) } },
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
  mocks.created = [];
  mocks.fail = false;
  mocks.pending = false;
  mocks.invalidated = [];
  mocks.members = [
    { userId: OWNER_ID, name: '営業 花子', email: 'hanako@example.com', displayName: '営業 花子' },
  ];
});

const DEAL = {
  id: DEAL_ID,
  name: 'AS/400 現行調査',
  leadId: LEAD_ID,
  ownerUserId: OWNER_ID as string | null,
  ownerName: '営業 花子' as string | null,
};

function renderDialog(
  overrides: { deal?: Partial<typeof DEAL>; leadLabel?: string } = {}
): { onOpenChange: ReturnType<typeof vi.fn>; onAdded: ReturnType<typeof vi.fn> } {
  const onOpenChange = vi.fn();
  const onAdded = vi.fn();
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <AddNextActionDialog
        open
        onOpenChange={onOpenChange}
        organizationId={ORG_ID}
        deal={{ ...DEAL, ...overrides.deal }}
        leadLabel={overrides.leadLabel ?? '架空商事'}
        today="2026-10-24"
        onAdded={onAdded}
      />
    </NextIntlClientProvider>
  );
  return { onOpenChange, onAdded };
}

const dialog = () => screen.getByRole('dialog', { name: '「AS/400 現行調査」の次の行動を追加' });

describe('AddNextActionDialog', () => {
  it("says whose next action it is and that the deal's owner gets its due notices", () => {
    renderDialog();
    expect(dialog()).toHaveAccessibleDescription(
      'リード「架空商事」の次の行動・持ち帰り事項に追加します。期限が来ると、商談の担当の営業 花子さんの「今日」と通知に出ます。リードの担当が別の人なら、営業 花子さんをこの次の行動の担当にします。'
    );
  });

  it("says the lead's assignee gets them when the deal has no owner, nor a name of its lead", () => {
    renderDialog({ deal: { ownerUserId: null, ownerName: null }, leadLabel: '' });
    expect(dialog()).toHaveAccessibleDescription(
      'この商談のリードの次の行動・持ち帰り事項に追加します。期限が来ると、リードの担当（いなければ追加した人）の「今日」と通知に出ます。'
    );
  });

  it('adds it for the deal, due today unless changed, then closes with a toast and reads again', async () => {
    const user = userEvent.setup();
    const { onOpenChange, onAdded } = renderDialog();

    await user.type(within(dialog()).getByLabelText('やること'), '稟議の状況を確認する');
    await user.click(within(dialog()).getByRole('button', { name: '追加' }));
    expect(mocks.created).toEqual([
      {
        organizationId: ORG_ID,
        leadId: LEAD_ID,
        kind: 'next_action',
        title: '稟議の状況を確認する',
        dueOn: '2026-10-24',
        note: null,
        dealId: DEAL_ID,
      },
    ]);
    expect(mocks.toast.success).toHaveBeenCalledWith('「稟議の状況を確認する」を追加しました', {
      description: '架空商事',
    });
    expect(onAdded).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    // The lead's list, the due ones and the board, whose card loses its mark
    expect(mocks.invalidated).toEqual([
      ['tasks', { organizationId: ORG_ID, leadId: LEAD_ID }],
      ['dueTasks', { organizationId: ORG_ID }],
      ['board', { organizationId: ORG_ID }],
    ]);
  });

  it('adds a takeaway with whom to check with', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(within(dialog()).getByRole('radio', { name: '持ち帰り事項' }));
    await user.type(within(dialog()).getByLabelText('やること'), '保守費用の内訳を回答する');
    await user.click(within(dialog()).getByRole('combobox', { name: '確認先（任意）' }));
    await user.click(screen.getByRole('option', { name: '営業 花子' }));
    await user.click(within(dialog()).getByRole('button', { name: '追加' }));
    expect(mocks.created).toEqual([
      expect.objectContaining({ kind: 'takeaway', checkWithUserId: OWNER_ID, dealId: DEAL_ID }),
    ]);
  });

  it('closes without adding from cancel', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();
    await user.click(within(dialog()).getByRole('button', { name: 'キャンセル' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.created).toEqual([]);
  });

  it('says a failed save in place and stays open with what was entered', async () => {
    mocks.fail = true;
    const user = userEvent.setup();
    const { onOpenChange, onAdded } = renderDialog();

    await user.click(within(dialog()).getByRole('button', { name: '追加' }));
    expect(within(dialog()).getByRole('alert')).toHaveTextContent('やることを入力してください');
    await user.type(within(dialog()).getByLabelText('やること'), '稟議の状況を確認する');
    await user.click(within(dialog()).getByRole('button', { name: '追加' }));
    expect(within(dialog()).getByRole('alert')).toHaveTextContent(
      '保存できませんでした。もう一度お試しください'
    );
    expect(within(dialog()).getByLabelText('やること')).toHaveValue('稟議の状況を確認する');
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(onAdded).not.toHaveBeenCalled();
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });

  it('does not close while it saves', async () => {
    mocks.pending = true;
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();
    expect(within(dialog()).getByRole('button', { name: '追加' })).toBeDisabled();
    expect(within(dialog()).getByRole('button', { name: 'キャンセル' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('writes no text under 14px and gives its controls 44px on phones', () => {
    renderDialog();
    expect(dialog().querySelector('.text-xs')).toBeNull();
    for (const button of within(dialog()).getAllByRole('button', { name: /^(追加|キャンセル)$/ })) {
      expect(button).toHaveClass('min-h-11');
    }
    for (const kind of within(dialog()).getAllByRole('radio')) expect(kind).toHaveClass('min-h-11');
    expect(within(dialog()).getByLabelText('やること')).toHaveClass('h-11');
  });
});
