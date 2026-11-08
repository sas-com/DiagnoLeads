/**
 * The deal in 見極め a customer search row can give its lead (#854) on screen: saving a lead's row
 * with its meeting day, and turning a row with one into a lead, reload what the deal changes (the
 * leads, the deals, the activity) and say a deal was created; nothing of the deals when none was.
 * Made-up values.
 */
import type { ProspectRow } from '@/components/features/prospects/types';
import { ProspectConvertDialog } from '@/components/features/prospects/prospect-convert-dialog';
import { ProspectFormDialog } from '@/components/features/prospects/prospect-form-dialog';
import en from '@/locales/en/common.json';
import ja from '@/locales/ja/common.json';
import { act, render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { useRouter } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Options = { onSuccess?: (result: unknown) => void };

const mocks = vi.hoisted(() => ({
  reload: {
    list: vi.fn(),
    summary: vi.fn(),
    leads: vi.fn(),
    deals: vi.fn(),
    leadActivity: vi.fn(),
  },
  options: {} as Record<'create' | 'update' | 'convert', Options>,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));

vi.mock('@/lib/trpc/client', () => {
  const mutation = (name: 'create' | 'update' | 'convert') => ({
    useMutation: (options: Options) => {
      mocks.options[name] = options;
      return { mutate: vi.fn(), isPending: false };
    },
  });
  return {
    trpc: {
      useUtils: () => ({
        prospects: {
          list: { invalidate: mocks.reload.list },
          summary: { invalidate: mocks.reload.summary },
        },
        leads: { invalidate: mocks.reload.leads },
        deals: { invalidate: mocks.reload.deals },
        leadActivity: { invalidate: mocks.reload.leadActivity },
      }),
      prospects: {
        similar: { useQuery: () => ({ data: [] }) },
        create: mutation('create'),
        update: mutation('update'),
        convertToLead: mutation('convert'),
      },
    },
  };
});
vi.mock('sonner', () => ({ toast }));

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const ROW_ID = '880e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '770e8400-e29b-41d4-a716-446655440000';

/** A row that became a lead, as the list reads it */
const leadRow = {
  id: ROW_ID,
  contactedOn: '2026-10-20',
  entry: 'member_network',
  company: '架空商事',
  meetingOn: '2026-11-10',
  leadId: LEAD_ID,
  troubles: [],
  contactName: null,
  contactPhone: null,
  surname: '佐藤',
} as unknown as ProspectRow;

const wrap = (node: React.ReactNode, locale: 'ja' | 'en' = 'ja') =>
  render(
    <NextIntlClientProvider locale={locale} messages={locale === 'ja' ? ja : en} timeZone="Asia/Tokyo">
      {node}
    </NextIntlClientProvider>
  );

beforeEach(() => {
  for (const reload of Object.values(mocks.reload)) reload.mockReset();
  for (const fn of Object.values(toast)) fn.mockReset();
  mocks.options = {} as typeof mocks.options;
});

describe('ProspectFormDialog', () => {
  const renderForm = () =>
    wrap(
      <ProspectFormDialog
        organizationId={ORG_ID}
        row={leadRow}
        open
        onOpenChange={vi.fn()}
        isSales
        members={[]}
        today="2026-10-21"
      />
    );

  it("reloads the lead's deal and says it was created when the meeting day of a lead's row created one", () => {
    renderForm();
    act(() => mocks.options.update.onSuccess?.({ id: ROW_ID, dealCreated: true }));

    expect(mocks.reload.list).toHaveBeenCalledTimes(1);
    expect(mocks.reload.summary).toHaveBeenCalledTimes(1);
    // The lead's status and deal phase, its deals and the board, its activity
    expect(mocks.reload.leads).toHaveBeenCalledTimes(1);
    expect(mocks.reload.deals).toHaveBeenCalledTimes(1);
    expect(mocks.reload.leadActivity).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith('保存しました');
    expect(toast.info).toHaveBeenCalledWith(
      '初回の打ち合わせの日が決まったため、商談（見極め）を作成しました'
    );
  });

  it('reloads only the customer search when no deal was created', () => {
    renderForm();
    act(() => mocks.options.update.onSuccess?.({ id: ROW_ID, dealCreated: false }));
    act(() => mocks.options.create.onSuccess?.({ id: ROW_ID }));

    expect(mocks.reload.list).toHaveBeenCalledTimes(2);
    expect(mocks.reload.leads).not.toHaveBeenCalled();
    expect(mocks.reload.deals).not.toHaveBeenCalled();
    expect(mocks.reload.leadActivity).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });
});

describe('ProspectConvertDialog', () => {
  const renderDialog = (locale: 'ja' | 'en' = 'ja') =>
    wrap(
      <ProspectConvertDialog organizationId={ORG_ID} row={leadRow} onOpenChange={vi.fn()} />,
      locale
    );

  it('reloads the lead and its deal, says the deal was created, and opens the lead', () => {
    renderDialog();
    act(() =>
      mocks.options.convert.onSuccess?.({ leadId: LEAD_ID, linkedExisting: true, dealCreated: true })
    );

    expect(mocks.reload.list).toHaveBeenCalledTimes(1);
    expect(mocks.reload.leads).toHaveBeenCalledTimes(1);
    expect(mocks.reload.deals).toHaveBeenCalledTimes(1);
    expect(mocks.reload.leadActivity).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith('同じメールアドレスの既存のリードにつなぎました');
    expect(toast.info).toHaveBeenCalledWith(
      '初回の打ち合わせの日が決まったため、商談（見極め）を作成しました'
    );
    expect(useRouter().push).toHaveBeenCalledWith(`/ja/leads/${LEAD_ID}`);
  });

  it('reloads the lead but not the deals when no deal was created', () => {
    renderDialog();
    act(() =>
      mocks.options.convert.onSuccess?.({ leadId: LEAD_ID, linkedExisting: false, dealCreated: false })
    );

    expect(mocks.reload.leads).toHaveBeenCalledTimes(1);
    expect(mocks.reload.deals).not.toHaveBeenCalled();
    expect(mocks.reload.leadActivity).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('リードを作りました');
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('says a deal was created in English too', () => {
    renderDialog('en');
    act(() =>
      mocks.options.convert.onSuccess?.({ leadId: LEAD_ID, linkedExisting: false, dealCreated: true })
    );

    expect(toast.info).toHaveBeenCalledWith(
      'The first meeting is set, so a deal in Qualification was created'
    );
  });
});
