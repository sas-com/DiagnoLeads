/**
 * Create organization form (real next-intl messages, tRPC mocked)
 */
import {
  CreateOrganizationForm,
  suggestSlug,
} from '@/components/features/organizations/create-organization-form';
import messages from '@/locales/ja/common.json';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type MutationOptions = {
  onSuccess: (organization: { id: string; name: string; slug: string }) => Promise<void>;
  onError: (error: { data?: { code?: string } }) => void;
};

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  invalidate: vi.fn(),
  push: vi.fn(),
  setOrganization: vi.fn(),
  toastSuccess: vi.fn(),
  options: {} as { current?: MutationOptions },
}));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({ organizations: { list: { invalidate: mocks.invalidate } } }),
    organizations: {
      create: {
        useMutation: (options: MutationOptions) => {
          mocks.options.current = options;
          return { mutate: mocks.mutate, isPending: false };
        },
      },
    },
  },
}));
vi.mock('@/hooks/use-organization', () => ({
  useOrganization: () => ({ setOrganization: mocks.setOrganization }),
}));
vi.mock('next/navigation', () => {
  // One object for every render, like Next's useRouter (#636)
  const router = { push: mocks.push };
  return { useRouter: () => router };
});
vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess } }));

const renderForm = () =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <CreateOrganizationForm />
    </NextIntlClientProvider>
  );

describe('suggestSlug', () => {
  it('turns an ASCII name into a slug', () => {
    expect(suggestSlug('  SAS Sales & Marketing ')).toBe('sas-sales-marketing');
  });

  it('leaves names in other scripts to the user', () => {
    expect(suggestSlug('株式会社サンプル')).toBe('');
  });
});

describe('CreateOrganizationForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.options.current = undefined;
  });

  it('suggests the slug from the name until the slug is edited', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText('組織名'), 'AX Desk');
    expect(screen.getByLabelText('組織スラッグ')).toHaveValue('ax-desk');

    await user.clear(screen.getByLabelText('組織スラッグ'));
    await user.type(screen.getByLabelText('組織スラッグ'), 'AX_Team 1');
    // Uppercase is lowered and characters outside [a-z0-9-] are dropped
    expect(screen.getByLabelText('組織スラッグ')).toHaveValue('axteam1');

    await user.type(screen.getByLabelText('組織名'), ' Japan');
    expect(screen.getByLabelText('組織スラッグ')).toHaveValue('axteam1');
  });

  it('asks for the name and the slug before submitting', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: '作成する' }));

    expect(screen.getByText('組織名を入力してください')).toBeInTheDocument();
    expect(screen.getByText('組織スラッグを入力してください')).toBeInTheDocument();
    expect(screen.getByLabelText('組織名')).toHaveAttribute('aria-invalid', 'true');
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('requires a slug when none can be suggested from the name', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText('組織名'), '株式会社サンプル');
    expect(screen.getByLabelText('組織スラッグ')).toHaveValue('');

    await user.click(screen.getByRole('button', { name: '作成する' }));
    expect(screen.getByText('組織スラッグを入力してください')).toBeInTheDocument();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('creates the organization, selects it and opens the lead list', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText('組織名'), '  AX診断受付 ');
    await user.clear(screen.getByLabelText('組織スラッグ'));
    await user.type(screen.getByLabelText('組織スラッグ'), 'ax-desk');
    await user.click(screen.getByRole('button', { name: '作成する' }));

    expect(mocks.mutate).toHaveBeenCalledWith({ name: 'AX診断受付', slug: 'ax-desk' });

    const organization = { id: 'org-1', name: 'AX診断受付', slug: 'ax-desk' };
    await mocks.options.current?.onSuccess(organization);

    expect(mocks.setOrganization).toHaveBeenCalledWith('org-1', organization);
    expect(mocks.invalidate).toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalledWith('「AX診断受付」を作成しました');
    expect(mocks.push).toHaveBeenCalledWith('/ja/leads');
  });

  it('points at the slug when it is already taken', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText('組織名'), 'ax');
    await user.click(screen.getByRole('button', { name: '作成する' }));
    mocks.options.current?.onError({ data: { code: 'CONFLICT' } });

    expect(
      await screen.findByText('このスラッグは既に使われています。別のスラッグを指定してください。')
    ).toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('shows a general error for other failures', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText('組織名'), 'ax');
    await user.click(screen.getByRole('button', { name: '作成する' }));
    mocks.options.current?.onError({ data: { code: 'INTERNAL_SERVER_ERROR' } });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '組織を作成できませんでした。時間をおいてもう一度お試しください。'
    );
  });
});
