/**
 * Leads page with the server-driven list (#131): URL <-> filters <-> leads.list input, sort
 * headers, paging, page size, quick filters, chips, the organization-wide cards and the columns.
 * The router's URL really changes; the list hook records what it was asked for.
 */
import LeadsPage from '@/app/[locale]/(dashboard)/leads/page';
import { LEAD_LIST_PREFERENCES_KEY } from '@/hooks/use-lead-list-query';
import type { Lead } from '@/lib/db/schema';
import type { ListLeadsInput } from '@/lib/features/leads/types/schemas';
import messages from '@/locales/ja/common.json';
import { act, configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

configure({ asyncUtilTimeout: 5000 });
// The lazily loaded page parts can take several seconds on a cold CI coverage run
vi.setConfig({ testTimeout: 20000 });

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const t = messages.leadList;

const makeLead = (id: string, overrides: Partial<Lead> = {}) =>
  ({
    id,
    organizationId: ORG_ID,
    name: `リード ${id}`,
    email: `${id}@example.jp`,
    company: '三田製作所',
    phone: null,
    status: 'new',
    score: 70,
    source: 'diagnostic',
    responses: {},
    inflowSource: null,
    conversionPoint: null,
    dealPhase: null,
    targetSystem: null,
    lostReason: null,
    mqlQualifiedAt: null,
    sqlDecision: null,
    hasNegotiated: false,
    tags: [],
    createdAt: new Date('2026-10-11T01:00:00Z'),
    updatedAt: new Date('2026-10-11T01:00:00Z'),
    lastActivityAt: new Date('2026-10-12T01:00:00Z'),
    ...overrides,
  }) as unknown as Lead;

const server = vi.hoisted(() => ({
  inputs: [] as ListLeadsInput[],
  items: [] as unknown[],
  total: 0,
}));

const nav = vi.hoisted(() => {
  let search = '';
  const listeners = new Set<() => void>();
  const set = (next: string) => {
    search = next;
    for (const listener of listeners) listener();
  };
  const go = (href: string) => set(href.includes('?') ? href.slice(href.indexOf('?') + 1) : '');
  return {
    get: () => search,
    set,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    push: vi.fn(go),
    replace: vi.fn(go),
  };
});

vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useRouter: () => ({ push: nav.push, replace: nav.replace, prefetch: vi.fn(), back: vi.fn() }),
    usePathname: () => '/ja/leads',
    useSearchParams: () => new URLSearchParams(useSyncExternalStore(nav.subscribe, nav.get)),
  };
});

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

vi.mock('@/hooks/use-leads', () => ({
  useListLeads: (input: ListLeadsInput) => {
    server.inputs.push(input);
    return {
      data: { items: server.items, total: server.total, limit: input.limit, offset: input.offset },
      isLoading: false,
      refetch: vi.fn(),
    };
  },
  useLeadStatusCounts: () => ({
    data: {
      total: 120,
      byStatus: { new: 40, nurturing: 30, negotiating: 20, won: 18, lost: 12 },
      averageScore: 61.4,
    },
    refetch: vi.fn(),
  }),
  useCreateLead: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateLead: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useLeadAccess: () => ({ canCreate: true, canEdit: false, canDelete: false }),
  useDeleteLead: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/lib/trpc/client', () => {
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
  return {
    trpc: {
      useUtils: () => ({}),
      useContext: () => ({}),
      leads: {
        get: { useQuery: () => ({ data: undefined, isLoading: false }) },
        bulkUpdateStatus: { useMutation: mutation },
        bulkDelete: { useMutation: mutation },
        bulkCreate: { useMutation: mutation },
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

const setWidth = (width: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  window.dispatchEvent(new Event('resize'));
};

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, '', '/ja/leads');
  setWidth(1024);
  nav.set('');
  nav.push.mockClear();
  nav.replace.mockClear();
  server.inputs.length = 0;
  server.items = [makeLead('a1'), makeLead('a2', { name: '佐藤 花子', source: 'api' })];
  server.total = 45;
});

afterEach(() => setWidth(1024));

const renderPage = (search = '') => {
  nav.set(search);
  return render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <LeadsPage />
    </NextIntlClientProvider>
  );
};

const lastInput = () => server.inputs.at(-1);
const table = () => screen.findByRole('table');
const headerOf = async (name: string) =>
  within(await table())
    .getAllByRole('columnheader')
    .find((th) => th.textContent?.includes(name));

describe('LeadsPage list (server-driven)', () => {
  it('asks the server for what the URL says', async () => {
    renderPage('status=new,won&inflow=seminar&sort=score&order=asc&page=2&q=山田');
    await table();
    expect(lastInput()).toEqual({
      organizationId: ORG_ID,
      limit: 20,
      offset: 20,
      sortBy: 'score',
      sortOrder: 'asc',
      status: ['new', 'won'],
      inflowSource: ['seminar'],
      search: '山田',
    });
    const chips = within(screen.getByRole('group', { name: t.chips.label }));
    expect(chips.getByText('状態：新規')).toBeInTheDocument();
    expect(chips.getByText('流入元：勉強会・セミナー')).toBeInTheDocument();
    expect(screen.getByText('45件')).toBeInTheDocument();
  });

  it('sorts from the column headers, on the server', async () => {
    const user = userEvent.setup();
    renderPage('page=3');
    const name = await headerOf('名前');
    expect(name).toHaveAttribute('aria-sort', 'none');
    expect(await headerOf('作成日')).toHaveAttribute('aria-sort', 'descending');

    await user.click(within(name as HTMLElement).getByRole('button'));
    expect(nav.push).toHaveBeenLastCalledWith('/ja/leads?sort=name&order=asc', { scroll: false });
    await waitFor(() => expect(lastInput()).toMatchObject({ sortBy: 'name', sortOrder: 'asc', offset: 0 }));
    expect(await headerOf('名前')).toHaveAttribute('aria-sort', 'ascending');
  });

  it('pages with the server total and keeps the page size per browser', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText('1 / 3')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '次へ' }));
    expect(nav.push).toHaveBeenLastCalledWith('/ja/leads?page=2', { scroll: false });
    await waitFor(() => expect(lastInput()).toMatchObject({ offset: 20, limit: 20 }));
    expect(screen.getByText('2 / 3')).toBeInTheDocument();

    // Page size: remembered, and back to page 1
    await user.click(screen.getByRole('combobox', { name: t.pageSize }));
    await user.click(await screen.findByRole('option', { name: '50' }));
    await waitFor(() => expect(lastInput()).toMatchObject({ offset: 0, limit: 50 }));
    expect(nav.get()).toBe('');
    expect(JSON.parse(window.localStorage.getItem(LEAD_LIST_PREFERENCES_KEY) ?? '{}')).toMatchObject({
      pageSize: 50,
    });
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
  });

  it('goes to the last page when the URL points past the end', async () => {
    renderPage('page=9');
    await table();
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/ja/leads?page=3', { scroll: false }));
  });

  it('applies a quick filter and removes chips one by one', async () => {
    const user = userEvent.setup();
    renderPage('page=2');
    await table();
    await user.click(screen.getByRole('button', { name: t.presets.negotiating }));
    await waitFor(() =>
      expect(lastInput()).toMatchObject({ status: ['negotiating'], offset: 0 })
    );
    const chips = within(screen.getByRole('group', { name: t.chips.label }));
    await user.click(chips.getByRole('button', { name: '条件「状態：商談中」を外す' }));
    await waitFor(() => expect(lastInput()?.status).toBeUndefined());
    expect(nav.get()).toBe('');
  });

  it('says that nothing matches, with a way to clear the filters', async () => {
    const user = userEvent.setup();
    server.items = [];
    server.total = 0;
    renderPage('status=lost&mql=1');
    expect(await screen.findByText(t.noMatches)).toBeInTheDocument();
    expect(screen.queryByText(messages.leads.noLeads)).not.toBeInTheDocument();
    const cell = screen.getByText(t.noMatches).closest('td') as HTMLElement;
    await user.click(within(cell).getByRole('button', { name: t.chips.clearAll }));
    expect(nav.get()).toBe('');
  });

  it('counts the whole organization on the cards, each opening a filtered list', async () => {
    renderPage('status=lost');
    await table();
    const cards = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('href')?.startsWith('/ja/leads'));
    expect(cards.map((link) => link.getAttribute('href'))).toEqual([
      '/ja/leads',
      '/ja/leads?status=nurturing%2Cnegotiating',
      '/ja/leads?status=won',
      '/ja/leads?sort=score&order=desc',
    ]);
    expect(within(cards[0]).getByText('120')).toBeInTheDocument();
    expect(within(cards[1]).getByText('50')).toBeInTheDocument();
    expect(within(cards[2]).getByText('15.0%')).toBeInTheDocument();
    expect(within(cards[3]).getByText('61')).toBeInTheDocument();
  });

  it('shows the source translated', async () => {
    renderPage();
    const tbody = within(await table());
    expect(tbody.getByText('Web診断')).toBeInTheDocument();
    expect(tbody.getByText('API')).toBeInTheDocument();
    expect(tbody.queryByText('diagnostic')).not.toBeInTheDocument();
  });

  it('hides the email at 1024px so the status fits, and remembers when it is shown again', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await headerOf('メールアドレス')).toBeUndefined();
    expect(await headerOf('ステータス')).toBeDefined();
    // Optional columns are off by default
    expect(await headerOf(t.sort.lastActivityAt)).toBeUndefined();

    // The columns menu closes after each choice
    await user.click(screen.getByRole('button', { name: messages.common.columns }));
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'メールアドレス' }));
    await user.click(screen.getByRole('button', { name: messages.common.columns }));
    await user.click(await screen.findByRole('menuitemcheckbox', { name: t.sort.lastActivityAt }));
    expect(await headerOf('メールアドレス')).toBeDefined();
    expect(await headerOf(t.sort.lastActivityAt)).toBeDefined();
    expect(
      JSON.parse(window.localStorage.getItem(LEAD_LIST_PREFERENCES_KEY) ?? '{}').columnVisibility
    ).toEqual({ email: true, lastActivityAt: true });
  });

  it('shows the email by default on wide screens', async () => {
    renderPage();
    await table();
    act(() => setWidth(1440));
    await waitFor(async () => expect(await headerOf('メールアドレス')).toBeDefined());
  });

  it('keeps the header buttons', async () => {
    renderPage();
    await table();
    expect(screen.getByRole('button', { name: messages.leads.createLead })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: messages.common.import })).toBeInTheDocument();
  });
});
