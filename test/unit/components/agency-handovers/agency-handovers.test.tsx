/**
 * The agency's appointment report on screen (#152): importing a file with its columns found or
 * chosen, the results, and the handover card on the lead page. Values are made up.
 */
import { AgencyHandoverCard } from '@/components/features/agency-handovers/agency-handover-card';
import { HandoverImportDialog } from '@/components/features/agency-handovers/handover-import-dialog';
import messages from '@/locales/ja/common.json';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handover: {} as Record<string, unknown>,
  mutate: vi.fn(),
  onSuccess: undefined as undefined | ((data: unknown) => void),
}));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({ agencyHandovers: { get: { invalidate: vi.fn() } } }),
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
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

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
    });
    expect(await screen.findByText('1 件を取り込みました。')).toBeInTheDocument();
    expect(screen.getByText('リードが見つからなかった行：1 件')).toBeInTheDocument();
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
