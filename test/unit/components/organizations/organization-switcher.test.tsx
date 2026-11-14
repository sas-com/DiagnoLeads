/**
 * Organization switcher (real next-intl messages, tRPC and organization context mocked)
 */
import { OrganizationSwitcher } from '@/components/dashboard/organization-switcher';
import messages from '@/locales/ja/common.json';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_A = { id: 'org-a', name: 'AX診断受付', slug: 'ax-desk', role: 'owner' };
const ORG_B = { id: 'org-b', name: '営業部', slug: 'sales', role: 'member' };

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  invalidate: vi.fn(),
  setOrganization: vi.fn(),
  list: { data: undefined, isLoading: false } as {
    data: unknown;
    isLoading: boolean;
    isFetching?: boolean;
  },
  context: {
    organizationId: null as string | null,
    organization: null as unknown,
    isLoading: false,
  },
}));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({ invalidate: mocks.invalidate }),
    organizations: { list: { useQuery: () => mocks.list } },
  },
}));
vi.mock('@/hooks/use-organization', () => ({
  useOrganization: () => ({ ...mocks.context, setOrganization: mocks.setOrganization }),
}));
vi.mock('next/navigation', () => {
  // One object for every render, like Next's useRouter (#636)
  const router = { push: mocks.push };
  return { useRouter: () => router };
});

const renderSwitcher = () =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <OrganizationSwitcher />
    </NextIntlClientProvider>
  );

describe('OrganizationSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list = { data: { organizations: [ORG_A, ORG_B] }, isLoading: false };
    mocks.context = { organizationId: null, organization: null, isLoading: false };
  });

  it('offers to create an organization when the user has none', async () => {
    mocks.list = { data: { organizations: [] }, isLoading: false };
    const user = userEvent.setup();
    renderSwitcher();

    await user.click(screen.getByRole('button', { name: '組織を作成' }));

    expect(mocks.push).toHaveBeenCalledWith('/ja/organizations/new');
    expect(mocks.setOrganization).not.toHaveBeenCalled();
  });

  it('selects the first organization when none is selected', async () => {
    renderSwitcher();

    await waitFor(() => expect(mocks.setOrganization).toHaveBeenCalledWith('org-a', ORG_A));
  });

  it('replaces a stored organization the user does not belong to', async () => {
    mocks.context = { organizationId: 'org-from-another-account', organization: null, isLoading: false };
    renderSwitcher();

    await waitFor(() => expect(mocks.setOrganization).toHaveBeenCalledWith('org-a', ORG_A));
  });

  it('keeps a valid selection and shows its name and translated roles', () => {
    mocks.context = { organizationId: 'org-b', organization: ORG_B, isLoading: false };
    renderSwitcher();

    expect(mocks.setOrganization).not.toHaveBeenCalled();
    expect(screen.getByTestId('current-org-name')).toHaveTextContent('営業部');
    expect(screen.getByText('オーナー')).toBeInTheDocument();
    expect(screen.getByText('メンバー')).toBeInTheDocument();
  });

  it.each([
    ['none, as an invite accepted leaves it', null],
    ["another organization's", ORG_A],
  ])('gives a selection made by its id alone its data, with %s (#1046)', async (_case, data) => {
    mocks.context = { organizationId: 'org-b', organization: data, isLoading: false };
    renderSwitcher();

    // The same organization, with its data from the list: not another one
    await waitFor(() => expect(mocks.setOrganization).toHaveBeenCalledWith('org-b', ORG_B));
    expect(mocks.setOrganization).toHaveBeenCalledTimes(1);
  });

  it('waits for the list read again before it replaces a selection, as one just created (#1046)', () => {
    const created = { id: 'org-new', name: '新しい組織', slug: 'new', role: 'owner' };
    mocks.context = { organizationId: 'org-new', organization: created, isLoading: false };
    // The list read before, without it, while it is read again
    mocks.list = { data: { organizations: [ORG_A, ORG_B] }, isLoading: false, isFetching: true };
    const { rerender } = renderSwitcher();
    expect(mocks.setOrganization).not.toHaveBeenCalled();

    mocks.list = {
      data: { organizations: [ORG_A, ORG_B, created] },
      isLoading: false,
      isFetching: false,
    };
    rerender(
      <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
        <OrganizationSwitcher />
      </NextIntlClientProvider>
    );
    expect(mocks.setOrganization).not.toHaveBeenCalled();
  });

  it('waits for the stored selection before choosing one', () => {
    mocks.context = { organizationId: null, organization: null, isLoading: true };
    renderSwitcher();

    expect(mocks.setOrganization).not.toHaveBeenCalled();
  });

  it('switches organizations and clears cached data', async () => {
    mocks.context = { organizationId: 'org-a', organization: null, isLoading: false };
    const user = userEvent.setup();
    renderSwitcher();

    await user.click(screen.getByTestId('organization-switcher'));
    await user.click(screen.getByTestId('org-item-org-b'));

    expect(mocks.setOrganization).toHaveBeenCalledWith('org-b', ORG_B);
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/ja/office?source=home'));
    expect(mocks.invalidate).toHaveBeenCalled();
  });

  it('links to the create page from the menu', async () => {
    mocks.context = { organizationId: 'org-a', organization: null, isLoading: false };
    const user = userEvent.setup();
    renderSwitcher();

    await user.click(screen.getByTestId('organization-switcher'));
    await user.click(screen.getByRole('button', { name: '新しい組織を作成' }));

    expect(mocks.push).toHaveBeenCalledWith('/ja/organizations/new');
  });
});
