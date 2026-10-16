/**
 * Header lead search (#164): suggestions of the current organization, keyboard navigation,
 * Enter without a choice opens the lead list with ?q=
 */
import { HeaderLeadSearch } from '@/components/header/HeaderLeadSearch';
import { escapeLikePattern } from '@/lib/features/lead-search/api/router';
import messages from '@/locales/ja/common.json';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_A = '770e8400-e29b-41d4-a716-446655440001';
const LEAD_B = '770e8400-e29b-41d4-a716-446655440002';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  inputs: [] as { input: { organizationId: string; query: string }; enabled: boolean }[],
  organizationId: '660e8400-e29b-41d4-a716-446655440000' as string | null,
}));

const LEADS = [
  { id: LEAD_A, name: '山田 太郎', email: 'taro@alpha.example.com', company: 'アルファ', status: 'new' },
  { id: LEAD_B, name: null, email: 'info@beta.example.com', company: null, status: 'new' },
];

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    leadSearch: {
      suggest: {
        useQuery: (
          input: { organizationId: string; query: string },
          options: { enabled: boolean }
        ) => {
          mocks.inputs.push({ input, enabled: options.enabled });
          return { data: options.enabled ? LEADS : undefined, isFetching: false };
        },
      },
    },
  },
}));

vi.mock('@/hooks/use-organization', () => ({
  useOrganization: () => ({ organizationId: mocks.organizationId }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn() }),
  usePathname: () => '/ja/dashboard',
}));

beforeAll(() => {
  // cmdk and Radix use these browser APIs that jsdom lacks
  Element.prototype.scrollIntoView = vi.fn();
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  vi.useFakeTimers();
  mocks.push.mockReset();
  mocks.inputs = [];
  mocks.organizationId = ORG_ID;
});

afterEach(() => {
  vi.useRealTimers();
});

const s = messages.header.search;

const renderSearch = () =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages}>
      <HeaderLeadSearch />
    </NextIntlClientProvider>
  );

const type = (text: string) => {
  const input = screen.getByRole('combobox', { name: s.label });
  fireEvent.change(input, { target: { value: text } });
  act(() => {
    vi.advanceTimersByTime(250);
  });
  return input;
};

describe('HeaderLeadSearch', () => {
  it('asks for suggestions of the current organization only after typing', () => {
    renderSearch();
    expect(mocks.inputs.every((call) => !call.enabled)).toBe(true);

    type(' 山田 ');
    const last = mocks.inputs.at(-1);
    expect(last).toEqual({ input: { organizationId: ORG_ID, query: '山田' }, enabled: true });
    expect(screen.getByText('山田 太郎')).toBeInTheDocument();
    expect(screen.getByText('アルファ')).toBeInTheDocument();
    expect(screen.getByText(s.noName)).toBeInTheDocument();
  });

  it('Enter without choosing opens the lead list with ?q=', () => {
    renderSearch();
    const input = type('山田 & co');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mocks.push).toHaveBeenCalledWith(
      `/ja/leads?q=${encodeURIComponent('山田 & co')}`
    );
  });

  it('arrow keys choose a lead and Enter opens its page', () => {
    renderSearch();
    const input = type('a');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mocks.push).toHaveBeenCalledWith(`/ja/leads/${LEAD_B}`);
  });

  it('clicking a suggestion opens the lead', () => {
    renderSearch();
    type('山田');
    fireEvent.click(screen.getByText('山田 太郎'));
    expect(mocks.push).toHaveBeenCalledWith(`/ja/leads/${LEAD_A}`);
  });

  it('does not search without an organization', () => {
    mocks.organizationId = null;
    renderSearch();
    type('山田');
    expect(mocks.inputs.every((call) => !call.enabled)).toBe(true);
  });
});

describe('escapeLikePattern', () => {
  it('escapes LIKE wildcards and the escape character', () => {
    expect(escapeLikePattern('100%_a\\b')).toBe('100\\%\\_a\\\\b');
    expect(escapeLikePattern('山田')).toBe('山田');
  });
});
