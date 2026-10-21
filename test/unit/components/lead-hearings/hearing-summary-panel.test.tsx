/**
 * Meeting summary panel (real next-intl messages, tRPC mocked) — Refs #97
 */
import { HearingSummaryPanel } from '@/components/features/lead-hearings/hearing-summary-panel';
import { DEFAULT_HEARING_CATALOG } from '@/lib/features/lead-hearings/catalog';
import { type HearingSummary, buildHearingSummary } from '@/lib/features/lead-hearings/summary';
import { hearingSummaryLabels } from '@/lib/features/lead-hearings/summary-messages';
import type { HearingFields } from '@/lib/features/lead-hearings/types/schemas';
import messages from '@/locales/ja/common.json';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const HEARING_ID = '880e8400-e29b-41d4-a716-446655440000';

const mocks = vi.hoisted(() => ({
  summary: undefined as unknown,
  isError: false,
  refetch: vi.fn(),
  queryInput: undefined as unknown,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    leadHearings: {
      summary: {
        useQuery: (input: unknown) => {
          mocks.queryInput = input;
          return {
            data: mocks.summary ? { summary: mocks.summary } : undefined,
            isError: mocks.isError,
            refetch: mocks.refetch,
          };
        },
      },
    },
  },
}));
vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }));

const FIELDS: HearingFields = {
  targetSystem: { value: 'as400', status: 'not_yet', source: 'prefilled' },
  machineModel: { value: 'Power 9', status: 'done', source: null },
  budgetStatus: { status: 'next', source: null },
  dealRating: { value: 'a', status: 'done', source: null },
};

const summaryOf = (fields: HearingFields, previous?: { heldOn: string; fields: HearingFields }) =>
  buildHearingSummary(
    { heldOn: '2026-10-16', fields, lead: { name: 'Lead A', company: 'Company A' } },
    DEFAULT_HEARING_CATALOG,
    hearingSummaryLabels('ja'),
    previous
  );

const onJump = vi.fn();
const panel = () => (
  <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
    <HearingSummaryPanel organizationId={ORG_ID} hearingId={HEARING_ID} onJump={onJump} />
  </NextIntlClientProvider>
);

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
function setClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.summary = summaryOf(FIELDS) satisfies HearingSummary;
  mocks.isError = false;
});

afterEach(() => {
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
});

describe('HearingSummaryPanel', () => {
  it('asks for the summary in the screen language and shows the sections', () => {
    render(panel());
    expect(mocks.queryInput).toEqual({ organizationId: ORG_ID, id: HEARING_ID, locale: 'ja' });
    expect(screen.getByText('Company A / Lead A · 2026年10月16日')).toBeInTheDocument();
    for (const title of ['現状', '課題', '要件', '評価と次回']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
    const target = screen.getByTestId('hearing-summary-item-targetSystem');
    expect(within(target).getByText('AS/400')).toBeInTheDocument();
    expect(within(target).getByText('Web診断')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('hearing-summary-item-budgetStatus')).getAllByText('次回確認')
    ).not.toHaveLength(0);
    expect(screen.getByText('このリードの以前のヒアリングはありません。')).toBeInTheDocument();
  });

  it('folds the fields with nothing recorded into one line per section (Refs #163)', () => {
    render(panel());
    // Recorded values, "next time" and the diagnosis value keep their own rows
    expect(screen.getByTestId('hearing-summary-item-machineModel')).toBeInTheDocument();
    expect(screen.getByTestId('hearing-summary-item-budgetStatus')).toBeInTheDocument();
    // Empty fields are not repeated row by row (次回に確認すること lists the required ones)
    expect(screen.queryByTestId('hearing-summary-item-scale')).not.toBeInTheDocument();
    const empty = screen.getByTestId('hearing-summary-empty-currentSystem');
    expect(empty.textContent).toMatch(/^未入力 \d+項目：/);
    expect(empty).toHaveTextContent('規模');
    expect(screen.queryByText('未記入')).not.toBeInTheDocument();
  });

  it('copies the plain text with the Clipboard API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    render(panel());

    fireEvent.click(screen.getByRole('button', { name: 'コピー' }));

    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith('まとめをコピーしました'));
    const text = writeText.mock.calls[0][0] as string;
    expect(text.split('\n')[0]).toBe('【商談のまとめ】Company A / Lead A（2026年10月16日）');
    expect(text).toContain('■ 次回に確認すること');
    expect(text).toContain('・対象システム（事前情報のまま未確認）');
  });

  it('falls back to a hidden textarea when the Clipboard API is missing', async () => {
    setClipboard(undefined);
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
    render(panel());

    fireEvent.click(screen.getByRole('button', { name: 'コピー' }));

    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('reports a copy that did not work', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) });
    Object.defineProperty(document, 'execCommand', {
      value: vi.fn().mockReturnValue(false),
      configurable: true,
    });
    render(panel());

    fireEvent.click(screen.getByRole('button', { name: 'コピー' }));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('コピーできませんでした'));
  });

  it('prints with the browser dialog', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(panel());
    fireEvent.click(screen.getByRole('button', { name: '印刷' }));
    expect(print).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('hearing-summary')).toHaveAttribute('data-hearing-summary');
  });

  it('lists what to confirm next time once each and links every item to its field', () => {
    render(panel());
    const list = screen.getByTestId('hearing-summary-todos');
    const buttons = within(list).getAllByRole('button');
    // targetSystem is both unconfirmed and missing: listed once
    expect(buttons.map((b) => b.textContent)).toContain('対象システム(事前情報のまま未確認)');
    expect(buttons.filter((b) => b.textContent?.startsWith('対象システム('))).toHaveLength(1);

    fireEvent.click(within(list).getByRole('button', { name: /予算の状態/ }));
    expect(onJump).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'budgetStatus', section: 'requirements', reasons: ['next'] })
    );
  });

  it('shows the changes since the previous hearing', () => {
    mocks.summary = summaryOf(FIELDS, {
      heldOn: '2026-10-01',
      fields: { ...FIELDS, machineModel: { value: 'Power 8', status: 'done', source: null } },
    });
    render(panel());
    expect(screen.getByRole('heading', { name: '前回（2026年10月1日）からの変化' })).toBeVisible();
    const row = within(screen.getByTestId('hearing-summary-changes')).getByRole('row', {
      name: /機種・バージョン/,
    });
    expect(row).toHaveTextContent('Power 8');
    expect(row).toHaveTextContent('Power 9');
    expect(
      within(screen.getByTestId('hearing-summary-item-machineModel')).getByText('前回から変更')
    ).toBeInTheDocument();
  });

  it('offers a retry when the summary cannot be loaded', () => {
    mocks.summary = undefined;
    mocks.isError = true;
    render(panel());
    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(mocks.refetch).toHaveBeenCalled();
  });
});
