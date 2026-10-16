/**
 * Hearings card on the lead details (real next-intl messages, tRPC mocked) — Refs #84
 */
import { LeadHearingsCard } from '@/components/features/lead-hearings/lead-hearings-card';
import messages from '@/locales/ja/common.json';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '770e8400-e29b-41d4-a716-446655440000';
const NEWEST_SUBMISSION = '990e8400-e29b-41d4-a716-446655440001';
const OLDER_SUBMISSION = '990e8400-e29b-41d4-a716-446655440002';

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  push: vi.fn(),
  list: undefined as unknown,
  sources: [] as unknown[],
  create: undefined as undefined | { onSuccess: (result: { id: string }) => void },
}));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({ leadHearings: { listByLead: { invalidate: vi.fn() } } }),
    leadHearings: {
      listByLead: {
        useQuery: () => ({ data: mocks.list, isLoading: false, isError: false, refetch: vi.fn() }),
      },
      prefillSources: {
        useQuery: () => ({ data: mocks.sources, isLoading: false }),
      },
      create: {
        useMutation: (options: { onSuccess: (result: { id: string }) => void }) => {
          mocks.create = options;
          return { mutate: mocks.mutate, isPending: false };
        },
      },
    },
  },
}));
vi.mock('@/hooks/use-organization', () => ({
  useOrganization: () => ({ organizationId: ORG_ID }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const item = (overrides: Record<string, unknown> = {}) => ({
  id: '880e8400-e29b-41d4-a716-446655440000',
  heldOn: '2026-10-15',
  dealRating: 'a',
  missingCount: 3,
  unconfirmedCount: 0,
  fromDiagnosis: true,
  createdBy: 'user',
  createdAt: new Date('2026-10-15T01:00:00Z'),
  updatedAt: new Date('2026-10-15T01:00:00Z'),
  ...overrides,
});

const sources = [
  {
    id: NEWEST_SUBMISSION,
    submittedAt: new Date('2026-10-10T01:00:00Z'),
    diagnosticVersion: 1,
    platform: 'as400',
    verified: false,
  },
  {
    id: OLDER_SUBMISSION,
    submittedAt: new Date('2026-09-10T01:00:00Z'),
    diagnosticVersion: 1,
    platform: 'access',
    verified: true,
  },
];

const renderCard = () =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <LeadHearingsCard leadId={LEAD_ID} />
    </NextIntlClientProvider>
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sources = sources;
});

describe('LeadHearingsCard', () => {
  it('lists hearings with the deal rating and missing items, without a record button for viewers', () => {
    mocks.list = { items: [item()], canEdit: false };
    renderCard();

    expect(screen.getByText('評価 A')).toBeInTheDocument();
    expect(screen.getByText('未記入 3')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /の商談/ })).toHaveAttribute(
      'href',
      `/ja/leads/${LEAD_ID}/hearings/${item().id}`
    );
    expect(screen.queryByRole('button', { name: '記録する' })).not.toBeInTheDocument();
  });

  it('shows an empty state', () => {
    mocks.list = { items: [], canEdit: true };
    renderCard();

    expect(screen.getByText('まだ記録はありません。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '記録する' })).toBeInTheDocument();
  });

  it('starts the first hearing from the newest diagnosis and opens the editor', async () => {
    mocks.list = { items: [], canEdit: true };
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('button', { name: '記録する' }));
    expect(screen.queryByLabelText('前回の内容を引き継ぐ')).not.toBeInTheDocument();
    const source = screen.getByRole('combobox', { name: '最初に表示する Web 診断の回答' });
    expect(source).toHaveTextContent('AS/400（IBM i）');
    expect(source).toHaveTextContent('本人未確認');
    expect(screen.getByText(/メールアドレスが一致しただけ/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '作成' }));
    const input = mocks.mutate.mock.calls[0][0];
    expect(input).toEqual({
      organizationId: ORG_ID,
      leadId: LEAD_ID,
      heldOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      submissionId: NEWEST_SUBMISSION,
    });

    const created = '880e8400-e29b-41d4-a716-446655440009';
    act(() => mocks.create?.onSuccess({ id: created }));
    expect(mocks.push).toHaveBeenCalledWith(`/ja/leads/${LEAD_ID}/hearings/${created}`);
  });

  it('carries over the previous hearing by default', async () => {
    mocks.list = { items: [item()], canEdit: true };
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('button', { name: '記録する' }));
    expect(screen.getByRole('checkbox', { name: '前回の内容を引き継ぐ' })).toBeChecked();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '作成' }));
    expect(mocks.mutate.mock.calls[0][0]).toMatchObject({ carryOver: true });
    expect(mocks.mutate.mock.calls[0][0]).not.toHaveProperty('submissionId');
  });

  it('starts again from the diagnosis when carrying over is unchecked', async () => {
    mocks.list = { items: [item()], canEdit: true };
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('button', { name: '記録する' }));
    await user.click(screen.getByRole('checkbox', { name: '前回の内容を引き継ぐ' }));
    expect(screen.getByRole('combobox', { name: '最初に表示する Web 診断の回答' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '作成' }));

    expect(mocks.mutate.mock.calls[0][0]).toMatchObject({
      carryOver: false,
      submissionId: NEWEST_SUBMISSION,
    });
  });
});
