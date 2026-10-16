/**
 * First meeting hearing editor (real next-intl messages, tRPC mocked) — Refs #84, #96
 */
import { LeadHearingEditor } from '@/components/features/lead-hearings/lead-hearing-editor';
import {
  DEFAULT_HEARING_CATALOG,
  HEARING_REQUIRED_ITEMS,
} from '@/lib/features/lead-hearings/catalog';
import { hearingModeStorageKey } from '@/lib/features/lead-hearings/meeting-mode';
import { buildHearingSummary } from '@/lib/features/lead-hearings/summary';
import { hearingSummaryLabels } from '@/lib/features/lead-hearings/summary-messages';
import type { HearingFields } from '@/lib/features/lead-hearings/types/schemas';
import messages from '@/locales/ja/common.json';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '770e8400-e29b-41d4-a716-446655440000';
const HEARING_ID = '880e8400-e29b-41d4-a716-446655440000';
const UPDATED_AT = new Date('2026-10-15T01:00:00Z');
const USER_ID = 'user-1';
const MODE_KEY = hearingModeStorageKey(USER_ID);

interface MutationOptions {
  onSuccess: (result: unknown) => void;
  onError: (error: unknown) => void;
}

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  refetch: vi.fn(),
  data: undefined as unknown,
  error: null as unknown,
  update: undefined as undefined | MutationOptions,
  setData: vi.fn(),
  invalidateGet: vi.fn(),
  invalidateList: vi.fn(),
  invalidateSummary: vi.fn(),
  summary: undefined as unknown,
}));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      leadHearings: {
        get: { invalidate: mocks.invalidateGet, setData: mocks.setData },
        listByLead: { invalidate: mocks.invalidateList },
        summary: { invalidate: mocks.invalidateSummary },
      },
    }),
    leadHearings: {
      get: {
        useQuery: () => ({
          data: mocks.error ? undefined : mocks.data,
          isError: Boolean(mocks.error),
          error: mocks.error,
          refetch: mocks.refetch,
        }),
      },
      summary: {
        useQuery: () => ({
          data: mocks.summary ? { summary: mocks.summary } : undefined,
          isError: false,
        }),
      },
      update: {
        useMutation: (options: MutationOptions) => {
          mocks.update = options;
          return { mutate: mocks.mutate, isPending: false };
        },
      },
    },
    leads: {
      get: {
        useQuery: () => ({
          data: { id: LEAD_ID, name: 'Lead A', company: 'Company A', email: 'a@example.com' },
        }),
      },
    },
  },
}));
vi.mock('@/lib/auth/client', () => ({
  useSession: () => ({ data: { user: { id: USER_ID } }, isPending: false }),
}));
vi.mock('@/hooks/use-organization', () => ({
  useOrganization: () => ({ organizationId: ORG_ID }),
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

function hearing(overrides: Record<string, unknown> = {}) {
  return {
    id: HEARING_ID,
    leadId: LEAD_ID,
    heldOn: '2026-10-15',
    catalogVersion: 1,
    fields: {
      targetSystem: { value: 'as400', status: 'not_yet', source: 'prefilled' },
      attendeeRoles: { value: ['executive'], status: 'not_yet', source: 'prefilled' },
    },
    droppedKeys: [],
    prefill: {
      submissionId: '990e8400-e29b-41d4-a716-446655440000',
      diagnosticKey: 'ax-migration',
      diagnosticVersion: 1,
      submittedAt: '2026-10-01T00:00:00Z',
      verified: false,
      answers: { platform: 'as400', role: 'executive' },
      challenges: null,
      hints: { targetSystem: ['platform'], attendeeRoles: ['role'] },
    },
    updatedAt: UPDATED_AT,
    canEdit: true,
    ...overrides,
  };
}

// A new element each time, so rerender() really renders again
const editor = (initialView?: 'record' | 'summary') => (
  <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
    <LeadHearingEditor leadId={LEAD_ID} hearingId={HEARING_ID} initialView={initialView} />
  </NextIntlClientProvider>
);

const summaryOf = (fields: HearingFields) =>
  buildHearingSummary(
    { heldOn: '2026-10-15', fields, lead: { name: 'Lead A', company: 'Company A' } },
    DEFAULT_HEARING_CATALOG,
    hearingSummaryLabels('ja')
  );

const savedFields = () => mocks.mutate.mock.calls[0][0].fields;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.data = hearing();
  mocks.error = null;
  mocks.summary = undefined;
  window.localStorage.clear();
});

describe('LeadHearingEditor', () => {
  // These cover the detail mode (tabs) the user chose earlier
  beforeEach(() => window.localStorage.setItem(MODE_KEY, 'detail'));

  it('shows the lead, the diagnosis answer and that it is unverified', () => {
    render(editor());

    expect(screen.getByText('Lead A / Company A')).toBeInTheDocument();
    expect(screen.getByText('本人未確認')).toBeInTheDocument();
    expect(screen.getByText('Web診断: 経営層・決裁者')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'リード詳細に戻る' })).toHaveAttribute(
      'href',
      `/ja/leads/${LEAD_ID}?tab=hearings`
    );
  });

  it('marks a diagnosis value confirmed and done', async () => {
    const user = userEvent.setup();
    render(editor());

    await user.click(screen.getByRole('button', { name: '先方の出席者の立場を確認済みにする' }));
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(savedFields().attendeeRoles).toEqual({
      value: ['executive'],
      status: 'done',
      source: 'confirmed',
    });
  });

  it('marks a changed diagnosis value as corrected', async () => {
    const user = userEvent.setup();
    render(editor());

    await user.click(screen.getByRole('checkbox', { name: '情報システム部門の責任者' }));
    expect(screen.getByText('修正あり')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(savedFields().attendeeRoles).toEqual({
      value: ['executive', 'it_manager'],
      status: 'done',
      source: 'corrected',
    });
  });

  it('warns about missing required items on the outcome tab but still saves', async () => {
    const user = userEvent.setup();
    render(editor());

    await user.click(screen.getByRole('tab', { name: /結果/ }));
    expect(screen.getByText('未記入の必須項目')).toBeInTheDocument();
    // The callout comes before the next-meeting fields
    const callout = screen.getByText('未記入の必須項目');
    const nextMeeting = screen.getByLabelText('次回の日程');
    expect(
      callout.compareDocumentPosition(nextMeeting) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    // Unconfirmed diagnosis values are listed too
    expect(screen.getByText('Web診断の値のまま未確認の項目')).toBeInTheDocument();

    // Jump to the tab of a missing item
    await user.click(screen.getByRole('button', { name: '対象システムと機種' }));
    expect(screen.getByRole('tab', { name: /現行システム/ })).toHaveAttribute(
      'aria-selected',
      'true'
    );

    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.mutate.mock.calls[0][0]).toMatchObject({
      organizationId: ORG_ID,
      id: HEARING_ID,
      heldOn: '2026-10-15',
      expectedUpdatedAt: UPDATED_AT,
    });
  });

  it('keeps the edits and offers a reload when someone else saved first', async () => {
    const user = userEvent.setup();
    render(editor());

    await user.click(screen.getByRole('checkbox', { name: '業務部門の担当者' }));
    await user.click(screen.getByRole('button', { name: '保存' }));
    act(() => mocks.update?.onError({ data: { code: 'CONFLICT' } }));

    expect(screen.getByText('ほかの人が先に保存しました')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '最新の内容を読み込む' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '業務部門の担当者' })).toBeChecked();
  });

  it('fills the form from the saved row and caches it instead of fetching again', async () => {
    const user = userEvent.setup();
    render(editor());

    await user.click(screen.getByRole('button', { name: '保存' }));
    const saved = hearing({
      fields: { attendeeRoles: { value: ['it_manager'], status: 'done', source: 'corrected' } },
      updatedAt: new Date('2026-10-15T03:00:00Z'),
    });
    act(() => mocks.update?.onSuccess(saved));

    expect(screen.getByRole('checkbox', { name: '情報システム部門の責任者' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '経営層・決裁者' })).not.toBeChecked();
    expect(mocks.setData).toHaveBeenCalledWith(
      { organizationId: ORG_ID, id: HEARING_ID },
      expect.any(Function)
    );
    expect(mocks.invalidateGet).not.toHaveBeenCalled();
    expect(mocks.invalidateList).toHaveBeenCalledWith({ organizationId: ORG_ID, leadId: LEAD_ID });

    // The next save guards against the saved row
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(mocks.mutate.mock.calls[1][0].expectedUpdatedAt).toEqual(
      new Date('2026-10-15T03:00:00Z')
    );
  });

  it('shows the hearing read-only to those who cannot edit', () => {
    mocks.data = hearing({ canEdit: false });
    render(editor());

    expect(screen.getByText('閲覧のみ')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '先方の出席者の立場を確認済みにする' })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '経営層・決裁者' })).toBeDisabled();
  });

  it('keeps unsaved edits when the hearing is refetched', async () => {
    const user = userEvent.setup();
    const { rerender } = render(editor());

    await user.click(screen.getByRole('checkbox', { name: '業務部門の担当者' }));
    mocks.data = hearing({
      fields: {},
      updatedAt: new Date('2026-10-15T02:00:00Z'),
    });
    rerender(editor());

    expect(screen.getByRole('checkbox', { name: '業務部門の担当者' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '経営層・決裁者' })).toBeChecked();
    // Saving still guards against the newer row that was not loaded into the form
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(mocks.mutate.mock.calls[0][0].expectedUpdatedAt).toEqual(UPDATED_AT);
  });

  it('shows not found for a hearing of another lead', () => {
    mocks.data = hearing({ leadId: '110e8400-e29b-41d4-a716-446655440000' });
    render(editor());

    expect(screen.getByText('ヒアリングが見つかりません')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
  });

  it('shows an error with a retry when loading fails', async () => {
    mocks.error = { data: { code: 'INTERNAL_SERVER_ERROR' } };
    const user = userEvent.setup();
    render(editor());

    expect(screen.getByText('ヒアリングを読み込めませんでした')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(mocks.refetch).toHaveBeenCalled();
  });
});

// ── Meeting mode (#96) ──────────────────────────────────────────────────────────

const fieldRow = (key: string) => screen.getByTestId(`hearing-field-${key}`);
const chip = (key: string, name: string) => within(fieldRow(key)).getByRole('button', { name });
const mutateCalls = () => mocks.mutate.mock.calls.map((call) => call[0]);

describe('LeadHearingEditor meeting mode', () => {
  it('opens a new hearing with the required items in meeting order and the rest folded', async () => {
    const user = userEvent.setup();
    render(editor());

    const items = screen.getAllByTestId(/^hearing-item-/);
    expect(items.map((el) => el.dataset.testid)).toEqual(
      HEARING_REQUIRED_ITEMS.map((item) => `hearing-item-${item.id}`)
    );
    // Each item holds all of its fields
    expect(within(screen.getByTestId('hearing-item-system')).getByTestId('hearing-field-targetSystem')).toBeInTheDocument();
    expect(within(screen.getByTestId('hearing-item-system')).getByTestId('hearing-field-machineModel')).toBeInTheDocument();
    // No section tabs (only record / summary); a field outside the required items is folded away
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['記録', 'まとめ']);
    expect(screen.queryByTestId('hearing-field-meetingFormat')).not.toBeInTheDocument();
    expect(screen.getByText('必須 0/12')).toBeInTheDocument();

    const others = screen.getByRole('button', { name: /その他の項目/ });
    expect(others).toHaveAttribute('aria-expanded', 'false');
    await user.click(others);
    expect(others).toHaveAttribute('aria-expanded', 'true');
    expect(fieldRow('meetingFormat')).toBeInTheDocument();
    // Required fields are not repeated among the others
    expect(screen.getAllByTestId('hearing-field-targetSystem')).toHaveLength(1);
  });

  it('opens a hearing that already has recorded values in the detail mode', () => {
    mocks.data = hearing({
      fields: { meetingFormat: { value: 'online', status: 'done', source: null } },
    });
    render(editor());

    expect(screen.getByRole('tab', { name: /実施情報/ })).toBeInTheDocument();
    expect(screen.queryByTestId('hearing-meeting-mode')).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: '商談モード' })).toHaveAttribute(
      'aria-checked',
      'false'
    );
  });

  it('sets the value and marks it done when a chip is tapped', async () => {
    const user = userEvent.setup();
    render(editor());

    await user.click(chip('decisionMakerPresent', 'はい'));
    expect(chip('decisionMakerPresent', 'はい')).toHaveAttribute('aria-pressed', 'true');
    // Several choices on a multiple field
    await user.click(chip('competitorTypes', '自社開発'));
    await user.click(chip('competitorTypes', '現在の保守会社'));
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(savedFields().decisionMakerPresent).toEqual({
      value: 'yes',
      status: 'done',
      source: null,
    });
    // Catalog order, not tap order
    expect(savedFields().competitorTypes).toEqual({
      value: ['current_vendor', 'in_house'],
      status: 'done',
      source: null,
    });
    expect(screen.getByText('必須 2/12')).toBeInTheDocument();
  });

  it('marks an item "next time" or "not applicable" with one tap, and takes it back', async () => {
    const user = userEvent.setup();
    render(editor());

    const next = screen.getByRole('button', { name: '次回の日程と出席者を次回にする' });
    await user.click(next);
    expect(next).toHaveAttribute('aria-pressed', 'true');
    // A status the user picked is kept when a value is chosen afterwards
    await user.click(chip('nextMeetingAttendees', '先方の経営層'));

    const notApplicable = screen.getByRole('button', { name: '競合を対象外にする' });
    await user.click(notApplicable);
    expect(screen.getByText('必須 1/12')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(savedFields().nextMeetingDate).toEqual({ status: 'next', source: null });
    expect(savedFields().nextMeetingAttendees).toEqual({
      value: ['customer_executive'],
      status: 'next',
      source: null,
    });
    expect(savedFields().competitorTypes).toEqual({ status: 'not_applicable', source: null });

    // Tapping again takes the status back
    await user.click(notApplicable);
    expect(notApplicable).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('必須 0/12')).toBeInTheDocument();
  });

  it('remembers the chosen mode for the user', async () => {
    const user = userEvent.setup();
    const { unmount } = render(editor());

    const toggle = screen.getByRole('switch', { name: '商談モード' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await user.click(toggle);
    expect(screen.getByRole('tab', { name: /実施情報/ })).toBeInTheDocument();
    expect(window.localStorage.getItem(MODE_KEY)).toBe('detail');
    unmount();

    // A new hearing would open in the meeting mode, but the user's choice wins
    render(editor());
    expect(screen.getByRole('switch', { name: '商談モード' })).toHaveAttribute(
      'aria-checked',
      'false'
    );
    expect(screen.queryByTestId('hearing-meeting-mode')).not.toBeInTheDocument();
  });

  it('still works when the storage is not available', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const user = userEvent.setup();
    try {
      render(editor());
      expect(screen.getByTestId('hearing-meeting-mode')).toBeInTheDocument();
      await user.click(screen.getByRole('switch', { name: '商談モード' }));
      expect(screen.getByRole('tab', { name: /実施情報/ })).toBeInTheDocument();
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });
});

// ── Autosave (#96) ──────────────────────────────────────────────────────────────

describe('LeadHearingEditor autosave', () => {
  const SAVED_AT = new Date('2026-10-15T01:05:00Z'); // 10:05 JST
  const SECOND_SAVED_AT = new Date('2026-10-15T01:06:00Z');

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(SAVED_AT);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
  const succeed = (updatedAt: Date) =>
    act(() => mocks.update?.onSuccess(hearing({ fields: {}, updatedAt })));
  const status = () => screen.getByTestId('hearing-autosave-status');

  it('saves once 3 seconds after the last change, then guards against the saved row', () => {
    render(editor());

    fireEvent.click(chip('decisionMakerPresent', 'はい'));
    expect(status()).toHaveTextContent('未保存の変更あり');
    advance(2999);
    expect(mocks.mutate).not.toHaveBeenCalled();
    advance(1);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mutateCalls()[0]).toMatchObject({
      organizationId: ORG_ID,
      id: HEARING_ID,
      expectedUpdatedAt: UPDATED_AT,
    });
    expect(mutateCalls()[0].fields.decisionMakerPresent).toMatchObject({ value: 'yes' });
    expect(status()).toHaveTextContent('保存中…');

    succeed(SAVED_AT);
    expect(status()).toHaveTextContent('保存済み 10:05');
    // Autosave keeps the form as typed (no toast, no refill)
    expect(chip('decisionMakerPresent', 'はい')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(chip('decisionMakerPresent', 'いいえ'));
    advance(3000);
    expect(mocks.mutate).toHaveBeenCalledTimes(2);
    expect(mutateCalls()[1].expectedUpdatedAt).toEqual(SAVED_AT);
  });

  it('saves two quick changes once', () => {
    render(editor());

    fireEvent.click(chip('decisionMakerPresent', 'はい'));
    advance(1500);
    fireEvent.click(chip('competitorTypes', '自社開発'));
    advance(2999);
    expect(mocks.mutate).not.toHaveBeenCalled();
    advance(1);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mutateCalls()[0].fields).toMatchObject({
      decisionMakerPresent: { value: 'yes' },
      competitorTypes: { value: ['in_house'] },
    });
    advance(10_000);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });

  it('queues a change made while a save is in flight and sends it after the first one', () => {
    render(editor());

    fireEvent.click(chip('decisionMakerPresent', 'はい'));
    advance(3000);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);

    fireEvent.click(chip('competitorTypes', '自社開発'));
    advance(3000);
    // Never two saves at once
    expect(mocks.mutate).toHaveBeenCalledTimes(1);

    succeed(SAVED_AT);
    expect(mocks.mutate).toHaveBeenCalledTimes(2);
    expect(mutateCalls()[1].expectedUpdatedAt).toEqual(SAVED_AT);
    expect(mutateCalls()[1].fields.competitorTypes).toMatchObject({ value: ['in_house'] });

    succeed(SECOND_SAVED_AT);
    advance(10_000);
    expect(mocks.mutate).toHaveBeenCalledTimes(2);
  });

  it('stops on a conflict, keeps the edits and shows the reload', () => {
    render(editor());

    fireEvent.click(chip('decisionMakerPresent', 'はい'));
    advance(3000);
    act(() => mocks.update?.onError({ data: { code: 'CONFLICT' } }));

    expect(screen.getByText('ほかの人が先に保存しました')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '最新の内容を読み込む' })).toBeInTheDocument();
    expect(status()).toHaveTextContent('衝突を解消するまで自動保存を止めています');

    fireEvent.click(chip('competitorTypes', '自社開発'));
    advance(10_000);
    act(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(chip('decisionMakerPresent', 'はい')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('competitorTypes', '自社開発')).toHaveAttribute('aria-pressed', 'true');
  });

  it('saves right away when the tab is hidden', () => {
    render(editor());

    fireEvent.click(chip('decisionMakerPresent', 'はい'));
    act(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    // The pending debounce does not save the same edit again
    advance(10_000);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });

  it('saves pending edits when the editor is left', () => {
    const { unmount } = render(editor());

    fireEvent.click(chip('decisionMakerPresent', 'はい'));
    unmount();
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });

  it('never saves automatically in read-only mode', () => {
    mocks.data = hearing({ canEdit: false });
    const { unmount } = render(editor());

    expect(chip('decisionMakerPresent', 'はい')).toBeDisabled();
    expect(screen.getByRole('button', { name: '競合を対象外にする' })).toBeDisabled();
    expect(screen.queryByTestId('hearing-autosave-status')).not.toBeInTheDocument();
    act(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    advance(10_000);
    unmount();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

describe('LeadHearingEditor summary view', () => {
  beforeEach(() => {
    mocks.summary = summaryOf({
      ...(hearing().fields as HearingFields),
      budgetStatus: { status: 'next', source: null },
    });
  });

  it('opens on the summary from the card link and goes back to a field from the to-do list', async () => {
    window.localStorage.setItem(MODE_KEY, 'detail');
    const user = userEvent.setup();
    render(editor('summary'));

    expect(screen.getByRole('tab', { name: 'まとめ' })).toHaveAttribute('aria-selected', 'true');
    const todos = screen.getByTestId('hearing-summary-todos');
    await user.click(within(todos).getByRole('button', { name: /機種・バージョン/ }));

    expect(screen.queryByTestId('hearing-summary')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /現行システム/ })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await waitFor(() => expect(screen.getByLabelText('機種・バージョン')).toHaveFocus());
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('opens the other fields of the meeting mode for a field outside the required items', async () => {
    window.localStorage.setItem(MODE_KEY, 'meeting');
    const user = userEvent.setup();
    render(editor());

    await user.click(screen.getByRole('tab', { name: 'まとめ' }));
    await user.click(
      within(screen.getByTestId('hearing-summary-todos')).getByRole('button', {
        name: /予算の状態/,
      })
    );

    expect(screen.getByTestId('hearing-meeting-mode')).toBeInTheDocument();
    expect(screen.getByTestId('hearing-field-budgetStatus')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /その他の項目/ })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
  });

  it('saves pending edits before showing the summary', async () => {
    window.localStorage.setItem(MODE_KEY, 'detail');
    const user = userEvent.setup();
    render(editor());

    await user.click(screen.getByRole('checkbox', { name: '業務部門の担当者' }));
    await user.click(screen.getByRole('tab', { name: 'まとめ' }));

    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(screen.getByText('保存されていない変更は、まとめに入っていません。')).toBeVisible();
    act(() => mocks.update?.onSuccess({ ...hearing(), updatedAt: new Date() }));
    expect(mocks.invalidateSummary).toHaveBeenCalledWith({ organizationId: ORG_ID, id: HEARING_ID });
  });

  it('shows the summary in read-only mode', async () => {
    window.localStorage.setItem(MODE_KEY, 'detail');
    mocks.data = hearing({ canEdit: false });
    const user = userEvent.setup();
    render(editor());

    await user.click(screen.getByRole('tab', { name: 'まとめ' }));
    expect(screen.getByTestId('hearing-summary')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'コピー' })).toBeEnabled();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
});
