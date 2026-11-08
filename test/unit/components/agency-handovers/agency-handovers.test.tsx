/**
 * The agency's appointment report on screen (#152): importing a file with its columns found or
 * chosen, the results, the deals in 見極め the import created (#854: what it reloads and the
 * notice with their count), and the handover card on the lead page. Values are made up.
 */
import { AgencyHandoverCard } from '@/components/features/agency-handovers/agency-handover-card';
import { HandoverImportDialog } from '@/components/features/agency-handovers/handover-import-dialog';
import messages from '@/locales/ja/common.json';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handover: {} as Record<string, unknown>,
  mutate: vi.fn(),
  onSuccess: undefined as undefined | ((data: unknown) => void),
  /** What a successful import reloads */
  reload: { handover: vi.fn(), leads: vi.fn(), deals: vi.fn(), leadActivity: vi.fn() },
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      agencyHandovers: { get: { invalidate: mocks.reload.handover } },
      leads: { invalidate: mocks.reload.leads },
      deals: { invalidate: mocks.reload.deals },
      leadActivity: { invalidate: mocks.reload.leadActivity },
    }),
    agencyHandovers: {
      get: { useQuery: () => mocks.handover },
      import: {
        useMutation: (options: { onSuccess: (data: unknown) => void }) => {
          mocks.onSuccess = options.onSuccess;
          return { mutate: mocks.mutate, isPending: false };
        },
      },
    },
  },
}));
vi.mock('sonner', () => ({ toast }));

const ORG = '660e8400-e29b-41d4-a716-446655440000';
const withIntl = (ui: ReactNode) => (
  <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
    {ui}
  </NextIntlClientProvider>
);

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});

beforeEach(() => {
  mocks.mutate.mockReset();
  for (const reload of Object.values(mocks.reload)) reload.mockReset();
  toast.info.mockReset();
});

describe('HandoverImportDialog', () => {
  it('reads a report in another format, finds the columns it knows and imports the rows', async () => {
    const user = userEvent.setup();
    render(withIntl(<HandoverImportDialog open onOpenChange={vi.fn()} organizationId={ORG} />));
    const csv = 'E-Mail,企業名,温度感,備考\nyamada@example.co.jp,架空商事,高,来期に検討\n';
    const file = new File([csv], 'report.csv', { type: 'text/csv' });
    // jsdom's File has no text()
    Object.defineProperty(file, 'text', { value: async () => csv });
    await user.upload(screen.getByLabelText('ファイルを選ぶ'), file);
    expect(await screen.findByText('1 行を読み込みました')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '関心度' })).toHaveTextContent('温度感');
    expect(screen.getByRole('combobox', { name: '機種' })).toHaveTextContent('ファイルにない');

    await user.click(screen.getByRole('button', { name: '取り込む' }));
    expect(mocks.mutate).toHaveBeenCalledWith({
      organizationId: ORG,
      rows: [
        expect.objectContaining({
          email: 'yamada@example.co.jp',
          company: '架空商事',
          interestLevel: 'high',
          note: '来期に検討',
        }),
      ],
    });

    mocks.onSuccess?.({
      results: [
        { index: 0, status: 'saved' },
        { index: 1, status: 'unmatched' },
      ],
      dealsCreated: 0,
    });
    expect(await screen.findByText('1 件を取り込みました。')).toBeInTheDocument();
    expect(screen.getByText('リードが見つからなかった行：1 件')).toBeInTheDocument();
    // No deal was created: the deals and the leads are as they were
    expect(mocks.reload.handover).toHaveBeenCalledTimes(1);
    expect(mocks.reload.deals).not.toHaveBeenCalled();
    expect(mocks.reload.leads).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('reloads the leads, their deals and their activity, and says how many deals the appointments created (#854)', async () => {
    render(withIntl(<HandoverImportDialog open onOpenChange={vi.fn()} organizationId={ORG} />));

    act(() =>
      mocks.onSuccess?.({
        results: [
          { index: 0, status: 'saved' },
          { index: 1, status: 'saved' },
          { index: 2, status: 'saved' },
        ],
        dealsCreated: 2,
      })
    );

    expect(await screen.findByText('3 件を取り込みました。')).toBeInTheDocument();
    expect(mocks.reload.handover).toHaveBeenCalledTimes(1);
    expect(mocks.reload.leads).toHaveBeenCalledTimes(1);
    expect(mocks.reload.deals).toHaveBeenCalledTimes(1);
    expect(mocks.reload.leadActivity).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith(
      '初回の打ち合わせの日が決まった 2 件のリードに、商談（見極め）を作成しました'
    );
  });
});

describe('AgencyHandoverCard', () => {
  it('shows what the agency heard', () => {
    mocks.handover = {
      data: {
        handover: {
          agencyName: '架空テレアポ',
          appointmentOn: '2026-11-05',
          contactName: '山田 太郎',
          contactTitle: '情報システム部 課長',
          contactPhone: '03-0000-0000',
          machineModel: 'IBM Power 9',
          machineModelConfirmed: false,
          hardwareSupportEnd: '2028-03',
          retirementPlan: null,
          decisionMakerPresent: 'yes',
          interestLevel: 'high',
          refusalReason: null,
          note: null,
          updatedAt: new Date('2026-10-21T03:00:00Z'),
          importedByName: '営業 花子',
        },
      },
      isError: false,
    };
    render(withIntl(<AgencyHandoverCard organizationId={ORG} leadId="770e8400-e29b-41d4-a716-446655440000" />));
    expect(screen.getByText('関心度：高')).toBeInTheDocument();
    expect(screen.getByText('IBM Power 9（未確認）')).toBeInTheDocument();
    expect(screen.getByText('山田 太郎 / 情報システム部 課長')).toBeInTheDocument();
    expect(screen.getByText('同席する')).toBeInTheDocument();
    expect(screen.queryByText('退職予定')).not.toBeInTheDocument();
  });

  it('is hidden when the lead has no handover', () => {
    mocks.handover = { data: { handover: null }, isError: false };
    const { container } = render(
      withIntl(<AgencyHandoverCard organizationId={ORG} leadId="770e8400-e29b-41d4-a716-446655440000" />)
    );
    expect(container).toBeEmptyDOMElement();
  });
});
