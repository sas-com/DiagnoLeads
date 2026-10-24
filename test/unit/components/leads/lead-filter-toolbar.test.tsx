/**
 * Lead list toolbar, chips, mobile Sheet and sortable header (#131), driven through
 * useLeadListQuery with a mocked Next router whose URL really changes, with the real ja messages.
 */
import { LeadFilterChips } from '@/components/features/leads/list/lead-filter-chips';
import { LeadFilterToolbar } from '@/components/features/leads/list/lead-filter-toolbar';
import { SortableHeader, ariaSortFor } from '@/components/features/leads/list/sortable-header';
import { useLeadListQuery } from '@/hooks/use-lead-list-query';
import messages from '@/locales/ja/common.json';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Menus and popovers render slowly on a cold CI coverage run
vi.setConfig({ testTimeout: 20000 });

// A router whose URL changes on push / replace, so the hook re-reads it like in the app
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
    go,
  };
});

// The assignee controls (#135) are tested in lead-assignee-select.test.tsx
vi.mock('@/hooks/use-lead-assignee', () => import('@/test/mocks/lead-assignee'));

vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useRouter: () => ({ push: nav.push, replace: nav.replace, prefetch: vi.fn(), back: vi.fn() }),
    usePathname: () => '/ja/leads',
    useSearchParams: () => new URLSearchParams(useSyncExternalStore(nav.subscribe, nav.get)),
  };
});

// Friday 2026-10-16 15:00 JST: this week starts on Monday 10/12
const NOW = new Date('2026-10-16T06:00:00Z');
const t = messages.leadList;

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});

beforeEach(() => {
  nav.set('');
  nav.push.mockClear();
  nav.replace.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

function withIntl(children: ReactNode) {
  return (
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      {children}
    </NextIntlClientProvider>
  );
}

const SEARCH_PAUSE_MS = 30;

function Toolbar({ total = 12 }: { total?: number }) {
  const controller = useLeadListQuery({ searchDebounceMs: SEARCH_PAUSE_MS, now: () => NOW });
  return (
    <>
      <LeadFilterToolbar controller={controller} total={total} />
      <table>
        <thead>
          <tr>
            <th aria-sort={ariaSortFor(controller.sort, 'name')}>
              <SortableHeader
                label="名前"
                column="name"
                sort={controller.sort}
                onSort={controller.toggleSort}
              />
            </th>
          </tr>
        </thead>
      </table>
    </>
  );
}

function renderAt(search: string, total?: number) {
  nav.set(search);
  return render(withIntl(<Toolbar total={total} />));
}

const chipGroup = () => screen.getByRole('group', { name: t.chips.label });
const lastHref = () => nav.push.mock.calls.at(-1)?.[0];

describe('LeadFilterToolbar', () => {
  it('shows the filters of the URL as chips and the result count', () => {
    renderAt('status=new&consult=1', 12);
    const chips = within(chipGroup());
    expect(chips.getByText('状態：新規')).toBeInTheDocument();
    expect(chips.getByText('相談申込あり')).toBeInTheDocument();
    expect(screen.getByText('12件')).toBeInTheDocument();
  });

  it('shows no chips without filters', () => {
    renderAt('');
    expect(screen.queryByRole('group', { name: t.chips.label })).not.toBeInTheDocument();
  });

  it('removes one chip, keeping the others and going back to page 1', async () => {
    const user = userEvent.setup();
    renderAt('status=new,won&consult=1&page=3');
    await user.click(screen.getByRole('button', { name: '条件「状態：新規」を外す' }));
    expect(lastHref()).toBe('/ja/leads?status=won&consult=1');
    const chips = within(chipGroup());
    expect(chips.queryByText('状態：新規')).not.toBeInTheDocument();
    expect(chips.getByText('状態：成約')).toBeInTheDocument();
    expect(chips.getByText('相談申込あり')).toBeInTheDocument();
  });

  it('clears all filters but keeps the sort and other params', async () => {
    const user = userEvent.setup();
    renderAt('leadId=abc&status=new&scoreMin=40&q=山田&sort=name&order=asc');
    await user.click(within(chipGroup()).getByRole('button', { name: t.chips.clearAll }));
    expect(lastHref()).toBe('/ja/leads?leadId=abc&sort=name&order=asc');
    expect(screen.queryByRole('group', { name: t.chips.label })).not.toBeInTheDocument();
    // The search box follows the URL
    expect(screen.getByRole('searchbox', { name: t.searchLabel })).toHaveValue('');
  });

  it('applies a quick filter and shows it as pressed; pressing it again clears it', async () => {
    const user = userEvent.setup();
    renderAt('status=lost&page=2');
    const presets = within(screen.getByRole('group', { name: t.presetsLabel }));
    const thisWeek = presets.getByRole('button', { name: t.presets.newThisWeek });
    expect(thisWeek).toHaveAttribute('aria-pressed', 'false');
    // 44px tall on phones, compact from md (#196)
    for (const button of presets.getAllByRole('button')) {
      expect(button).toHaveClass('h-9', 'min-h-11', 'md:min-h-0');
    }

    await user.click(thisWeek);
    expect(lastHref()).toBe('/ja/leads?from=2026-10-12');
    expect(thisWeek).toHaveAttribute('aria-pressed', 'true');
    expect(within(chipGroup()).getByText('作成日 2026/10/12 以降')).toBeInTheDocument();

    await user.click(thisWeek);
    expect(lastHref()).toBe('/ja/leads');
    expect(thisWeek).toHaveAttribute('aria-pressed', 'false');
  });

  it.each([
    ['needsAction', '/ja/leads?status=new'],
    ['consultation', '/ja/leads?consult=1'],
    ['negotiating', '/ja/leads?status=negotiating'],
  ] as const)('applies the %s quick filter', async (preset, href) => {
    const user = userEvent.setup();
    renderAt('inflow=seminar');
    await user.click(screen.getByRole('button', { name: t.presets[preset] }));
    expect(lastHref()).toBe(href);
  });

  it('adds a chip when a value is picked in a multi-select', async () => {
    const user = userEvent.setup();
    renderAt('');
    await user.click(screen.getByRole('button', { name: t.inflowSource }));
    await user.click(await screen.findByRole('menuitemcheckbox', { name: '勉強会・セミナー' }));
    expect(lastHref()).toBe('/ja/leads?inflow=seminar');
    // The menu stays open to pick another value
    await user.click(screen.getByRole('menuitemcheckbox', { name: '広告' }));
    expect(lastHref()).toBe('/ja/leads?inflow=seminar%2Cadvertising');
    await user.keyboard('{Escape}');
    const chips = within(chipGroup());
    expect(chips.getByText('流入元：勉強会・セミナー')).toBeInTheDocument();
    expect(chips.getByText('流入元：広告')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `${t.inflowSource} (2件選択)` })).toBeInTheDocument();
  });

  it('offers no score range, but a shared link with one still shows a removable chip (#447)', () => {
    renderAt('scoreMin=40');
    expect(screen.queryByRole('button', { name: t.score })).not.toBeInTheDocument();
    expect(within(chipGroup()).getByText('スコア 40 以上')).toBeInTheDocument();
  });

  it('turns on a condition from "more conditions"', async () => {
    const user = userEvent.setup();
    renderAt('');
    await user.click(screen.getByRole('button', { name: t.more }));
    await user.click(await screen.findByRole('menuitemcheckbox', { name: t.mql }));
    expect(lastHref()).toBe('/ja/leads?mql=1');
  });

  it('sends the search after a pause, replacing the history entry', () => {
    // The pause runs on a fake clock. On the real one, a busy machine let the pause pass between
    // two keys or before the first check, and the search went out early (#573). user-event waits
    // on setTimeout itself, so the keys are sent with fireEvent
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    renderAt('status=new&page=2');
    const box = screen.getByRole('searchbox', { name: t.searchLabel });
    fireEvent.change(box, { target: { value: '山' } });
    act(() => vi.advanceTimersByTime(SEARCH_PAUSE_MS - 1));
    // Each key starts the pause again
    fireEvent.change(box, { target: { value: '山田' } });
    act(() => vi.advanceTimersByTime(SEARCH_PAUSE_MS - 1));
    expect(nav.replace).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenLastCalledWith('/ja/leads?status=new&q=%E5%B1%B1%E7%94%B0', {
      scroll: false,
    });
    expect(nav.push).not.toHaveBeenCalled();
    expect(within(chipGroup()).getByText('検索：山田')).toBeInTheDocument();
  });

  it('follows the URL when it changes from outside (back button)', async () => {
    renderAt('status=new&q=abc');
    expect(screen.getByRole('searchbox', { name: t.searchLabel })).toHaveValue('abc');
    act(() => nav.set('status=won'));
    expect(within(chipGroup()).getByText('状態：成約')).toBeInTheDocument();
    expect(within(chipGroup()).queryByText('状態：新規')).not.toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: t.searchLabel })).toHaveValue('');
  });

  it('sorts from the column header and shows the order', async () => {
    const user = userEvent.setup();
    renderAt('status=new&page=4');
    const header = screen.getByRole('columnheader');
    expect(header).toHaveAttribute('aria-sort', 'none');
    await user.click(screen.getByRole('button', { name: /名前で並び替え/ }));
    expect(lastHref()).toBe('/ja/leads?status=new&sort=name&order=asc');
    expect(header).toHaveAttribute('aria-sort', 'ascending');
    await user.click(screen.getByRole('button', { name: /名前：昇順で並んでいます/ }));
    expect(lastHref()).toBe('/ja/leads?status=new&sort=name&order=desc');
    expect(header).toHaveAttribute('aria-sort', 'descending');
  });

  it('opens the filters in a Sheet on small screens', async () => {
    const user = userEvent.setup();
    renderAt('status=new', 7);
    await user.click(screen.getByRole('button', { name: /^絞り込み/ }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText(t.filtersDescription)).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: t.chips.clearAll }));
    expect(lastHref()).toBe('/ja/leads');
    await user.click(within(sheet).getByRole('button', { name: '7件を表示' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('LeadFilterChips', () => {
  it('calls back with the removed chip and for clear all', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    const onClearAll = vi.fn();
    render(
      withIntl(
        <LeadFilterChips
          chips={[
            { kind: 'targetSystem', value: 'as400' },
            { kind: 'score', min: 40, max: 80 },
            { kind: 'created', to: '2026-10-16' },
            { kind: 'sql', value: 'undecided' },
          ]}
          onRemove={onRemove}
          onClearAll={onClearAll}
        />
      )
    );
    expect(screen.getByText('対象システム：AS/400')).toBeInTheDocument();
    expect(screen.getByText('作成日 2026/10/16 まで')).toBeInTheDocument();
    expect(screen.getByText('SQL 未判定')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '条件「スコア 40〜80」を外す' }));
    expect(onRemove).toHaveBeenCalledWith({ kind: 'score', min: 40, max: 80 });
    await user.click(screen.getByRole('button', { name: t.chips.clearAll }));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });
});
