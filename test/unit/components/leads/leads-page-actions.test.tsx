/**
 * Leads page: the row menu's edit/delete, the details after saving, the details header (Refs #106)
 * Real next-intl messages and UI components; the lead hooks and tRPC are mocked over a small store
 */
import LeadsPage from '@/app/[locale]/(dashboard)/leads/page';
import type { Lead } from '@/lib/db/schema';
import messages from '@/locales/ja/common.json';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
    updateMutate: vi.fn(),
    deleteMutate: vi.fn(),
  };
});

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
    },
  };
});

// Cards with their own queries, not under test here
vi.mock('@/components/features/lead-hearings/lead-hearings-card', () => ({
  LeadHearingsCard: () => null,
}));
vi.mock('@/components/features/lead-activity/lead-activity-card', () => ({
  LeadActivityCard: () => null,
}));
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
  await user.click(within(row).getByRole('button', { name: 'メニューを開く' }));
  return screen.findByRole('menu');
};

describe('LeadsPage row menu', () => {
  it('opens the edit dialog for the lead the menu belongs to', async () => {
    const user = userEvent.setup();
    renderPage();
    const menu = await openRowMenu(user, '佐藤 花子');
    await user.click(within(menu).getByRole('menuitem', { name: '編集' }));

    const dialog = await screen.findByRole('dialog', { name: 'リードを編集' });
    expect(within(dialog).getByRole('textbox', { name: /メール/ })).toHaveValue('sato@example.jp');
  });

  it('asks for confirmation and deletes only after confirming', async () => {
    const user = userEvent.setup();
    renderPage();
    let menu = await openRowMenu(user, '山田 太郎');
    await user.click(within(menu).getByRole('menuitem', { name: '削除' }));

    let confirm = await screen.findByRole('alertdialog');
    expect(store.deleteMutate).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole('button', { name: 'キャンセル' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(store.deleteMutate).not.toHaveBeenCalled();

    menu = await openRowMenu(user, '山田 太郎');
    await user.click(within(menu).getByRole('menuitem', { name: '削除' }));
    confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: '削除' }));

    await waitFor(() =>
      expect(store.deleteMutate).toHaveBeenCalledWith({ id: YAMADA_ID, organizationId: ORG_ID })
    );
    await waitFor(() => expect(screen.queryByText('山田 太郎')).not.toBeInTheDocument());
  });
});

describe('LeadsPage details', () => {
  it('titles the details with the lead name and its company and email', async () => {
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

  it('keeps the details open after saving and shows the saved values', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText('山田 太郎'));
    const sheet = await screen.findByRole('dialog', { name: '山田 太郎' });

    await user.click(within(sheet).getByRole('button', { name: '編集' }));
    const dialog = await screen.findByRole('dialog', { name: 'リードを編集' });
    const company = within(dialog).getByRole('textbox', { name: /^会社名/ });
    await user.clear(company);
    await user.type(company, '三田製作所 東京支店');
    await user.click(within(dialog).getByRole('button', { name: '更新' }));

    await waitFor(() =>
      expect(store.updateMutate).toHaveBeenCalledWith({
        company: '三田製作所 東京支店',
        id: YAMADA_ID,
        organizationId: ORG_ID,
      })
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'リードを編集' })).not.toBeInTheDocument()
    );
    const reopened = screen.getByRole('dialog', { name: '山田 太郎' });
    expect(reopened).toHaveAccessibleDescription('三田製作所 東京支店 · yamada@example.jp');
    expect(within(reopened).getByText('三田製作所 東京支店')).toBeInTheDocument();
  });

  it('puts delete in the more-actions menu, confirms it, then closes the details', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText('山田 太郎'));
    const sheet = await screen.findByRole('dialog', { name: '山田 太郎' });

    // Edit is the only visible action button; delete is not a button of its own
    expect(within(sheet).queryByRole('button', { name: '削除' })).not.toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'その他の操作' }));
    const menu = await screen.findByRole('menu');
    await user.click(within(menu).getByRole('menuitem', { name: '削除' }));

    const confirm = await screen.findByRole('alertdialog');
    expect(store.deleteMutate).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole('button', { name: '削除' }));

    await waitFor(() =>
      expect(store.deleteMutate).toHaveBeenCalledWith({ id: YAMADA_ID, organizationId: ORG_ID })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // The page is usable again after the menu and the two dialogs
    expect(document.body.style.pointerEvents).not.toBe('none');
  });
});
