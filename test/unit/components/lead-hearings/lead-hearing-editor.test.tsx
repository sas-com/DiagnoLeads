/**
 * First meeting hearing editor (real next-intl messages, tRPC mocked) — Refs #84
 */
import { LeadHearingEditor } from '@/components/features/lead-hearings/lead-hearing-editor';
import messages from '@/locales/ja/common.json';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '770e8400-e29b-41d4-a716-446655440000';
const HEARING_ID = '880e8400-e29b-41d4-a716-446655440000';
const UPDATED_AT = new Date('2026-10-15T01:00:00Z');

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
}));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      leadHearings: { get: { invalidate: vi.fn() }, listByLead: { invalidate: vi.fn() } },
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
const editor = () => (
  <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
    <LeadHearingEditor leadId={LEAD_ID} hearingId={HEARING_ID} />
  </NextIntlClientProvider>
);

const savedFields = () => mocks.mutate.mock.calls[0][0].fields;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.data = hearing();
  mocks.error = null;
});

describe('LeadHearingEditor', () => {
  it('shows the lead, the diagnosis answer and that it is unverified', () => {
    render(editor());

    expect(screen.getByText('Lead A / Company A')).toBeInTheDocument();
    expect(screen.getByText('本人未確認')).toBeInTheDocument();
    expect(screen.getByText('Web診断: 経営層・決裁者')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'リード詳細に戻る' })).toHaveAttribute(
      'href',
      `/ja/leads?leadId=${LEAD_ID}`
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
