/**
 * Recording a contact, and undoing it, refreshes the 今日 screen's activity of the day (#556)
 * with the lead's contacts, its activity and the dashboard, and its toasts name the lead when it
 * is given (#863) (real next-intl messages; tRPC and the toast mocked)
 */
import { useRecordContact } from '@/components/features/lead-follow-up/use-record-contact';
import messages from '@/locales/ja/common.json';
import { act, renderHook } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '770e8400-e29b-41d4-a716-446655440001';

type MutationOptions = {
  onSuccess?: (result: unknown, input: unknown) => void;
  onError?: () => void;
};
type ToastOptions = { description?: string; action?: { onClick: () => void } };

const mocks = vi.hoisted(() => ({
  invalidated: [] as { path: string; input: unknown }[],
  toast: { success: vi.fn(), error: vi.fn() },
  /** The next call fails */
  fail: false,
}));

vi.mock('@/lib/trpc/client', () => {
  const invalidate = (path: string) => ({
    invalidate: (input?: unknown) => {
      mocks.invalidated.push({ path, input });
    },
  });
  const saved = {
    id: 'contact-1',
    leadId: '770e8400-e29b-41d4-a716-446655440001',
    kind: 'call',
    note: null,
    contactedAt: new Date('2026-10-29T01:00:00Z'),
    durationMinutes: null,
    outcome: null,
    createdBy: null,
  };
  const mutation = () => ({
    useMutation: (options: MutationOptions = {}) => ({
      isPending: false,
      mutate: (input: unknown) =>
        mocks.fail ? options.onError?.() : options.onSuccess?.(saved, input),
      mutateAsync: async (input: unknown) => {
        if (mocks.fail) {
          options.onError?.();
          throw new Error('failed');
        }
        options.onSuccess?.(saved, input);
        return saved;
      },
    }),
  });
  return {
    trpc: {
      useUtils: () => ({
        leadFollowUp: { contacts: invalidate('leadFollowUp.contacts') },
        leadActivity: {
          list: invalidate('leadActivity.list'),
          forDeal: invalidate('leadActivity.forDeal'),
          myDay: invalidate('leadActivity.myDay'),
        },
        analytics: { getDashboard: invalidate('analytics.getDashboard') },
      }),
      leadFollowUp: { recordContact: mutation(), deleteContact: mutation() },
    },
  };
});
vi.mock('sonner', () => ({ toast: mocks.toast }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
    {children}
  </NextIntlClientProvider>
);

beforeEach(() => {
  mocks.invalidated = [];
  mocks.fail = false;
  vi.clearAllMocks();
});

const myDayRefreshes = () =>
  mocks.invalidated.filter((call) => call.path === 'leadActivity.myDay');

describe('useRecordContact', () => {
  it('refreshes the activity of the day of the organization when a contact is recorded', async () => {
    const { result } = renderHook(
      () => useRecordContact({ organizationId: ORG_ID, leadId: LEAD_ID }),
      { wrapper }
    );

    await act(() => result.current.record({ kind: 'call' }));

    expect(myDayRefreshes()).toEqual([
      { path: 'leadActivity.myDay', input: { organizationId: ORG_ID } },
    ]);
    expect(mocks.invalidated.map((call) => call.path)).toEqual(
      expect.arrayContaining(['leadFollowUp.contacts', 'leadActivity.list'])
    );
  });

  it('refreshes it again when the record is undone', async () => {
    const { result } = renderHook(
      () => useRecordContact({ organizationId: ORG_ID, leadId: LEAD_ID }),
      { wrapper }
    );
    await act(() => result.current.record({ kind: 'call' }));
    const [, options] = mocks.toast.success.mock.calls[0] as [string, ToastOptions];

    act(() => options.action?.onClick());

    expect(myDayRefreshes()).toHaveLength(2);
  });
});

describe('the toasts of a record', () => {
  const t = messages.leadFollowUp.contact;
  const recorder = (leadLabel?: string) =>
    renderHook(() => useRecordContact({ organizationId: ORG_ID, leadId: LEAD_ID, leadLabel }), {
      wrapper,
    });

  it('name the lead under the record and under its undo, when it is given (#863)', async () => {
    const { result } = recorder('架空商事');
    await act(() => result.current.record({ kind: 'call' }));
    const [message, options] = mocks.toast.success.mock.calls[0] as [string, ToastOptions];

    expect(message).toBe('「電話した」を記録しました');
    expect(options.description).toBe('架空商事');
    act(() => options.action?.onClick());
    expect(mocks.toast.success).toHaveBeenLastCalledWith(t.undone, { description: '架空商事' });
  });

  it('name the lead under a failure, and under a failed undo', async () => {
    const { result } = recorder('架空商事');
    await act(() => result.current.record({ kind: 'call' }));
    const [, options] = mocks.toast.success.mock.calls[0] as [string, ToastOptions];

    mocks.fail = true;
    act(() => options.action?.onClick());
    expect(mocks.toast.error).toHaveBeenLastCalledWith(t.error, { description: '架空商事' });
    mocks.toast.error.mockClear();
    await act(() => result.current.record({ kind: 'email' }).catch(() => undefined));
    expect(mocks.toast.error).toHaveBeenCalledWith(t.error, { description: '架空商事' });
  });

  it('say no more than before without one', async () => {
    const { result } = recorder();
    await act(() => result.current.record({ kind: 'call' }));
    const [message, options] = mocks.toast.success.mock.calls[0] as [string, ToastOptions];

    expect(message).toBe('「電話した」を記録しました');
    expect(options.description).toBeUndefined();
  });
});
