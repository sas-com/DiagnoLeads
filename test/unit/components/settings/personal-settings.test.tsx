/**
 * Personal settings page (#164): profile save, notification preferences of the current
 * organization and account deletion (real ja messages; auth client and tRPC mocked)
 */
import SettingsPage from '@/app/[locale]/(dashboard)/settings/page';
import messages from '@/locales/ja/common.json';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const EMAIL = 'taro@example.com';

type DeleteResult =
  | { ok: true }
  | { ok: false; reason: string; organizations?: { id: string; name: string }[] };

const mocks = vi.hoisted(() => ({
  updateUser: vi.fn(),
  signOut: vi.fn(),
  replace: vi.fn(),
  soleOwned: [] as { id: string; name: string }[],
  refetchSoleOwned: vi.fn(),
  deleteAccount: vi.fn(),
  updatePreferences: vi.fn(),
  preferences: {
    inAppConsultationRequested: true,
    inAppLeadCreated: true,
    inAppAssignedToMe: false,
    inAppNextActionDue: true,
    inAppHearingNextMeeting: true,
  },
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/lib/auth/client', () => ({
  authClient: {
    useSession: () => ({
      data: {
        user: {
          id: 'user-1',
          name: '山田 太郎',
          email: EMAIL,
          emailVerified: true,
          createdAt: new Date('2026-10-01'),
        },
      },
      isPending: false,
    }),
    updateUser: mocks.updateUser,
    signOut: mocks.signOut,
    changePassword: vi.fn(),
  },
}));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    account: {
      soleOwnedOrganizations: {
        useQuery: () => ({
          data: mocks.soleOwned,
          isLoading: false,
          refetch: mocks.refetchSoleOwned,
        }),
      },
      delete: {
        useMutation: () => ({ mutateAsync: mocks.deleteAccount, isPending: false }),
      },
    },
  },
}));

vi.mock('@/hooks/use-notifications', () => ({
  useNotificationPreferences: () => ({ data: mocks.preferences, isLoading: false }),
  useUpdateNotificationPreferences: () => ({ mutateAsync: mocks.updatePreferences }),
}));

vi.mock('@/hooks/use-organization', () => ({
  useOrganization: () => ({
    organizationId: ORG_ID,
    organization: { id: ORG_ID, name: 'テスト商事' },
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: mocks.replace }),
  usePathname: () => '/ja/settings',
  useParams: () => ({}),
}));

vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }));

const renderPage = () =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages}>
      <SettingsPage />
    </NextIntlClientProvider>
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.soleOwned = [];
  mocks.updateUser.mockResolvedValue({ data: {}, error: null });
  mocks.signOut.mockResolvedValue({});
  mocks.updatePreferences.mockResolvedValue({});
});

describe('personal settings page', () => {
  it('shows no raw translation keys', () => {
    const { container } = renderPage();
    expect(container.textContent).not.toMatch(/settings\.profile\.|notifications\.settings\./);
    expect(screen.getByText(messages.settings.profile.pageDescription)).toBeInTheDocument();
  });

  it('saves the trimmed name', async () => {
    renderPage();
    const save = screen.getByRole('button', { name: '保存' });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText('氏名'), { target: { value: '  山田 花子 ' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(mocks.updateUser).toHaveBeenCalledWith({ name: '山田 花子' }));
    expect(mocks.toastSuccess).toHaveBeenCalledWith(messages.settings.profile.saveSuccess);
  });

  it('refuses an empty name', async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('氏名'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(messages.settings.profile.nameRequired)
    );
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it('keeps the email read-only', () => {
    renderPage();
    expect(screen.getByLabelText('メールアドレス')).toBeDisabled();
  });
});

describe('notification preferences', () => {
  const work = messages.notifications.settings.work;

  it('lists the current sales notifications and marks the upcoming ones', () => {
    renderPage();
    expect(screen.getByText(work.description.replace('{organization}', 'テスト商事'))).toBeInTheDocument();
    for (const label of [
      work.consultationRequested,
      work.leadCreated,
      work.assignedToMe,
      work.nextActionDue,
      work.hearingNextMeeting,
    ]) {
      expect(screen.getByRole('switch', { name: label })).toBeInTheDocument();
    }
    // 自分が担当に割り当てられたとき works since #135, 次の行動の期限が来たとき since #85
    expect(screen.getAllByText(work.upcoming)).toHaveLength(1);
    expect(screen.getByText(work.nextActionDueHelp)).toBeInTheDocument();
    // The old switches that matched no current work are gone
    expect(screen.queryByText('AIによるスコアリング時')).not.toBeInTheDocument();
    expect(screen.queryByText('週次レポート')).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: work.assignedToMe })).toHaveAttribute(
      'aria-checked',
      'false'
    );
  });

  it('saves a switch for the current organization', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('switch', { name: work.consultationRequested }));
    await waitFor(() =>
      expect(mocks.updatePreferences).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        inAppConsultationRequested: false,
      })
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith(messages.notifications.settings.saved);
  });

  it('reverts the switch when saving fails', async () => {
    mocks.updatePreferences.mockRejectedValue(new Error('network'));
    renderPage();
    const toggle = screen.getByRole('switch', { name: work.leadCreated });
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(messages.notifications.settings.saveError)
    );
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });
});

describe('account deletion', () => {
  const d = messages.settings.profile.deletion;

  const openDialog = () => {
    fireEvent.click(screen.getByRole('button', { name: d.open }));
    return screen.getByRole('alertdialog');
  };

  it('explains what is deleted and what stays', () => {
    renderPage();
    expect(screen.getByText(d.removedSignIn)).toBeInTheDocument();
    expect(screen.getByText(d.keptRecords)).toBeInTheDocument();
  });

  it('is blocked for the last owner, with the organizations and a way to fix it', () => {
    mocks.soleOwned = [{ id: ORG_ID, name: 'テスト商事' }];
    renderPage();
    expect(screen.getByText(d.soleOwnerTitle)).toBeInTheDocument();
    expect(screen.getByText('テスト商事', { selector: 'li' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: d.toMembers })).toHaveAttribute(
      'href',
      '/ja/settings/members'
    );
    expect(screen.getByRole('button', { name: d.open })).toBeDisabled();
  });

  it('needs the email address and the password before deleting', () => {
    renderPage();
    const dialog = openDialog();
    const confirm = within(dialog).getByRole('button', { name: d.confirm });
    expect(confirm).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText(d.confirmLabel), {
      target: { value: 'other@example.com' },
    });
    fireEvent.change(within(dialog).getByLabelText(d.passwordLabel), {
      target: { value: 'secret-password' },
    });
    expect(confirm).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText(d.confirmLabel), {
      target: { value: EMAIL.toUpperCase() },
    });
    expect(confirm).toBeEnabled();
    expect(mocks.deleteAccount).not.toHaveBeenCalled();
  });

  const submit = async (result: DeleteResult) => {
    mocks.deleteAccount.mockResolvedValue(result);
    renderPage();
    const dialog = openDialog();
    fireEvent.change(within(dialog).getByLabelText(d.confirmLabel), { target: { value: EMAIL } });
    fireEvent.change(within(dialog).getByLabelText(d.passwordLabel), {
      target: { value: 'secret-password' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: d.confirm }));
    await waitFor(() =>
      expect(mocks.deleteAccount).toHaveBeenCalledWith({
        confirmation: EMAIL,
        password: 'secret-password',
      })
    );
    return dialog;
  };

  it('shows a wrong password next to the password field', async () => {
    const dialog = await submit({ ok: false, reason: 'invalid_password' });
    expect(await within(dialog).findByText(d.errorPassword)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(d.passwordLabel)).toHaveAttribute('aria-invalid', 'true');
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it('explains a last-owner refusal from the server and reloads the blocking list', async () => {
    const dialog = await submit({
      ok: false,
      reason: 'sole_owner',
      organizations: [{ id: ORG_ID, name: 'テスト商事' }],
    });
    expect(await within(dialog).findByText(d.errorSoleOwner)).toBeInTheDocument();
    expect(mocks.refetchSoleOwned).toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('signs out and goes to the sign-in page after deleting', async () => {
    await submit({ ok: true });
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/ja/login'));
    expect(mocks.signOut).toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalledWith(d.success);
  });
});
