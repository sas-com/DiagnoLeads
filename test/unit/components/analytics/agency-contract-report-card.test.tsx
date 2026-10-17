/**
 * Funnel and cost per agency contract on the analytics page (#148). Made-up names and fees.
 */
import { AgencyContractReportCard } from '@/app/[locale]/(dashboard)/analytics/_components/agency-contract-report-card';
import { buildContractReport } from '@/lib/features/agency-contracts/report';
import messages from '@/locales/ja/common.json';
import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ result: {} as Record<string, unknown> }));

vi.mock('@/lib/trpc/client', () => ({
  trpc: { agencyContracts: { report: { useQuery: () => mocks.result } } },
}));

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';

const renderCard = () =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <AgencyContractReportCard organizationId={ORG_ID} />
    </NextIntlClientProvider>
  );

const report = buildContractReport(
  [
    {
      id: 'a1',
      agencyName: '代行A',
      startsOn: '2026-10-01',
      endsOn: null,
      initialFee: 100_000,
      monthlyFee: 0,
      prepayment: 0,
      feePerAppointment: 20_000,
      planAppointments: 10,
      planCostPerAppointment: 30_000,
    },
  ],
  [
    { agencyName: '代行A', createdOn: '2026-10-02', hasNegotiated: true, sqlDecision: 'qualified', dealPhaseReachedAt: {}, conditionsMet: true },
    { agencyName: '代行A', createdOn: '2026-10-03', hasNegotiated: false, sqlDecision: null, dealPhaseReachedAt: {}, conditionsMet: false },
    { agencyName: '代行Z', createdOn: '2026-10-03', hasNegotiated: false, sqlDecision: null, dealPhaseReachedAt: {} },
  ],
  '2026-10-16'
);

beforeEach(() => {
  mocks.result = { data: { ...report, canManage: true }, isLoading: false, error: null };
});

describe('AgencyContractReportCard', () => {
  it('shows each contract with its funnel, cost and plan', () => {
    renderCard();
    const row = screen.getByText('代行A').closest('tr') as HTMLElement;
    // 100,000 + 20,000 × 2 = 140,000 (also per SQL: one SQL); per appointment 70,000
    expect(within(row).getAllByText('￥140,000')).toHaveLength(2);
    expect(within(row).getByText('固定 ￥100,000／件数分 ￥40,000')).toBeInTheDocument();
    expect(within(row).getByText('￥70,000')).toBeInTheDocument();
    expect(within(row).getByText('アポ 2／10件（20%）')).toBeInTheDocument();
    expect(within(row).getByText('目標アポ単価 ￥30,000')).toBeInTheDocument();
  });

  it('shows how many reviewed appointments met the conditions (#149)', () => {
    renderCard();
    expect(screen.getByRole('columnheader', { name: '条件を満たしたアポ' })).toBeInTheDocument();
    const row = screen.getByText('代行A').closest('tr') as HTMLElement;
    expect(within(row).getByText('1／2件（50%）')).toBeInTheDocument();
  });

  it('marks agencies without a contract instead of making up a cost', () => {
    renderCard();
    const row = screen.getByText('代行Z').closest('tr') as HTMLElement;
    expect(within(row).getByText('契約なし')).toBeInTheDocument();
    expect(within(row).getByText(/費用未登録/)).toBeInTheDocument();
  });

  it('tells an admin where to register contracts when there is nothing yet', () => {
    mocks.result = {
      data: { contracts: [], uncontracted: [], canManage: true },
      isLoading: false,
      error: null,
    };
    renderCard();
    expect(screen.getByText(/設定 → 営業代行リンク/)).toBeInTheDocument();
  });

  it('shows nothing to a viewer from a parent organization', () => {
    mocks.result = { data: undefined, isLoading: false, error: { data: { code: 'FORBIDDEN' } } };
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });
});
