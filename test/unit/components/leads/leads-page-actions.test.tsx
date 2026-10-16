/**
 * Leads page: the row menu, the side panel, status / deal phase changed from a row
 * (Refs #106, #108, #109). Real next-intl messages and UI components; the lead hooks and tRPC
 * are mocked over a small store
 */
import LeadsPage from '@/app/[locale]/(dashboard)/leads/page';
import type { Lead } from '@/lib/db/schema';
import messages from '@/locales/ja/common.json';
import { act, configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The lazily loaded page parts take longer than the 1s default on a cold, instrumented run (CI coverage)
configure({ asyncUtilTimeout: 5000 });
// The lazily loaded page parts can take several seconds on a cold CI coverage run
vi.setConfig({ testTimeout: 20000 });

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const YAMADA_ID = '22222222-2222-4222-8222-222222222222';
const SATO_ID = '33333333-3333-4333-8333-333333333333';

const makeLead = (overrides: Partial<Lead>) =>
  ({
    organizationId: ORG_ID,
    phone: null,
    status: 'new',
    score: 70,
    source: 'website',
    responses: {},
    inflowSource: null,
    conversionPoint: null,
    dealPhase: null,
    targetSystem: null,
    lostReason: null,
    referrerName: null,
    agencyName: null,
    acquisitionCost: null,
    dealPhaseReachedAt: null,
    mqlQualifiedAt: null,
    sqlDecision: null,
    sqlDecidedAt: null,
    hasNegotiated: false,
    tags: [],
    createdAt: new Date('2026-10-11T01:00:00Z'),
    updatedAt: new Date('2026-10-11T01:00:00Z'),
    ...overrides,
  }) as unknown as Lead;

// A tiny store standing in for the server: the hooks read it and the mutations change it
const store = vi.hoisted(() => {
  let leads: unknown[] = [];
  const listeners = new Set<() => void>();
  return {
    get: () => leads,
    set: (next: unknown[]) => {
      leads = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    access: { canCreate: true, canEdit: true, canDelete: true },
    updateMutate: vi.fn(),
    deleteMutate: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: store.push, replace: store.replace, prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/ja/leads',
  useSearchParams: () => new URLSearchParams(),
}));

// Like next/dynamic, each component loads behind its own boundary
vi.mock('next/dynamic', async () => {
  const { Suspense, createElement, lazy } = await import('react');
  return {
    default: (loader: Parameters<typeof lazy>[0]) => {
      const Component = lazy(loader);
      return (props: Record<string, unknown>) =>
        createElement(Suspense, { fallback: null }, createElement(Component, props));
    },
  };
});

// The assignee controls (#135) are tested in lead-assignee-select.test.tsx
vi.mock('@/hooks/use-lead-assignee', () => import('@/test/mocks/lead-assignee'));

vi.mock('@/hooks/use-organization', () => ({
  useOrganization: () => ({ organizationId: ORG_ID, isLoading: false }),
}));

vi.mock('@/hooks/use-leads', async () => {
  const { useSyncExternalStore } = await import('react');
  const useLeads = () => useSyncExternalStore(store.subscribe, store.get);
  return {
    useListLeads: () => {
      const items = useLeads();
      return { data: { items, total: items.length }, isLoading: false, refetch: vi.fn() };
    },
    useCreateLead: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useUpdateLead: () => ({ mutateAsync: store.updateMutate, isPending: false }),
    useLeadAccess: () => store.access,
    // The cards count the whole organization (#131)
    useLeadStatusCounts: () => ({ data: undefined, refetch: vi.fn() }),
    useDeleteLead: () => ({ mutateAsync: store.deleteMutate, isPending: false }),
  };
});

vi.mock('@/lib/trpc/client', async () => {
  const { useSyncExternalStore } = await import('react');
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
  return {
    trpc: {
      useUtils: () => ({}),
      useContext: () => ({}),
      leads: {
        get: {
          useQuery: (input: { id: string }, options?: { enabled?: boolean }) => {
            const leads = useSyncExternalStore(store.subscribe, store.get) as Lead[];
            const data = options?.enabled ? leads.find((lead) => lead.id === input.id) : undefined;
            return { data, isLoading: false };
          },
        },
        bulkUpdateStatus: { useMutation: mutation },
        bulkDelete: { useMutation: mutation },
        bulkCreate: { useMutation: mutation },
      },
      // The side panel's hearing and activity summaries
      leadHearings: {
        listByLead: {
          useQuery: () => ({ data: { items: [], canEdit: true }, isLoading: false, isError: false }),
        },
        summary: { useQuery: () => ({ data: undefined, isLoading: false }) },
      },
      leadActivity: {
        list: {
          useQuery: () => ({
            data: { items: [], nextCursor: null },
            isLoading: false,
            isError: false,
          }),
        },
      },
    },
  };
});

vi.mock('@/lib/features/reports/pdf-export-service', () => ({
  downloadPDF: vi.fn(),
  exportLeadsToPDF: vi.fn(),
  generatePDFFilename: vi.fn(),
}));

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  window.history.replaceState(null, '', '/ja/leads');
  store.access = { canCreate: true, canEdit: true, canDelete: true };
  store.push.mockReset();
  store.replace.mockReset();
  store.set([
    makeLead({ id: YAMADA_ID, name: '山田 太郎', email: 'yamada@example.jp', company: '三田製作所' }),
    makeLead({ id: SATO_ID, name: '佐藤 花子', email: 'sato@example.jp', company: null }),
  ]);
  store.updateMutate.mockReset();
  store.deleteMutate.mockReset();
  // Saving changes the stored lead, as the refetch after invalidation would bring back
  store.updateMutate.mockImplementation(async (input: { id: string } & Partial<Lead>) => {
    const { id, organizationId: _org, ...changes } = input as { id: string; organizationId: string };
    store.set(
      (store.get() as Lead[]).map((lead) => (lead.id === id ? { ...lead, ...changes } : lead))
    );
  });
  store.deleteMutate.mockImplementation(async (input: { id: string }) => {
    store.set((store.get() as Lead[]).filter((lead) => lead.id !== input.id));
  });
});

const renderPage = () =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <LeadsPage />
    </NextIntlClientProvider>
  );

// The table re-renders its rows while it settles, so look the row up until it is in the page
const rowOf = (name: string) =>
  waitFor(() => {
    const row = screen
      .getAllByText(name)
      .map((match) => match.closest('tr'))
      .find((match) => match?.isConnected);
    if (!row) throw new Error(`no row for ${name}`);
    return row;
  });

const openRowMenu = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  const row = await rowOf(name);
  await user.click(await within(row).findByRole('button', { name: 'メニューを開く' }));
  return screen.findByRole('menu');
};

const statusOf = async (name: string) =>
  within(await rowOf(name)).getByRole('combobox', { name: /ステータスを変更/ });

describe('LeadsPage row menu', () => {
  it('edits on the lead page, with the pipeline card open (no edit dialog)', async () => {
    const user = userEvent.setup();
    renderPage();
    const menu = await openRowMenu(user, '佐藤 花子');
    await user.click(await within(menu).findByRole('menuitem', { name: '編集' }));

    expect(store.push).toHaveBeenCalledWith(`/ja/leads/${SATO_ID}?edit=pipeline`);
    expect(screen.queryByRole('dialog', { name: 'リードを編集' })).not.toBeInTheDocument();
  });

  it('asks for confirmation and deletes only after confirming', async () => {
    const user = userEvent.setup();
    renderPage();
    let menu = await openRowMenu(user, '山田 太郎');
    await user.click(await within(menu).findByRole('menuitem', { name: '削除' }));

    let confirm = await screen.findByRole('alertdialog');
    expect(store.deleteMutate).not.toHaveBeenCalled();
    await user.click(await within(confirm).findByRole('button', { name: 'キャンセル' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(store.deleteMutate).not.toHaveBeenCalled();

    menu = await openRowMenu(user, '山田 太郎');
    await user.click(await within(menu).findByRole('menuitem', { name: '削除' }));
    confirm = await screen.findByRole('alertdialog');
    await user.click(await within(confirm).findByRole('button', { name: '削除' }));

    await waitFor(() =>
      expect(store.deleteMutate).toHaveBeenCalledWith({ id: YAMADA_ID, organizationId: ORG_ID })
    );
    await waitFor(() => expect(screen.queryByText('山田 太郎')).not.toBeInTheDocument());
  });
});

describe('LeadsPage status and deal phase in the rows', () => {
  it('changes the status from a row without opening the side panel', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await statusOf('佐藤 花子'));
    await user.click(await screen.findByRole('option', { name: 'ナーチャリング' }));

    await waitFor(() =>
      expect(store.updateMutate).toHaveBeenCalledWith({
        id: SATO_ID,
        organizationId: ORG_ID,
        status: 'nurturing',
      })
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(async () =>
      expect(await statusOf('佐藤 花子')).toHaveAccessibleName(/現在：ナーチャリング/)
    );
  });

  it('changes the deal phase from a row and goes back when saving fails', async () => {
    let fail: (error: Error) => void = () => {};
    store.updateMutate.mockImplementation(
      () =>
        new Promise((_, reject) => {
          fail = reject;
        })
    );
    const user = userEvent.setup();
    renderPage();
    const row = await rowOf('山田 太郎');
    await user.click(within(row).getByRole('combobox', { name: /商談フェーズを変更/ }));
    await user.click(await screen.findByRole('option', { name: '初回ヒアリング' }));

    expect(store.updateMutate).toHaveBeenCalledWith({
      id: YAMADA_ID,
      organizationId: ORG_ID,
      dealPhase: 'initial_hearing',
    });
    expect(
      within(await rowOf('山田 太郎')).getByRole('combobox', { name: /現在：初回ヒアリング/ })
    ).toBeInTheDocument();
    await act(async () => fail(new Error('boom')));
    await waitFor(async () =>
      expect(
        within(await rowOf('山田 太郎')).getByRole('combobox', { name: /商談フェーズを変更/ })
      ).toHaveAccessibleName(/現在：フェーズ未設定/)
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the change in the side panel', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await statusOf('山田 太郎'));
    await user.click(await screen.findByRole('option', { name: '商談中' }));
    await waitFor(() => expect(store.updateMutate).toHaveBeenCalled());

    await user.click(await screen.findByText('山田 太郎'));
    const sheet = await screen.findByRole('dialog', { name: '山田 太郎' });
    expect(
      await within(sheet).findByRole('combobox', { name: /ステータスを変更（現在：商談中）/ })
    ).toBeInTheDocument();
  });

  it('gives read-only roles plain badges and no edit or delete', async () => {
    store.access = { canCreate: false, canEdit: false, canDelete: false };
    const user = userEvent.setup();
    renderPage();
    const row = await rowOf('山田 太郎');
    expect(within(row).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(row).getByText('新規')).toBeInTheDocument();

    const menu = await openRowMenu(user, '山田 太郎');
    expect(within(menu).queryByRole('menuitem', { name: '編集' })).not.toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: '削除' })).not.toBeInTheDocument();
  });
});

describe('LeadsPage side panel', () => {
  it('titles the panel with the lead name and its company and email', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText('山田 太郎'));

    const sheet = await screen.findByRole('dialog', { name: '山田 太郎' });
    expect(sheet).toHaveAccessibleDescription('三田製作所 · yamada@example.jp');
    // The name is not repeated as a second heading
    expect(within(sheet).getAllByText('山田 太郎')).toHaveLength(1);
    expect(within(sheet).queryByText('リード詳細')).not.toBeInTheDocument();
  });

  it('leaves out a missing company from the description', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText('佐藤 花子'));

    const sheet = await screen.findByRole('dialog', { name: '佐藤 花子' });
    expect(sheet).toHaveAccessibleDescription('sato@example.jp');
  });

  it('is a light summary that leads to the lead page', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText('山田 太郎'));
    const sheet = await screen.findByRole('dialog', { name: '山田 太郎' });

    expect(await within(sheet).findByRole('link', { name: '詳細ページを開く' })).toHaveAttribute(
      'href',
      `/ja/leads/${YAMADA_ID}`
    );
    expect(within(sheet).getByRole('link', { name: 'ヒアリングを記録' })).toHaveAttribute(
      'href',
      `/ja/leads/${YAMADA_ID}?tab=hearings&record=1`
    );
    // Editing and deleting are on the page and in the row menu
    expect(within(sheet).queryByRole('button', { name: '編集' })).not.toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'その他の操作' })).not.toBeInTheDocument();
    expect(within(sheet).queryByText('未設定')).not.toBeInTheDocument();
  });

  it('has no record button for read-only roles', async () => {
    store.access = { canCreate: false, canEdit: false, canDelete: false };
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText('山田 太郎'));
    const sheet = await screen.findByRole('dialog', { name: '山田 太郎' });
    expect(await within(sheet).findByRole('link', { name: '詳細ページを開く' })).toBeInTheDocument();
    expect(within(sheet).queryByRole('link', { name: 'ヒアリングを記録' })).not.toBeInTheDocument();
  });
});

describe('LeadsPage old deep links', () => {
  it('sends /leads?leadId= to the lead page', async () => {
    window.history.replaceState(null, '', `/ja/leads?leadId=${SATO_ID}`);
    renderPage();
    await waitFor(() => expect(store.replace).toHaveBeenCalledWith(`/ja/leads/${SATO_ID}`));
  });
});
