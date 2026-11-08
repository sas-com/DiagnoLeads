/**
 * The first-day checklist on the dashboard (#875): the list for the role, items found done in the
 * organization's data, items marked done by hand, and closing it for good in this browser.
 */
import { OnboardingChecklist } from '@/components/features/help/onboarding-checklist';
import { onboardingStorageKey } from '@/lib/features/help/onboarding';
import messages from '@/locales/ja/common.json';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG = '660e8400-e29b-41d4-a716-446655440000';

const mocks = vi.hoisted(() => ({
  role: 'owner' as string,
  intake: [] as string[],
  memberTotal: 1,
  invitations: [] as { expired: boolean }[],
  playbookUpdatedAt: null as string | null,
  links: [] as unknown[],
  queried: [] as string[],
}));
// A tRPC query that records what was read, and returns nothing while disabled
const { query } = vi.hoisted(() => ({
  query: (name: string, data: () => unknown) => ({
    useQuery: (_input: unknown, options?: { enabled?: boolean }) => {
      if (options?.enabled !== false) mocks.queried.push(name);
      return { data: options?.enabled === false ? undefined : data() };
    },
  }),
}));
vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    organizations: { getById: query('organization', () => ({ role: mocks.role })) },
    leads: { intake: query('intake', () => ({ userIds: mocks.intake, canEdit: true })) },
    members: {
      list: query('members', () => ({ members: [], total: mocks.memberTotal })),
      listInvitations: query('invitations', () => mocks.invitations),
    },
    axPlaybook: { get: query('playbook', () => ({ updatedAt: mocks.playbookUpdatedAt })) },
    agencyLinks: { list: query('links', () => ({ links: mocks.links })) },
  },
}));

const renderList = () =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <OnboardingChecklist organizationId={ORG} />
    </NextIntlClientProvider>
  );

const item = (name: string) => {
  const title = screen.getByText(name, { exact: false });
  const row = title.closest('li');
  if (!row) throw new Error(`no row for ${name}`);
  return row;
};

beforeEach(() => {
  localStorage.clear();
  Object.assign(mocks, {
    role: 'owner',
    intake: [],
    memberTotal: 1,
    invitations: [],
    playbookUpdatedAt: null,
    links: [],
    queried: [],
  });
});

describe('OnboardingChecklist', () => {
  it('shows the setup steps to an owner, done where the data says so', () => {
    mocks.intake = ['u1'];
    mocks.invitations = [{ expired: false }];
    renderList();
    expect(screen.getByRole('heading', { name: 'はじめに設定すること' })).toBeInTheDocument();
    expect(screen.getByText('5件のうち2件が済みました')).toBeInTheDocument();
    expect(item('相談申込の窓口を決める')).toHaveTextContent('（済み）');
    expect(item('メンバーを招待する')).toHaveTextContent('（済み）');
    expect(item('営業の手引きを登録する')).toHaveTextContent('（未完了）');
    // A step found done in the data cannot be undone by hand
    expect(within(item('相談申込の窓口を決める')).queryByRole('button')).not.toBeInTheDocument();
    expect(within(item('メンバーを招待する')).getByRole('link', { name: '開く' })).toHaveAttribute(
      'href',
      '/ja/settings/members'
    );
    expect(
      within(item('メンバーを招待する')).getByRole('link', { name: '「メンバーを招待する」の使い方' })
    ).toHaveAttribute('href', '/ja/help/settings-members#invite');
  });

  it('does not count an expired invitation', () => {
    mocks.invitations = [{ expired: true }];
    renderList();
    expect(item('メンバーを招待する')).toHaveTextContent('（未完了）');
  });

  it('shows the first steps to a member, without reading the setup data', () => {
    mocks.role = 'member';
    renderList();
    expect(screen.getByRole('heading', { name: 'はじめにやること' })).toBeInTheDocument();
    expect(item('今日の画面を見る')).toBeInTheDocument();
    expect(screen.queryByText('メンバーを招待する')).not.toBeInTheDocument();
    expect(mocks.queried).toEqual(expect.not.arrayContaining(['members', 'playbook', 'links']));
  });

  it('shows nothing to a parent organization viewer', () => {
    mocks.role = 'parent_viewer';
    const { container } = renderList();
    expect(container).toBeEmptyDOMElement();
  });

  it('remembers a step marked done by hand', async () => {
    mocks.role = 'member';
    const { unmount } = renderList();
    await userEvent.click(screen.getByRole('button', { name: '「今日の画面を見る」を済みにする' }));
    expect(item('今日の画面を見る')).toHaveTextContent('（済み）');
    expect(screen.getByText('4件のうち1件が済みました')).toBeInTheDocument();
    unmount();

    renderList();
    expect(item('今日の画面を見る')).toHaveTextContent('（済み）');
    await userEvent.click(screen.getByRole('button', { name: '「今日の画面を見る」を未完了に戻す' }));
    expect(item('今日の画面を見る')).toHaveTextContent('（未完了）');
  });

  it('stays closed once closed, for this organization only', async () => {
    const { unmount } = renderList();
    await userEvent.click(screen.getByRole('button', { name: 'このリストを閉じる' }));
    expect(screen.queryByRole('heading', { name: 'はじめに設定すること' })).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(onboardingStorageKey(ORG)) ?? '{}')).toMatchObject({
      dismissed: true,
    });
    unmount();

    mocks.queried = [];
    const { container } = renderList();
    expect(container).toBeEmptyDOMElement();
    expect(mocks.queried).toEqual([]);
  });

  it('says so when every step is done', () => {
    mocks.role = 'member';
    localStorage.setItem(
      onboardingStorageKey(ORG),
      JSON.stringify({ dismissed: false, done: ['today', 'leads', 'nextActions', 'deals'] })
    );
    renderList();
    expect(screen.getByText(/すべて済みました/)).toBeInTheDocument();
  });
});
